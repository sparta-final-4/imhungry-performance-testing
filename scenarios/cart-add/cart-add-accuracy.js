// POST /api/cart-items 정확성: 같은 회원이 같은 상품을 동시에 여러 번 담아도 수량이 빠짐없이 반영되는지 본다.
//   테스트 회원 MEMBERS명이 각자 같은 상품을 수량 1로 CONCURRENCY번씩 같은 순간에 담는다.
//   기대: 최종 수량이 성공(2xx)한 요청 수와 같다(수량 갱신 유실 없음). 응답이 아니라 DB 최종 상태로 판단한다.
//   → 끝난 뒤 cart-add-verify.sql로 DB 수량을 읽어 요약의 cart_add_ok 건수와 비교한다.
//   다시 돌리기 전에는 cart-add-reset.sql로 되돌린다(장바구니가 비어 있어야 첫 담기 동시 생성까지 재현된다).
// 실행: ./tools/run.sh scenarios/cart-add/cart-add-accuracy.js   (옵션: -e MEMBERS=20 -e CONCURRENCY=10 -e PRODUCT_ID=17)
//   상품은 진행 중인 번개 드롭이 없고 재고가 CONCURRENCY 이상인 일반 상품이어야 한다(회원 한 명이 담는 수량이 재고를 넘지 않게).
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE } from '../../lib/auth.js';
import { ensureMembers, loginAll } from '../../lib/prepare.js';

const MEMBERS = Number(__ENV.MEMBERS || 20);
const CONCURRENCY = Number(__ENV.CONCURRENCY || 10);
const PRODUCT_ID = Number(__ENV.PRODUCT_ID || 17);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// 담기 결과를 직접 센다. 요약에 이 이름으로 나온다.
const cartAddOk = new Counter('cart_add_ok'); // 성공(2xx). 201은 새 항목, 200은 기존 항목 수량 갱신
const cartAddRejected = new Counter('cart_add_rejected'); // 4xx 거절. 응답 코드별로 태그가 붙는다
const cartAdd5xx = new Counter('cart_add_5xx'); // 서버 오류. 같은 항목을 동시에 새로 만들 때의 제약 충돌 등이 여기 잡힌다

export const options = {
  scenarios: {
    concurrent_add: {
      // 회원마다 CONCURRENCY개의 가상 사용자가 정확히 한 번씩 같은 순간에 담는다.
      executor: 'per-vu-iterations',
      vus: MEMBERS * CONCURRENCY,
      iterations: 1,
      maxDuration: '1m',
    },
  },
  // 상태 코드별 건수를 요약에 보이게 한다(조건이 있어야 태그별 값이 나온다. count>=0은 항상 통과하는 표시용 조건).
  thresholds: {
    'cart_add_ok{status:201}': ['count>=0'],
    'cart_add_ok{status:200}': ['count>=0'],
  },
};

// 부하를 걸기 전 준비. 측정 시간에 들어가지 않는다.
// 로그인과 CSRF 헤더는 회원마다 한 번만 받아 둔다(요청마다 받으면 요청 수가 달라진다).
export function setup() {
  ensureMembers(MEMBERS);
  return { members: loginAll(MEMBERS).map((m) => m.headers) };
}

// 가상 사용자 번호로 회원을 정한다: 1~CONCURRENCY번은 1번 회원, 그다음 CONCURRENCY개는 2번 회원…
export default function (data) {
  const headers = data.members[Math.floor((__VU - 1) / CONCURRENCY)];

  const res = http.post(
    `${BASE}/api/cart-items`,
    JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }),
    {
      headers,
      // VU의 기본 쿠키 저장소가 응답 쿠키를 쌓아 우리가 붙인 쿠키와 겹치지 않게 요청마다 새로 쓴다.
      jar: new http.CookieJar(),
      tags: { api: 'cart-add' },
    },
  );

  if (res.status >= 200 && res.status < 300) {
    cartAddOk.add(1, { status: String(res.status) });
  } else if (res.status >= 500) {
    cartAdd5xx.add(1, { status: String(res.status) });
  } else {
    let code = `http_${res.status}`;
    try {
      code = res.json('error.code');
    } catch (_) {}
    cartAddRejected.add(1, { code });
  }

  // 정확성 판단은 DB 최종 상태로 한다. 여기서는 서버 오류가 없는지만 확인한다.
  check(res, { 'no 5xx': (r) => r.status < 500 });
}
