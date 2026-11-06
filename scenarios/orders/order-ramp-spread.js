// 주문하고 결제 화면에서 나가기, 상품 분산: order-ramp.js와 같은 흐름이고 상품 배정만 다르다. dev.imhungry.click용이다.
//   order-ramp.js는 모든 회원이 같은 두 상품을 주문해 같은 상품 행 잠금을 두고 경합한다.
//   이 스크립트는 회원마다 상품 풀(PRODUCT_POOL)에서 1개를 무작위로 골라(시드 고정, 회차마다 같은 배정) 그 상품 하나만 주문해 잠금 경합을 줄인다.
//   요청: GET /api/members/me, GET /api/cart-items → POST /api/orders → GET /api/orders/{orderId}/checkout → PATCH /api/orders/{orderId}/cancel.
//   준비: 회원은 scenarios/dev-prep/members.js, 상품은 scenarios/dev-prep/test-products.js로 미리 만든다. setup이 고른 상품이 장바구니에 없으면 1개 담는다.
// 단계·중단 기준은 order-ramp.js와 같다(실패율 5% 초과에서만 그만둔다).
// 실행: BASE_URL=https://dev.imhungry.click ./tools/run.sh -e PRODUCT_POOL=<번호,번호,...> scenarios/orders/order-ramp-spread.js   (옵션: -e MEMBERS=1000 -e SEED=42)
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { BASE } from '../../lib/auth.js';
import { ensureMembers, loginAll, ensureCartItems } from '../../lib/prepare.js';

const SMOKE = __ENV.SMOKE === '1';
const MEMBERS = Number(__ENV.MEMBERS || (SMOKE ? 10 : 1000));
const SEED = Number(__ENV.SEED || 42);
const PRODUCT_POOL = (__ENV.PRODUCT_POOL || '').split(',').filter((s) => s).map(Number);
if (PRODUCT_POOL.length === 0) throw new Error('PRODUCT_POOL 환경변수가 필요합니다 (-e PRODUCT_POOL=번호,번호,...)');

export const options = {
  setupTimeout: '10m',
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: SMOKE
        ? [{ duration: '10s', target: 10 }, { duration: '20s', target: 10 }]
        : [
            { duration: '30s', target: 100 },
            { duration: '60s', target: 500 },
            { duration: '60s', target: 1000 },
            { duration: '120s', target: 1000 },
            { duration: '30s', target: 0 },
          ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01', { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    // 응답 시간은 끊지 않고 합격선으로만 판정한다. 처리량 상한에 닿은 뒤의 모습까지 끝까지 본다.
    http_req_duration: ['p(95)<1000'],
  },
};

// 시드를 고정한 의사 난수(mulberry32). 같은 SEED면 회원마다 같은 상품이 배정된다.
function random(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function productOf(memberIndex) {
  return PRODUCT_POOL[Math.floor(random(SEED * 100003 + memberIndex) * PRODUCT_POOL.length)];
}

export function setup() {
  ensureMembers(MEMBERS);
  const members = loginAll(MEMBERS);
  // 같은 상품을 배정받은 회원끼리 묶어 장바구니를 준비한다.
  const groups = {};
  members.forEach((m, i) => {
    const productId = productOf(i);
    (groups[productId] = groups[productId] || []).push(i);
  });
  const items = new Array(members.length);
  Object.keys(groups).forEach((key) => {
    const productId = Number(key);
    const indexes = groups[productId];
    const carts = ensureCartItems(indexes.map((i) => members[i]), [productId]);
    indexes.forEach((i, k) => {
      items[i] = [carts[k][productId]];
    });
  });
  const perProduct = Object.values(groups).map((g) => g.length);
  console.log(`상품 ${Object.keys(groups).length}개에 회원 배정: 최소 ${Math.min(...perProduct)}명, 최대 ${Math.max(...perProduct)}명`);
  return { members: members.map((m, i) => ({ auth: m.auth, headers: m.headers, items: items[i] })) };
}

export default function (data) {
  const m = data.members[(exec.vu.idInTest - 1) % data.members.length];
  const jar = new http.CookieJar();

  const me = http.get(`${BASE}/api/members/me`, { headers: m.auth, jar, tags: { name: 'GET /api/members/me' } });
  check(me, { 'me 200': (r) => r.status === 200 });
  const cart = http.get(`${BASE}/api/cart-items`, { headers: m.auth, jar, tags: { name: 'GET /api/cart-items' } });
  check(cart, { 'cart 200': (r) => r.status === 200 });

  const order = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({ items: m.items.map((it) => ({ cartItemId: it.cartItemId, unitPrice: it.unitPrice, saleType: it.saleType })) }),
    {
      // Idempotency-Key(64자 이하)는 필수다. 반복마다 새 값을 만든다.
      headers: { ...m.headers, 'Idempotency-Key': `lt-${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${Date.now()}` },
      jar,
      tags: { name: 'POST /api/orders' },
    },
  );
  check(order, { 'order 201': (r) => r.status === 201 });

  if (order.status === 201) {
    const orderId = order.json('data.orderId');
    const checkout = http.get(`${BASE}/api/orders/${orderId}/checkout`, { headers: m.auth, jar, tags: { name: 'GET /api/orders/{orderId}/checkout' } });
    check(checkout, { 'checkout 200': (r) => r.status === 200 });
    const cancel = http.patch(`${BASE}/api/orders/${orderId}/cancel`, null, { headers: m.headers, jar, tags: { name: 'PATCH /api/orders/{orderId}/cancel' } });
    check(cancel, { 'cancel 200': (r) => r.status === 200 });
  }

  sleep(1 + Math.random() * 2);
}
