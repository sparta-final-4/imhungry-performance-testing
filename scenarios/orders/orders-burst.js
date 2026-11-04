// POST /api/orders 순간 몰림(속도). 번개 드롭 한정 수량 LIMIT개에 회원 MEMBERS명이 몰려 주문한다.
//   초당 요청 수를 단계별로 고정(constant-arrival-rate)하고, 단계마다 시나리오를 따로 둬서 단계별 숫자를 요약에 보인다.
//   대부분의 요청은 품절·구매 한도 초과로 거절된다. 거절(4xx)은 정상이고 5xx만 실패로 본다.
//   속도 숫자는 정확성이 맞은 뒤에만 기록한다 → 끝난 뒤 orders-accuracy-verify.sql로 DB 최종 상태를 확인한다.
//   다시 돌리기 전에는 orders-accuracy-reset.sql로 되돌린다.
// 실행: ./tools/run.sh scenarios/orders/orders-burst.js
//   스모크: ./tools/run.sh -e SMOKE=1 -e MEMBERS=50 scenarios/orders/orders-burst.js   (초당 5 → 10건, 단계당 20초, 이 숫자는 기록하지 않는다)
//   옵션: -e RATES=50:20,100:20,250:60,500:60 (속도:초) -e STEP_SEC=60 -e WARMUP_SEC=30 -e MEMBERS=1000 -e LIMIT=10 -e PRODUCT_ID=16 -e MAX_VUS=600 -e MAX_DROPPED=10000
//   고정 속도(비교용): -e RATES=350:120 -e WARMUP_SEC=30   (한 단계를 길게 유지해 안정된 p95를 본다)
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { BASE } from '../../lib/auth.js';
import { createFlashDrop } from '../../lib/order-setup.js';
import { ensureMembers, loginAll, addToCarts } from '../../lib/prepare.js';

const SMOKE = __ENV.SMOKE === '1';
const MEMBERS = Number(__ENV.MEMBERS || 1000);
const LIMIT = Number(__ENV.LIMIT || 10);
// 번개 드롭을 걸 상품. 진행 중인 다른 행사가 없어야 하고(있으면 등록이 409 SALE_001) 재고가 LIMIT 이상이어야 한다.
const PRODUCT_ID = Number(__ENV.PRODUCT_ID || 16);
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@example.com';
// 로컬 관리자 비밀번호는 저장소에 두지 않는다. -e ADMIN_PASSWORD=... 로 넘긴다.
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD 환경변수가 필요합니다 (-e ADMIN_PASSWORD=...)');

const STEP_SEC = SMOKE ? 20 : Number(__ENV.STEP_SEC || 60); // 단계에 시간을 따로 안 적었을 때 쓰는 기본 시간
// 단계는 `초당 요청 수[:초]`를 쉼표로 이어 적는다. 정보가 적은 낮은 단계는 짧게, 한계 근처는 길게 둔다.
//   기본 50:20,100:20,250:60,500:60  (낮은 단계 p95가 회차마다 10ms 안팎으로 같아 길게 돌 이유가 없다)
//   고정 속도로 안정된 p95를 보려면 한 단계만 길게: -e RATES=350:120
const STEPS = (SMOKE ? '5,10' : __ENV.RATES || '50:20,100:20,250:60,500:60')
  .split(',')
  .map((token) => {
    const [rate, seconds] = token.split(':').map(Number);
    return { rate, seconds: seconds || STEP_SEC };
  });
const WARMUP_SEC = SMOKE ? 0 : Number(__ENV.WARMUP_SEC || 30); // 가장 낮은 단계 속도로 먼저 데우는 시간. 단계별 숫자와 따로 태그가 붙는다.
const MAX_DROPPED = Number(__ENV.MAX_DROPPED || 10000); // 못 따라간 요청이 이 수를 넘으면 자동 중단한다
const MAX_VUS = Number(__ENV.MAX_VUS || 600); // 요청이 밀리면 k6가 이 범위 안에서 VU를 늘린다. 닿으면 dropped_iterations가 생긴다.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// 주문 결과를 직접 센다. 요약에 이 이름으로 나온다.
const ordersCreated = new Counter('orders_created'); // 주문 성공
const ordersRejected = new Counter('orders_rejected'); // 4xx 거절(품절 등). 응답 코드별로 태그가 붙는다
const orders5xx = new Counter('orders_5xx'); // 서버 오류. 0이어야 한다
const order5xxRate = new Rate('order_5xx_rate');

// 단계 하나: 초당 rate건을 durationSec초 동안 고정해서 보낸다. 태그 step으로 단계를 구분한다.
function burstScenario(rate, startSec, durationSec, step) {
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
  order_5xx_rate: ['rate<0.01', { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
  'http_req_duration{api:orders}': ['p(95)<2000', { threshold: 'p(95)<5000', abortOnFail: true, delayAbortEval: '30s' }],
  // 한계를 넘어 못 따라간 요청이 MAX_DROPPED를 넘으면 더 올려도 새 정보가 없으므로 멈춘다.
  dropped_iterations: [{ threshold: `count<${MAX_DROPPED}`, abortOnFail: true, delayAbortEval: '20s' }],
};

let startSec = 0;
if (WARMUP_SEC > 0) {
  scenarios.warmup = burstScenario(STEPS[0].rate, 0, WARMUP_SEC, 'warmup');
  startSec = WARMUP_SEC;
}
STEPS.forEach(({ rate, seconds }) => {
  scenarios[`step_${rate}`] = burstScenario(rate, startSec, seconds, String(rate));
  startSec += seconds;
  // 조건이 있어야 단계별 값이 요약에 나온다. count>=0은 항상 통과하는 표시용 조건이다.
  thresholds[`http_req_duration{api:orders,step:${rate}}`] = ['p(95)<2000'];
  thresholds[`http_reqs{api:orders,step:${rate}}`] = ['count>=0'];
  thresholds[`dropped_iterations{step:${rate}}`] = ['count>=0'];
  thresholds[`orders_5xx{step:${rate}}`] = ['count>=0'];
  thresholds[`orders_created{step:${rate}}`] = ['count>=0'];
});

// 거절 코드별 건수도 요약에 보인다. 품절 PRODUCT_002, 1인 한도 초과 CART_003. 그 밖의 거절은 orders_rejected 합계와의 차이로 안다.
['PRODUCT_002', 'CART_003'].forEach((code) => {
  thresholds[`orders_rejected{code:${code}}`] = ['count>=0'];
});

export const options = {
  scenarios,
  thresholds,
  setupTimeout: '20m', // 회원 MEMBERS명의 가입·로그인·담기가 오래 걸린다.
};

// 부하를 걸기 전 준비. 측정 시간에 들어가지 않는다.
// 로그인 쿠키는 15분 뒤 만료되므로 준비 시간과 측정 시간의 합이 그 안에 들어야 한다(넘으면 401이 요약에 보인다).
// 로그인·CSRF·장바구니 준비는 lib/prepare.js가 여러 명씩 동시에 보낸다.
export function setup() {
  ensureMembers(MEMBERS);
  // CSRF 헤더는 준비 때 한 번만 받아 둔다. 주문마다 받으면 요청이 두 배가 되어 주문 부하만 측정하는 조건이 깨진다.
  const members = loginAll(MEMBERS);

  createFlashDrop({ productId: PRODUCT_ID, limit: LIMIT, adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
  sleep(5); // 시작 시각(3초 뒤)이 지나 번개 드롭이 진행 중이 되기를 기다린다.

  const carts = addToCarts(members, PRODUCT_ID);
  return { members: members.map((m, i) => ({ headers: m.headers, ...carts[i] })) };
}

// 요청마다 회원을 돌아가며 한 명 고른다(같은 회원이 연달아 걸리지 않게 퍼진다).
export default function (data) {
  const n = exec.scenario.iterationInTest;
  const me = data.members[n % data.members.length];

  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({
      items: [{ cartItemId: me.cartItemId, unitPrice: me.unitPrice, saleType: me.saleType }],
    }),
    {
      // Idempotency-Key(64자 이하)는 필수다. 요청마다 새 값을 만든다.
      headers: { ...me.headers, 'Idempotency-Key': `lt-${exec.vu.idInTest}-${n}-${Date.now()}` },
      // VU의 기본 쿠키 저장소가 응답 쿠키를 쌓아 우리가 붙인 쿠키와 겹치지 않게 요청마다 새로 쓴다.
      jar: new http.CookieJar(),
      tags: { api: 'orders' },
    },
  );

  // 결과를 성공 / 서버 오류 / 거절(응답 코드별)로 나눠 센다.
  order5xxRate.add(res.status >= 500);
  if (res.status === 201 || res.status === 200) {
    ordersCreated.add(1);
  } else if (res.status >= 500) {
    orders5xx.add(1);
  } else {
    let code = `http_${res.status}`;
    try {
      code = res.json('error.code');
    } catch (_) {}
    ordersRejected.add(1, { code });
  }

  // 품절 거절(4xx)은 정상이고 5xx만 실패로 본다.
  check(res, { 'no 5xx': (r) => r.status < 500 });
}
