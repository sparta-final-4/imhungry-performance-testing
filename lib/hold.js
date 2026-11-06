// 읽기 API 한계 찾기 공통 코드. scenarios/hold/*.js가 쓴다.
//   한 번 실행 = 한 단계: 가상 사용자 VUS명이 DURATION 동안 API 하나만 1–3초 쉬며 반복해서 부른다.
//   단계를 올리며 p95 0.67초를 처음 넘는 단계에서 멈추는 일은 tools/run-hold.sh가 한다.
//   LOGIN=1이면 tools/run-hold.sh가 미리 만든 로그인 쿠키 파일(AUTH_FILE)을 읽어 회원마다 쿠키를 붙인다.
//   로그인한 요청은 열린 API라도 인증 필터가 세션을 조회하고 UPDATE한다. 로그인 안 함과 비교하려고 두 조건을 나눈다.
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';

export const P95_LIMIT_MS = 670; // 팀 합의 기준
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '60s';
export const LOGIN = __ENV.LOGIN === '1';

// 로그인 쿠키 파일: 한 줄에 회원 하나의 Cookie 헤더 값. init 단계에서만 open()할 수 있다.
const AUTH_COOKIES = LOGIN ? open(__ENV.AUTH_FILE).split('\n').filter((l) => l) : [];
if (LOGIN && AUTH_COOKIES.length === 0) throw new Error('LOGIN=1이면 AUTH_FILE(로그인 쿠키 파일)이 필요합니다. tools/run-hold.sh로 실행하세요.');

// name: 판정할 요청 이름(태그). 이 이름의 p95가 요약(summary-export)에 나오도록 threshold를 건다.
export function holdOptions(name) {
  return {
    scenarios: {
      step: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '10s' },
    },
    thresholds: {
      // 응답 시간은 판정만 하고 끊지 않는다. 실패율 5% 초과에서만 끊는다.
      [`http_req_duration{name:${name}}`]: [`p(95)<${P95_LIMIT_MS}`],
      http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }],
    },
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  };
}

// 이 가상 사용자가 쓸 요청 옵션. 로그인 조건이면 회원 쿠키를 붙인다(가상 사용자 수가 회원 수보다 많으면 돌려 쓴다).
export function params(name) {
  const p = { tags: { name } };
  if (LOGIN) p.headers = { Cookie: AUTH_COOKIES[(exec.vu.idInTest - 1) % AUTH_COOKIES.length] };
  return p;
}

export function hit(url, name) {
  const res = http.get(url, params(name));
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
  return res;
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
