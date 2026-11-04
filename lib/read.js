// 읽기 API(GET) 스크립트가 같이 쓰는 공통 부하 설정과 확인 함수.
import http from 'k6/http';
import { check } from 'k6';

export { BASE } from './auth.js';

// 부하 방식: 초당 요청 수를 단계별로 고정해 올린다(ramping-arrival-rate).
// 사용자 수(VU)를 고정하면 응답이 빨라질수록 더 많이 보내서 개선 전후를 비교할 수 없기 때문이다.
//   RATES  단계별 `초당 요청 수[:초]`(쉼표 구분). 기본 200:30,500:60,1000:60,2000:60(앱이 처리하는 한계를 찾으려는 범위)
//   STEP_SEC  단계에 시간을 따로 안 적었을 때의 시간(초). 기본 60
//   PLATEAU  0이 아니면 단계 상승 대신 이 속도까지 30초 동안 올린 뒤 PLATEAU_SEC초(기본 120) 동안 고정으로 유지한다. 개선 전후 비교용으로 안정된 p95를 보려는 것이다
//   MAX_DROPPED  못 따라간 요청(dropped_iterations)이 이 수를 넘으면 자동 중단. 기본 20000
//   SMOKE  1이면 초당 5 → 10건, 단계당 20초로 가볍게 먼저 돌린다(서버를 데우고 스크립트가 도는지 확인용, 이 숫자는 기록하지 않는다)
const SMOKE = __ENV.SMOKE === '1';
const STEP_SEC = SMOKE ? 20 : Number(__ENV.STEP_SEC || 60);
const STEPS = (SMOKE ? '5,10' : __ENV.RATES || '200:30,500:60,1000:60,2000:60')
  .split(',')
  .map((token) => {
    const [target, seconds] = token.split(':').map(Number);
    return { target, seconds: seconds || STEP_SEC };
  });
const PLATEAU = SMOKE ? 0 : Number(__ENV.PLATEAU || 0);
const PLATEAU_SEC = Number(__ENV.PLATEAU_SEC || 120);
const MAX_DROPPED = Number(__ENV.MAX_DROPPED || 20000);

export function readOptions() {
  return {
    scenarios: {
      read: {
        executor: 'ramping-arrival-rate',
        startRate: SMOKE ? 5 : 10,
        timeUnit: '1s',
        // 요청이 밀리면 k6가 VU를 이 범위 안에서 늘려 요청 수를 맞춘다. maxVUs에 닿으면 dropped_iterations가 생긴다.
        preAllocatedVUs: 50,
        maxVUs: 300,
        // 단계마다 목표 초당 요청 수까지 올리고, 마지막에 10초 동안 0으로 내린다(한계를 넘은 뒤 긴 내림 구간은 새 정보가 없다).
        // PLATEAU면 그 속도까지 30초 올린 뒤 PLATEAU_SEC초 동안 고정한다.
        stages: PLATEAU
          ? [
              { duration: '30s', target: PLATEAU },
              { duration: `${PLATEAU_SEC}s`, target: PLATEAU },
              { duration: '10s', target: 0 },
            ]
          : [...STEPS.map(({ target, seconds }) => ({ duration: `${seconds}s`, target })), { duration: '10s', target: 0 }],
      },
    },
    // 각 항목의 첫 조건은 합격선(결과 표시용)이고, 두 번째 조건(abortOnFail)은 자동 중단이다.
    // 자동 중단은 시작 30초 뒤부터, 지금까지의 누적 값이 기준을 넘으면 k6를 멈춘다(최근 구간만 보는 조건이 아니다).
    thresholds: {
      http_req_failed: ['rate<0.01', { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
      http_req_duration: ['p(95)<1000', { threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' }],
      // 한계를 넘어 못 따라간 요청이 MAX_DROPPED를 넘으면 더 올려도 새 정보가 없으므로 멈춘다.
      dropped_iterations: [{ threshold: `count<${MAX_DROPPED}`, abortOnFail: true, delayAbortEval: '20s' }],
    },
  };
}

// GET 요청 한 번과 공통 확인(상태 200, 응답의 success가 true).
// name을 주면 주소가 달라도(예: 상품 ID가 바뀜) 같은 이름으로 묶어 집계한다.
export function getJson(url, name, headers) {
  const response = http.get(url, { tags: { name }, headers });
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response success is true': (r) => {
      try {
        return r.json('success') === true;
      } catch (_) {
        return false;
      }
    },
  });
  return response;
}
