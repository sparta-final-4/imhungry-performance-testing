// 상품 상세(비로그인) 진입: 가상 사용자(VU) 1,000명이 상품 상세 화면을 여는 상황. dev에서 확인했다.
// 요청은 dev 프론트를 브라우저로 열어 확인한 순서 그대로 보낸다.
//   1) GET /api/members/me: 로그인 확인. 비로그인이라 401이고, 이 응답이 XSRF-TOKEN 쿠키를 준다.
//   2) POST /api/auth/refresh: 토큰 갱신 시도. CSRF 헤더를 붙여 보내고 401이 돌아온다.
//   3) GET /api/products/{id}: 상품 상세. 상품은 시작할 때 목록 API로 받아 두고 매번 무작위로 고른다.
//   1)과 2)의 401은 비로그인 화면의 정상 응답이라 실패로 세지 않는다.
//   브라우저는 로그인 확인 전에 3)을 한 번 보냈다가 취소하고 다시 보내는데, 여기서는 한 번만 보낸다.
// 단계: 0 → 100명(30초) → 500명(60초) → 1,000명(60초) → 1,000명 유지(120초) → 0명(30초). 약 5분.
// 중단: 실패율 5% 초과 또는 p95 2초 초과가 30초 뒤부터 이어지면 멈춘다.
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { BASE } from '../../lib/auth.js';

const SMOKE = __ENV.SMOKE === '1';
const UNAUTHORIZED_OK = { responseCallback: http.expectedStatuses(401) };

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

export function setup() {
  const res = http.get(`${BASE}/api/products?page=1&size=100`, { tags: { name: 'setup' } });
  const ids = (res.json('data.content') || []).map((p) => p.productId);
  if (ids.length === 0) fail(`상품 목록을 받지 못했습니다: ${res.status}`);
  return { ids };
}

export default function ({ ids }) {
  const me = http.get(`${BASE}/api/members/me`, { ...UNAUTHORIZED_OK, tags: { name: 'GET /api/members/me' } });
  check(me, { 'me 401': (r) => r.status === 401 });

  const xsrf = http.cookieJar().cookiesForURL(`${BASE}/`)['XSRF-TOKEN'];
  const refresh = http.post(`${BASE}/api/auth/refresh`, null, {
    ...UNAUTHORIZED_OK,
    headers: xsrf ? { 'X-XSRF-TOKEN': xsrf[0] } : {},
    tags: { name: 'POST /api/auth/refresh' },
  });
  check(refresh, { 'refresh 401': (r) => r.status === 401 });

  const id = ids[Math.floor(Math.random() * ids.length)];
  const detail = http.get(`${BASE}/api/products/${id}`, { tags: { name: 'GET /api/products/{id}' } });
  check(detail, { 'detail 200': (r) => r.status === 200 });

  sleep(1 + Math.random() * 2);
}
