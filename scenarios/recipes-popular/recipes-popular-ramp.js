// GET /api/recipes/popular?size=6(메인 화면 이번 달 많이 만든 레시피) 단독: 가상 사용자(VU)를 1,000명까지 올린다. dev에서 확인했다.
//   다른 dev 측정(상품 목록, 화면 진입)과 같은 단계로 이 API 하나만 부른다. 로그인 확인 요청은 보내지 않는다.
//   가상 사용자 1명이 1–3초 쉬고 다시 부르는 것을 반복한다. 캐시(키 recipe:popular::6)가 채워진 상태라 캐시 적중 경로를 측정한다.
//   담당자가 정한 조건(동시 20명, 합격선 p95 < 500ms)은 recipes-popular.js가 따로 가진다.
// 단계: 0 → 100명(30초) → 500명(60초) → 1,000명(60초) → 1,000명 유지(120초) → 0명(30초). 약 5분.
// 중단: 실패율 5% 초과 또는 p95 2초 초과가 30초 뒤부터 이어지면 멈춘다.
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
  const res = http.get(`${BASE}/api/recipes/popular?size=6`, { tags: { name: 'GET /api/recipes/popular' } });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}
