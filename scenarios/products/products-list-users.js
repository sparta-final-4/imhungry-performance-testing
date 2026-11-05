// GET /api/products(상품 목록): 가상 사용자(VU) 1,000명이 상품 목록을 둘러보는 상황. 로그인은 필요 없다. 로컬과 dev 모두에서 쓴다.
//   가상 사용자 1명이 목록 한 페이지를 보고 1–3초 쉰 뒤 다시 보는 것을 반복한다(가상 사용자 수 고정 방식).
//   단계: 0 → 100명(30초) → 500명(60초) → 1,000명(60초) → 1,000명 유지(120초) → 0명(30초). 약 5분.
//   중단: 실패율 5% 초과 또는 p95 2초 초과가 30초 뒤부터 이어지면 멈춘다.
// 실행: ./tools/run.sh scenarios/products/products-list-users.js                       (로컬)
//       BASE_URL=https://dev.imhungry.click ./tools/run.sh scenarios/products/products-list-users.js   (dev, 결과는 results/dev/)
//   스모크: -e SMOKE=1 (10명, 30초)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE } from '../../lib/auth.js';

const SMOKE = __ENV.SMOKE === '1';

export const options = {
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

export default function () {
  const page = 1 + Math.floor(Math.random() * 2);
  const res = http.get(`${BASE}/api/products?page=${page}&size=20`, { tags: { name: 'GET /api/products' } });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}
