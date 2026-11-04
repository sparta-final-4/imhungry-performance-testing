// 시나리오 A: 번개 드롭 재고 동시 주문 정확성.
//   번개 드롭 재고 LIMIT개에 회원 MEMBERS명이 같은 순간 주문한다.
//   기대: 주문 성공이 정확히 LIMIT건이고 나머지는 5xx 없이 거절된다.
//   응답이 아니라 DB 최종 상태로 판단한다 → 끝난 뒤 orders-accuracy-verify.sql을 실행한다.
//   다시 돌리기 전에는 orders-accuracy-reset.sql로 되돌린다.
// 실행: ./tools/run.sh scenarios/orders/orders-accuracy.js   (옵션: -e MEMBERS=100 -e LIMIT=10 -e PRODUCT_ID=16)
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, signUp, login, csrf } from '../../lib/auth.js';

const MEMBERS = Number(__ENV.MEMBERS || 100);
const LIMIT = Number(__ENV.LIMIT || 10);
// 번개 드롭을 걸 상품. 진행 중인 다른 행사가 없는 상품이어야 하고(있으면 등록이 409 SALE_001) 재고가 LIMIT 이상이어야 한다.
const PRODUCT_ID = Number(__ENV.PRODUCT_ID || 16);
// 번개 드롭 등록은 관리자만 할 수 있다. 로컬 시드의 관리자 계정이 기본값이고 -e 로 바꿀 수 있다.
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@example.com';
// 로컬 관리자 비밀번호는 저장소에 두지 않는다. -e ADMIN_PASSWORD=... 로 넘긴다.
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD 환경변수가 필요합니다 (-e ADMIN_PASSWORD=...)');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// 주문 결과를 직접 센다. 요약에 이 이름으로 나온다.
const ordersCreated = new Counter('orders_created'); // 주문 성공
const ordersRejected = new Counter('orders_rejected'); // 4xx 거절(품절 등). 응답 코드별로 태그가 붙는다
const orders5xx = new Counter('orders_5xx'); // 서버 오류. 0이어야 한다

export const options = {
  scenarios: {
    order_burst: {
      // 회원마다 가상 사용자 하나가 정확히 한 번씩 주문한다(같은 순간에 몰림).
      executor: 'per-vu-iterations',
      vus: MEMBERS,
      iterations: 1,
      maxDuration: '1m',
    },
  },
};

// 서울 시각 문자열(yyyy-MM-ddTHH:mm:ss). 서버가 서울 시각 기준이라 UTC에 9시간을 더해 만든다.
function seoulTime(offsetMs) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetMs).toISOString().slice(0, 19);
}

// 관리자로 번개 드롭을 등록한다. 시작 시각이 현재보다 과거면 거절되므로 3초 뒤로 잡는다.
function createFlashDrop() {
  const auth = login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const headers = { ...csrf(auth), ...JSON_HEADERS };
  const res = http.post(
    `${BASE}/api/admin/sale-events/flash-drop`,
    JSON.stringify({
      startsAt: seoulTime(3000),
      endsAt: seoulTime(30 * 60 * 1000),
      items: [{ productId: PRODUCT_ID, discountRate: 10, limitedQuantity: LIMIT }],
    }),
    { headers },
  );
  if (res.status !== 201) fail(`번개 드롭 등록 실패: ${res.status} ${res.body}`);
  console.log(`번개 드롭 등록: ${res.body}`);
}

// 부하를 걸기 전 준비. 측정 시간에 들어가지 않는다.
export function setup() {
  for (let i = 1; i <= MEMBERS; i++) signUp(i);

  createFlashDrop();
  sleep(5); // 시작 시각(3초 뒤)이 지나 번개 드롭이 진행 중이 되기를 기다린다.

  // 회원마다 번개 드롭 상품을 장바구니에 담고, 주문 요청에 필요한 값(장바구니 항목 번호·단가·할인 구분)을 받아 둔다.
  const members = [];
  for (let i = 1; i <= MEMBERS; i++) {
    const auth = login(i);
    const headers = { ...csrf(auth), ...JSON_HEADERS };

    const added = http.post(
      `${BASE}/api/cart-items`,
      JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }),
      { headers },
    );
    if (added.status >= 400) fail(`담기 실패 (member ${i}): ${added.status} ${added.body}`);

    // 주문 요청에는 장바구니에서 본 단가와 할인 구분을 같이 보내야 한다(주문 시점 값과 다르면 서버가 거절).
    const cart = http.get(`${BASE}/api/cart-items`, { headers: auth });
    const item = cart.json('data.items').find((it) => it.productId === PRODUCT_ID);
    if (!item) fail(`장바구니에서 상품을 못 찾음 (member ${i}): ${cart.body}`);

    members.push({
      auth,
      cartItemId: item.cartItemId,
      unitPrice: item.unitPrice,
      saleType: item.sale ? item.sale.type : null,
    });
  }
  return { members };
}

// 본 실행: 가상 사용자 번호(__VU)와 같은 번호의 회원이 한 번 주문한다.
export default function (data) {
  const me = data.members[__VU - 1];
  const headers = {
    ...csrf(me.auth),
    ...JSON_HEADERS,
    // 주문 요청에는 Idempotency-Key(64자 이하)가 필수다. 요청마다 새 값을 만든다.
    'Idempotency-Key': `loadtest-${__VU}-${Date.now()}`,
  };

  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({
      items: [{ cartItemId: me.cartItemId, unitPrice: me.unitPrice, saleType: me.saleType }],
    }),
    { headers },
  );

  // 결과를 성공 / 서버 오류 / 거절(응답 코드별)로 나눠 센다.
  if (res.status === 201 || res.status === 200) {
    ordersCreated.add(1);
  } else if (res.status >= 500) {
    orders5xx.add(1);
  } else {
    let code = 'unknown';
    try {
      code = res.json('error.code');
    } catch (_) {}
    ordersRejected.add(1, { code });
  }

  // 품절 거절(4xx)은 정상이고 5xx만 실패로 본다.
  check(res, { 'no 5xx': (r) => r.status < 500 });
}
