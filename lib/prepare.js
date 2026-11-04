// 시나리오 준비 단계(setup)를 빠르게 하는 공용 함수. 회원마다 로그인·CSRF·장바구니 담기를 하나씩 순서대로 하면
// 회원 1,000명에 약 1.2~2분이 걸려서, PREPARE_BATCH명씩 묶어 동시에 보낸다(k6의 http.batch).
// 로그인은 서버에서 비밀번호 검증을 하느라 CPU를 쓰므로 동시에 보내도 서버 CPU 수 이상으로는 빨라지지 않는다.
// 로그인·CSRF·가입의 요청 형식은 lib/auth.js와 같다.
import http from 'k6/http';
import { check, fail } from 'k6';
import { BASE, PASSWORD, memberEmail, signUp } from './auth.js';

const BATCH = Number(__ENV.PREPARE_BATCH || 25);
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// 회원 1..count가 이미 있으면 가입 요청을 건너뛴다. 마지막 회원이 로그인되면 모두 가입된 것으로 본다.
export function ensureMembers(count) {
  const probe = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: memberEmail(count), password: PASSWORD }),
    { headers: JSON_HEADERS, jar: new http.CookieJar(), responseCallback: http.expectedStatuses({ min: 200, max: 499 }) },
  );
  if (probe.status === 200) return;
  for (let i = 1; i <= count; i++) signUp(i);
}

// 회원 1..count의 로그인 쿠키와 CSRF 헤더를 받아 [{ auth, headers }]로 돌려준다.
// auth는 GET 요청에, headers는 변경 요청(POST 등)에 쓴다.
export function loginAll(count) {
  const members = [];
  for (let start = 1; start <= count; start += BATCH) {
    const ids = [];
    for (let i = start; i < start + BATCH && i <= count; i++) ids.push(i);

    const logins = http.batch(
      ids.map((i) => [
        'POST',
        `${BASE}/api/auth/login`,
        JSON.stringify({ email: memberEmail(i), password: PASSWORD }),
        { headers: JSON_HEADERS, jar: new http.CookieJar() },
      ]),
    );
    const auths = logins.map((res, k) => {
      if (!check(res, { 'login 200': (r) => r.status === 200 })) fail(`login 실패 (member ${ids[k]}): ${res.status} ${res.body}`);
      const access = res.cookies.access_token && res.cookies.access_token[0].value;
      const refresh = res.cookies.refresh_token && res.cookies.refresh_token[0].value;
      return { Cookie: `access_token=${access}; refresh_token=${refresh}` };
    });

    // 서버는 XSRF-TOKEN 쿠키 값을 그대로 헤더로 받는다. 응답 본문의 token은 가려진 값이라 쓰면 403이 난다.
    const csrfs = http.batch(
      auths.map((auth) => ['GET', `${BASE}/api/auth/csrf`, null, { headers: auth, jar: new http.CookieJar() }]),
    );
    csrfs.forEach((res, k) => {
      const xsrf = res.cookies['XSRF-TOKEN'] && res.cookies['XSRF-TOKEN'][0].value;
      if (!xsrf) fail(`XSRF-TOKEN 쿠키를 못 받음 (member ${ids[k]}): ${res.status} ${res.body}`);
      members.push({
        auth: auths[k],
        headers: {
          ...auths[k],
          Cookie: `${auths[k].Cookie}; XSRF-TOKEN=${xsrf}`,
          [res.json('data.headerName')]: xsrf,
          ...JSON_HEADERS,
        },
      });
    });
  }
  return members;
}

// 장바구니가 비어 있는 회원에게만 productIds의 상품을 1개씩 담는다(다시 실행해도 수량이 계속 늘지 않게).
export function fillCartsIfEmpty(members, productIds) {
  for (let start = 0; start < members.length; start += BATCH) {
    const chunk = members.slice(start, start + BATCH);

    const lists = http.batch(
      chunk.map((m) => ['GET', `${BASE}/api/cart-items`, null, { headers: m.auth, jar: new http.CookieJar() }]),
    );
    const empty = chunk.filter((m, k) => lists[k].json('data.items').length === 0);

    productIds.forEach((productId) => {
      http.batch(
        empty.map((m) => ['POST', `${BASE}/api/cart-items`, JSON.stringify({ productId, quantity: 1 }), { headers: m.headers, jar: new http.CookieJar() }]),
      );
    });
  }
}

// 회원마다 같은 상품을 장바구니에 1개 담고, 주문 요청에 필요한 값(장바구니 항목 번호, 단가, 할인 구분)을 [{ cartItemId, unitPrice, saleType }]로 돌려준다.
// 주문 요청에는 장바구니에서 본 단가와 할인 구분을 같이 보내야 한다(주문 시점 값과 다르면 서버가 거절).
export function addToCarts(members, productId) {
  const carts = [];
  for (let start = 0; start < members.length; start += BATCH) {
    const chunk = members.slice(start, start + BATCH);

    const adds = http.batch(
      chunk.map((m) => ['POST', `${BASE}/api/cart-items`, JSON.stringify({ productId, quantity: 1 }), { headers: m.headers, jar: new http.CookieJar() }]),
    );
    adds.forEach((res, k) => {
      if (res.status >= 400) fail(`담기 실패 (member ${start + k + 1}): ${res.status} ${res.body}`);
    });

    const lists = http.batch(
      chunk.map((m) => ['GET', `${BASE}/api/cart-items`, null, { headers: m.auth, jar: new http.CookieJar() }]),
    );
    lists.forEach((res, k) => {
      const item = res.json('data.items').find((it) => it.productId === productId);
      if (!item) fail(`장바구니에서 상품을 못 찾음 (member ${start + k + 1}): ${res.body}`);
      carts.push({ cartItemId: item.cartItemId, unitPrice: item.unitPrice, saleType: item.sale ? item.sale.type : null });
    });
  }
  return carts;
}
