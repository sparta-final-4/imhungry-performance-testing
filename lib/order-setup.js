// 번개 드롭 주문 시나리오가 같이 쓰는 준비 함수: 번개 드롭 등록, 회원마다 장바구니에 담기.
// 로그인·CSRF·회원 가입은 lib/auth.js를 쓴다.
import http from 'k6/http';
import { fail } from 'k6';
import { BASE, login, csrf } from './auth.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// 서울 시각 문자열(yyyy-MM-ddTHH:mm:ss). 서버가 서울 시각 기준이라 UTC에 9시간을 더해 만든다.
function seoulTime(offsetMs) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetMs).toISOString().slice(0, 19);
}

// 관리자로 번개 드롭을 등록한다. 시작 시각이 현재보다 과거면 거절되므로 3초 뒤로 잡는다.
// 등록한 뒤에는 시작 시각이 지나 진행 중이 되도록 호출하는 쪽에서 5초 정도 기다린다.
export function createFlashDrop({ productId, limit, adminEmail, adminPassword }) {
  const auth = login(adminEmail, adminPassword);
  const headers = { ...csrf(auth), ...JSON_HEADERS };
  const res = http.post(
    `${BASE}/api/admin/sale-events/flash-drop`,
    JSON.stringify({
      startsAt: seoulTime(3000),
      endsAt: seoulTime(30 * 60 * 1000),
      items: [{ productId, discountRate: 10, limitedQuantity: limit }],
    }),
    { headers },
  );
  if (res.status !== 201) fail(`번개 드롭 등록 실패: ${res.status} ${res.body}`);
  console.log(`번개 드롭 등록: ${res.body}`);
}

// 회원 1..count가 각자 번개 드롭 상품을 장바구니에 담는다.
// 주문 요청에 필요한 값(로그인 쿠키, 장바구니 항목 번호, 단가, 할인 구분)을 회원마다 모아 돌려준다.
// 주문 요청에는 장바구니에서 본 단가와 할인 구분을 같이 보내야 한다(주문 시점 값과 다르면 서버가 거절).
export function fillCarts(count, productId) {
  const members = [];
  for (let i = 1; i <= count; i++) {
    const auth = login(i);
    const headers = { ...csrf(auth), ...JSON_HEADERS };

    const added = http.post(`${BASE}/api/cart-items`, JSON.stringify({ productId, quantity: 1 }), { headers });
    if (added.status >= 400) fail(`담기 실패 (member ${i}): ${added.status} ${added.body}`);

    const cart = http.get(`${BASE}/api/cart-items`, { headers: auth });
    const item = cart.json('data.items').find((it) => it.productId === productId);
    if (!item) fail(`장바구니에서 상품을 못 찾음 (member ${i}): ${cart.body}`);

    members.push({
      auth,
      cartItemId: item.cartItemId,
      unitPrice: item.unitPrice,
      saleType: item.sale ? item.sale.type : null,
    });
    if (i % 100 === 0) console.log(`장바구니 준비 ${i}/${count}`);
  }
  return members;
}
