// 같은 순간 몰림 공통 코드. scenarios/burst/*.js가 쓴다.
//   가상 사용자 USERS명(기본 1,000)이 준비를 마친 뒤 정해 둔 같은 시각에 API를 한 번씩 부른다.
//   판정: 대상 요청의 p95가 0.67초 이하이고 실패 0이면 통과(tools/run-burst.sh가 회차마다 판정).
//   LOGIN=1이면 setup에서 테스트 회원 1..USERS가 로그인하고, 가상 사용자마다 회원 쿠키를 붙인다.
//   첫 요청에는 HTTPS 연결 수립이 들어간다(앱을 처음 여는 사용자와 같게). PREWARM=1이면 같은 시각 전에
//   쿠키 없는 /api/auth/csrf를 한 번 보내 연결을 미리 맺어 두고, API 응답 시간만 본다.
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { BASE } from './auth.js';
import { loginAll } from './prepare.js';

export const P95_LIMIT_MS = 670; // 팀 합의 기준
export const USERS = Number(__ENV.USERS || 1000);
export const LOGIN = __ENV.LOGIN === '1';
const PREWARM = __ENV.PREWARM === '1';
const START_DELAY_MS = 10000; // setup이 끝난 뒤 모든 가상 사용자가 같은 시각에 보내도록 기다리는 시간

export function burstOptions(name) {
  return {
    setupTimeout: '10m',
    scenarios: {
      burst: { executor: 'per-vu-iterations', vus: USERS, iterations: 1, maxDuration: '2m' },
    },
    // 판정만 하고 끊지 않는다.
    thresholds: {
      [`http_req_duration{name:${name}}`]: [`p(95)<${P95_LIMIT_MS}`],
      [`http_req_failed{name:${name}}`]: ['rate==0'],
    },
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  };
}

// setup에서 부른다. extra는 API별로 필요한 값(상품 번호 등).
export function burstSetup(extra = {}) {
  const cookies = LOGIN ? loginAll(USERS).map((m) => m.auth.Cookie) : [];
  const startAt = Date.now() + START_DELAY_MS;
  console.log(`T0=${startAt} USERS=${USERS} LOGIN=${LOGIN} PREWARM=${PREWARM}`);
  return { ...extra, cookies, startAt };
}

// 가상 사용자 하나가 같은 시각을 기다렸다가 한 번 부른다.
export function fireOnce(data, url, name) {
  const jar = new http.CookieJar();
  const headers = LOGIN ? { Cookie: data.cookies[(exec.vu.idInTest - 1) % data.cookies.length] } : {};
  if (PREWARM) http.get(`${BASE}/api/auth/csrf`, { jar, tags: { name: 'prewarm' } });
  const wait = data.startAt - Date.now();
  if (wait > 0) sleep(wait / 1000);
  const res = http.get(url, { headers, jar, tags: { name }, timeout: '30s' });
  check(res, { 'status 200': (r) => r.status === 200 });
  return res;
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
