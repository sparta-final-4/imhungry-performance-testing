// 장바구니 화면 진입(로그인): 가상 사용자(VU) 1,000명이 각자 자기 장바구니 화면을 여는 상황. dev.imhungry.click용이다.
//   화면이 보내는 요청: GET /api/members/me(로그인 확인, 200) → GET /api/cart-items.
//   가상 사용자 1명이 테스트 회원 1명을 맡는다(가상 사용자 번호 → 회원 번호). 장바구니에는 상품 16·17·19가 1개씩 있다.
//   준비: 회원은 scenarios/dev-prep/members.js로 미리 만든다. setup이 로그인하고 비어 있는 상품만 담는다.
//   로그인 쿠키는 15분 뒤 만료되므로 준비 시간과 측정 시간의 합이 그 안에 들어야 한다.
// 단계: 0 → 100명(30초) → 500명(60초) → 1,000명(60초) → 1,000명 유지(120초) → 0명(30초). 약 5분.
// 중단: 실패율 5% 초과 또는 p95 2초 초과가 30초 뒤부터 이어지면 멈춘다.
// 실행: BASE_URL=https://dev.imhungry.click ./tools/run.sh scenarios/cart-read/cart-page.js   (옵션: -e MEMBERS=1000 -e PRODUCT_IDS=16,17,19)
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { BASE } from '../../lib/auth.js';
import { ensureMembers, loginAll, ensureCartItems } from '../../lib/prepare.js';

const SMOKE = __ENV.SMOKE === '1';
const MEMBERS = Number(__ENV.MEMBERS || (SMOKE ? 10 : 1000));
const PRODUCT_IDS = (__ENV.PRODUCT_IDS || '16,17,19').split(',').map(Number);

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
  ensureCartItems(members, PRODUCT_IDS);
  return { members: members.map((m) => m.auth) };
}

export default function (data) {
  const auth = data.members[(exec.vu.idInTest - 1) % data.members.length];
  const params = { headers: auth, jar: new http.CookieJar() };

  const me = http.get(`${BASE}/api/members/me`, { ...params, tags: { name: 'GET /api/members/me' } });
  check(me, { 'me 200': (r) => r.status === 200 });

  const cart = http.get(`${BASE}/api/cart-items`, { ...params, tags: { name: 'GET /api/cart-items' } });
  check(cart, { 'cart 200': (r) => r.status === 200 });

  sleep(1 + Math.random() * 2);
}
