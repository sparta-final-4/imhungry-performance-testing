// 주문하고 결제 화면에서 나가기(로그인): 가상 사용자(VU) 1,000명이 장바구니에서 주문하고, 결제하지 않고 나가는 것을 반복한다. dev.imhungry.click용이다.
//   요청: GET /api/members/me, GET /api/cart-items(장바구니 화면) → POST /api/orders(주문하기)
//         → GET /api/orders/{orderId}/checkout(주문 확인 화면) → PATCH /api/orders/{orderId}/cancel(나가기).
//   주문을 만들면 재고가 빠지고, 나가기는 주문을 지우고 재고를 되돌린다. 장바구니 항목은 주문 뒤에도 남아 다음 반복에 다시 쓴다.
//   상품은 관리자 화면에서 등록한 테스트 상품(밀키트 29, 재료 30, 재고 각 2,000개, 행사 없음)이다. 주문 한 건에 두 상품을 1개씩 담고, 모든 주문이 같은 두 상품을 잡는다.
//   가상 사용자 1명이 테스트 회원 1명을 맡는다.
//   준비: 회원은 scenarios/dev-prep/members.js로 미리 만든다. setup이 로그인하고 장바구니에 테스트 상품이 없으면 1개씩 담는다.
// 단계: 0 → 100명(30초) → 500명(60초) → 1,000명(60초) → 1,000명 유지(120초) → 0명(30초). 약 5분.
// 중단: 실패율 5% 초과 또는 p95 2초 초과가 30초 뒤부터 이어지면 멈춘다.
// 실행: BASE_URL=https://dev.imhungry.click ./tools/run.sh scenarios/orders/order-ramp.js   (옵션: -e MEMBERS=1000 -e PRODUCT_IDS=29,30)
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { BASE } from '../../lib/auth.js';
import { ensureMembers, loginAll, ensureCartItems } from '../../lib/prepare.js';

const SMOKE = __ENV.SMOKE === '1';
const MEMBERS = Number(__ENV.MEMBERS || (SMOKE ? 10 : 1000));
const PRODUCT_IDS = (__ENV.PRODUCT_IDS || '29,30').split(',').map(Number);

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
    http_req_duration: ['p(95)<1000', { threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' }],
  },
};

export function setup() {
  ensureMembers(MEMBERS);
  const members = loginAll(MEMBERS);
  const carts = ensureCartItems(members, PRODUCT_IDS);
  return { members: members.map((m, i) => ({ auth: m.auth, headers: m.headers, items: PRODUCT_IDS.map((id) => carts[i][id]) })) };
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
