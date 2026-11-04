// POST /api/cart-items 속도: 회원마다 상품 하나씩 새 항목으로 담는 요청을 초당 요청 수를 단계별로 고정해 보낸다.
//   (회원, 상품) 조합을 한 번씩만 쓰므로 모든 요청이 같은 경로(상품·판매가 조회 + 새 항목 저장)이고, 같은 회원의 요청이 겹치지 않는다.
//   단계마다 시나리오를 따로 둬서 단계별 숫자를 요약에 보인다.
//   끝난 뒤 cart-add-verify.sql로 DB를 확인한다: 항목 수가 요약의 201 응답 수와 같고 수량이 모두 1이어야 한다.
//   다시 돌리기 전에는 cart-add-reset.sql로 되돌린다.
// 실행: ./tools/run.sh scenarios/cart-add/cart-add-burst.js
//   스모크: ./tools/run.sh -e SMOKE=1 -e MEMBERS=50 scenarios/cart-add/cart-add-burst.js   (초당 5 → 10건, 단계당 20초, 이 숫자는 기록하지 않는다)
//   옵션: -e RATES=50,100,250,500 -e STEP_SEC=15 -e WARMUP_SEC=10 -e MEMBERS=1000 -e MAX_VUS=600
//   필요한 (회원, 상품) 조합 수는 요청 수와 같다. 회원 수 × 상품 수보다 많으면 일부가 기존 항목의 수량 갱신으로 바뀐다.
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { BASE } from '../../lib/auth.js';
import { ensureMembers, loginAll } from '../../lib/prepare.js';

const SMOKE = __ENV.SMOKE === '1';
const MEMBERS = Number(__ENV.MEMBERS || 1000);
const RATES = (SMOKE ? '5,10' : __ENV.RATES || '50,100,250,500').split(',').map(Number);
const STEP_SEC = SMOKE ? 20 : Number(__ENV.STEP_SEC || 15);
const WARMUP_SEC = SMOKE ? 0 : Number(__ENV.WARMUP_SEC || 10); // 가장 낮은 단계 속도로 먼저 데우는 시간. 단계별 숫자와 따로 태그가 붙는다.
const MAX_DROPPED = Number(__ENV.MAX_DROPPED || 10000); // 못 따라간 요청이 이 수를 넘으면 자동 중단한다
const MAX_VUS = Number(__ENV.MAX_VUS || 600); // 요청이 밀리면 k6가 이 범위 안에서 VU를 늘린다. 닿으면 dropped_iterations가 생긴다.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// 담기 결과를 직접 센다. 요약에 이 이름으로 나온다.
const cartAddsCreated = new Counter('cart_adds_created'); // 201: 새 항목
const cartAddsUpdated = new Counter('cart_adds_updated'); // 200: 기존 항목 수량 갱신
const cartAddsRejected = new Counter('cart_adds_rejected'); // 4xx 거절. 응답 코드별로 태그가 붙는다
const cartAdds5xx = new Counter('cart_adds_5xx'); // 서버 오류. 0이어야 한다
const cartAdd5xxRate = new Rate('cart_add_5xx_rate');

// 단계마다 앞 단계가 쓴 조합 번호 다음부터 쓰도록, 시나리오 이름별 시작 번호를 미리 정한다.
// 시나리오 안의 반복 번호(iterationInTest)는 시나리오마다 0부터 다시 시작하기 때문이다.
// constant-arrival-rate는 속도 × 시간보다 1번 더(맨 처음 시각의 반복까지) 반복하므로 단계마다 1을 더해 번호가 겹치지 않게 한다.
const offsets = {};
let planned = 0;

// 단계 하나: 초당 rate건을 durationSec초 동안 고정해서 보낸다. 태그 step으로 단계를 구분한다.
function burstScenario(name, rate, startSec, durationSec, step) {
  offsets[name] = planned;
  planned += rate * durationSec + 1;
  return {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1s',
    duration: `${durationSec}s`,
    startTime: `${startSec}s`,
    preAllocatedVUs: Math.min(MAX_VUS, Math.max(20, rate * 2)),
    maxVUs: MAX_VUS,
    tags: { step },
  };
}

const scenarios = {};
// 각 항목의 첫 조건은 합격선(결과 표시용)이고, 두 번째 조건(abortOnFail)은 자동 중단이다.
// 자동 중단은 시작 30초 뒤부터, 지금까지의 누적 값이 기준을 넘으면 k6를 멈춘다(최근 구간만 보는 조건이 아니다).
const thresholds = {
  cart_add_5xx_rate: ['rate<0.01', { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
  'http_req_duration{api:cart-add}': ['p(95)<1000', { threshold: 'p(95)<5000', abortOnFail: true, delayAbortEval: '30s' }],
  // 한계를 넘어 못 따라간 요청이 MAX_DROPPED를 넘으면 더 올려도 새 정보가 없으므로 멈춘다.
  dropped_iterations: [{ threshold: `count<${MAX_DROPPED}`, abortOnFail: true, delayAbortEval: '20s' }],
};

let startSec = 0;
if (WARMUP_SEC > 0) {
  scenarios.warmup = burstScenario('warmup', RATES[0], 0, WARMUP_SEC, 'warmup');
  startSec = WARMUP_SEC;
}
RATES.forEach((rate) => {
  const name = `step_${rate}`;
  scenarios[name] = burstScenario(name, rate, startSec, STEP_SEC, String(rate));
  startSec += STEP_SEC;
  // 조건이 있어야 단계별 값이 요약에 나온다. count>=0은 항상 통과하는 표시용 조건이다.
  thresholds[`http_req_duration{api:cart-add,step:${rate}}`] = ['p(95)<1000'];
  thresholds[`http_reqs{api:cart-add,step:${rate}}`] = ['count>=0'];
  thresholds[`dropped_iterations{step:${rate}}`] = ['count>=0'];
  thresholds[`cart_adds_created{step:${rate}}`] = ['count>=0'];
  thresholds[`cart_adds_5xx{step:${rate}}`] = ['count>=0'];
});

export const options = {
  scenarios,
  thresholds,
  setupTimeout: '20m', // 회원 MEMBERS명의 가입·로그인이 오래 걸린다.
};

// 부하를 걸기 전 준비. 측정 시간에 들어가지 않는다.
// 로그인 쿠키는 15분 뒤 만료되므로 준비 시간과 측정 시간의 합이 그 안에 들어야 한다(넘으면 401이 요약에 거절로 보인다).
export function setup() {
  // 담을 상품은 목록 API로 실제 ID를 받는다(ID가 연속이 아니다).
  const list = http.get(`${BASE}/api/products?size=100`);
  const productIds = list.json('data.content').map((p) => p.productId);

  // 로그인·CSRF는 lib/prepare.js가 여러 명씩 동시에 보낸다. CSRF 헤더는 준비 때 한 번만 받아 둔다.
  // 요청마다 받으면 요청이 두 배가 되어 담기 부하만 측정하는 조건이 깨진다.
  ensureMembers(MEMBERS);
  const members = loginAll(MEMBERS).map((m) => m.headers);

  const capacity = MEMBERS * productIds.length;
  if (planned > capacity) {
    console.warn(`요청 ${planned}건이 (회원, 상품) 조합 ${capacity}개보다 많아 일부는 기존 항목의 수량 갱신이 됩니다.`);
  }
  return { members, productIds };
}

let loggedErrors = 0; // 가상 사용자마다 남긴 서버 오류 로그 수

// 요청마다 조합 번호 p를 정한다: 회원은 p를 회원 수로 나눈 나머지, 상품은 몫. 번호가 연속이라 같은 회원은 회원 수 요청에 한 번만 나온다.
export default function (data) {
  const p = offsets[exec.scenario.name] + exec.scenario.iterationInTest;
  const headers = data.members[p % data.members.length];
  const productId = data.productIds[Math.floor(p / data.members.length) % data.productIds.length];

  const res = http.post(`${BASE}/api/cart-items`, JSON.stringify({ productId, quantity: 1 }), {
    headers,
    // VU의 기본 쿠키 저장소가 응답 쿠키를 쌓아 우리가 붙인 쿠키와 겹치지 않게 요청마다 새로 쓴다.
    jar: new http.CookieJar(),
    tags: { api: 'cart-add' },
  });

  // 결과를 새 항목 / 수량 갱신 / 서버 오류 / 거절(응답 코드별)로 나눠 센다.
  cartAdd5xxRate.add(res.status >= 500);
  if (res.status === 201) {
    cartAddsCreated.add(1);
  } else if (res.status === 200) {
    cartAddsUpdated.add(1);
  } else if (res.status >= 500) {
    cartAdds5xx.add(1);
    // 서버 오류가 난 요청의 조합을 남긴다(같은 조합이 겹쳤는지 확인하려고). 로그가 넘치지 않게 가상 사용자마다 3건까지만 남긴다.
    if (loggedErrors++ < 3) {
      console.log(`5xx step=${exec.scenario.name} p=${p} member=${(p % data.members.length) + 1} productId=${productId} body=${String(res.body).slice(0, 120)}`);
    }
  } else {
    let code = `http_${res.status}`;
    try {
      code = res.json('error.code');
    } catch (_) {}
    cartAddsRejected.add(1, { code });
  }

  check(res, { 'no 5xx': (r) => r.status < 500 });
}
