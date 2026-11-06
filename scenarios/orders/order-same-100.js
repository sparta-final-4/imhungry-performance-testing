// 한 상품 동시 주문: 회원 MEMBERS명(기본 100)이 같은 순간 같은 상품 하나를 1개씩 주문한다. dev.imhungry.click용이다.
//   목표: 5xx 0, 시간 초과 0, 재고 정확(DB로 확인), 주문하기 p95 1초 이하. 전체 처리 시간(동시에 보낸 시각부터 마지막 응답까지)은 기록한다.
//   경우 A(재고 충분): STOCK을 주지 않으면 상품 재고를 바꾸지 않는다. 경우 B(재고 10개): -e STOCK=10 이면 setup이 관리자로 재고를 10으로 바꾼다.
//   일반 상품을 쓴다(번개 드롭은 dev에서 회원 알림이 가서 쓰지 않는다). 품절 거절(409)은 정상 응답으로 센다.
//   주문 뒤 CANCEL_AFTER_SEC초에 모두 나가기(취소)를 해 재고를 되돌린다. 그 사이에 DB를 읽어 재고와 결제 대기 주문 수를 확인한다.
//   준비: 회원은 scenarios/dev-prep/members.js, 상품은 scenarios/dev-prep/test-products.js로 미리 만든다. setup이 상품이 장바구니에 없으면 1개 담는다.
// 실행: BASE_URL=https://dev.imhungry.click ./tools/run.sh -e PRODUCT_ID=31 [-e STOCK=10] scenarios/orders/order-same-100.js
//   ADMIN_EMAIL, ADMIN_PASSWORD 환경변수가 필요하다(재고·가격 확인과 STOCK 설정).
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, login, csrf } from '../../lib/auth.js';
import { loginAll, ensureCartItems } from '../../lib/prepare.js';

const MEMBERS = Number(__ENV.MEMBERS || 100);
const PRODUCT_ID = Number(__ENV.PRODUCT_ID || 31);
const STOCK = __ENV.STOCK === undefined ? null : Number(__ENV.STOCK);
const START_DELAY_MS = 5000; // setup이 끝난 뒤 모든 가상 사용자가 같은 시각에 보내도록 기다리는 시간
const CANCEL_AFTER_SEC = Number(__ENV.CANCEL_AFTER_SEC || 20);
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL, ADMIN_PASSWORD 환경변수가 필요합니다');

const created = new Counter('orders_created'); // 201
const soldOut = new Counter('orders_rejected_409'); // 품절 등 409
const serverErrors = new Counter('orders_5xx'); // 0이어야 한다
const otherStatus = new Counter('orders_other_status'); // 그 밖의 응답(시간 초과는 status 0)

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

export const options = {
  setupTimeout: '5m',
  scenarios: {
    burst: { executor: 'per-vu-iterations', vus: MEMBERS, iterations: 1, maxDuration: '2m' },
  },
  // 판정만 하고 끊지 않는다.
  thresholds: {
    'http_req_duration{name:POST /api/orders}': ['p(95)<1000'],
    orders_5xx: ['count==0'],
    orders_other_status: ['count==0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

function admin() {
  return { ...csrf(login(ADMIN_EMAIL, ADMIN_PASSWORD)), 'Content-Type': 'application/json' };
}

export function setup() {
  const adminHeaders = admin();
  if (STOCK !== null) {
    const res = http.patch(`${BASE}/api/admin/products/${PRODUCT_ID}`, JSON.stringify({ stock: STOCK }), { headers: adminHeaders });
    if (res.status !== 200) fail(`재고 설정 실패: ${res.status} ${res.body}`);
  }
  const product = http.get(`${BASE}/api/admin/products/${PRODUCT_ID}`, { headers: adminHeaders });
  if (product.status !== 200) fail(`상품 조회 실패: ${product.status} ${product.body}`);
  console.log(`상품 ${PRODUCT_ID}: 재고 ${product.json('data.stock')}, 상태 ${product.json('data.status')}`);

  const members = loginAll(MEMBERS);
  const carts = ensureCartItems(members, [PRODUCT_ID]);
  const startAt = Date.now() + START_DELAY_MS;
  console.log(`T0=${startAt}`);
  return { startAt, members: members.map((m, i) => ({ auth: m.auth, headers: m.headers, item: carts[i][PRODUCT_ID] })) };
}

export default function (data) {
  const m = data.members[exec.vu.idInTest - 1];
  const wait = data.startAt - Date.now();
  if (wait > 0) sleep(wait / 1000);

  const order = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({ items: [{ cartItemId: m.item.cartItemId, unitPrice: m.item.unitPrice, saleType: m.item.saleType }] }),
    {
      headers: { ...m.headers, 'Idempotency-Key': `same-${exec.vu.idInTest}-${data.startAt}` },
      tags: { name: 'POST /api/orders' },
      timeout: '30s',
    },
  );
  if (order.status === 201) created.add(1);
  else if (order.status === 409) soldOut.add(1);
  else if (order.status >= 500) serverErrors.add(1);
  else otherStatus.add(1);
  check(order, { 'order 201 or 409': (r) => r.status === 201 || r.status === 409 });

  // DB 확인이 끝날 때까지 기다렸다가 성공한 주문을 취소해 재고를 되돌린다.
  const untilCancel = data.startAt + CANCEL_AFTER_SEC * 1000 - Date.now();
  if (untilCancel > 0) sleep(untilCancel / 1000);
  if (order.status === 201) {
    const cancel = http.patch(`${BASE}/api/orders/${order.json('data.orderId')}/cancel`, null, { headers: m.headers, tags: { name: 'PATCH /api/orders/{orderId}/cancel' } });
    check(cancel, { 'cancel 200': (r) => r.status === 200 });
  }
}
