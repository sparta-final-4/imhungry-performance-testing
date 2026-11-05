// 장바구니 담기와 빼기(로그인): 가상 사용자(VU) 1,000명이 상품을 담고, 장바구니 화면에서 그 상품을 빼는 것을 반복한다. dev.imhungry.click용이다.
//   요청: POST /api/cart-items(담기) → GET /api/members/me, GET /api/cart-items(장바구니 화면) → DELETE /api/cart-items?cartItemIds=(선택 삭제).
//   매번 빼므로 담기는 늘 새 항목을 저장하는 경로이고, 장바구니가 커지지 않는다.
//   가상 사용자 1명이 테스트 회원 1명을 맡는다. 같은 회원의 장바구니를 여러 가상 사용자가 동시에 건드리지 않는다.
//   상품은 행사가 없는 상품 18(PRODUCT_ID)이다. 장바구니 담기는 재고를 바꾸지 않는다.
//   준비: 회원은 scenarios/dev-prep/members.js로 미리 만든다. setup이 로그인하고, 이전 실행이 남긴 상품 18 항목을 뺀다.
// 단계: 0 → 100명(30초) → 500명(60초) → 1,000명(60초) → 1,000명 유지(120초) → 0명(30초). 약 5분.
// 중단: 실패율 5% 초과 또는 p95 2초 초과가 30초 뒤부터 이어지면 멈춘다.
// 실행: BASE_URL=https://dev.imhungry.click ./tools/run.sh scenarios/cart-add/cart-add-ramp.js   (옵션: -e MEMBERS=1000 -e PRODUCT_ID=18)
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { BASE } from '../../lib/auth.js';
import { ensureMembers, loginAll, removeFromCarts } from '../../lib/prepare.js';

const SMOKE = __ENV.SMOKE === '1';
const MEMBERS = Number(__ENV.MEMBERS || (SMOKE ? 10 : 1000));
const PRODUCT_ID = Number(__ENV.PRODUCT_ID || 18);

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
  removeFromCarts(members, PRODUCT_ID);
  return { members };
}

export default function (data) {
  const m = data.members[(exec.vu.idInTest - 1) % data.members.length];
  const jar = new http.CookieJar();

  const add = http.post(`${BASE}/api/cart-items`, JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }), {
    headers: m.headers, jar, tags: { name: 'POST /api/cart-items' },
  });
  check(add, { 'add 201': (r) => r.status === 201 });

  const me = http.get(`${BASE}/api/members/me`, { headers: m.auth, jar, tags: { name: 'GET /api/members/me' } });
  check(me, { 'me 200': (r) => r.status === 200 });
  const cart = http.get(`${BASE}/api/cart-items`, { headers: m.auth, jar, tags: { name: 'GET /api/cart-items' } });
  check(cart, { 'cart 200': (r) => r.status === 200 });

  const item = cart.status === 200 ? cart.json('data.items').find((it) => it.productId === PRODUCT_ID) : null;
  if (item) {
    const del = http.del(`${BASE}/api/cart-items?cartItemIds=${item.cartItemId}`, null, {
      headers: m.headers, jar, tags: { name: 'DELETE /api/cart-items' },
    });
    check(del, { 'delete 200': (r) => r.status === 200 });
  }

  sleep(1 + Math.random() * 2);
}
