// dev.imhungry.click에 주문 부하 테스트용 상품을 등록한다. 같은 이름의 상품이 이미 있으면 그 번호만 알려 준다.
//   주문을 만들면 재고가 바로 빠지므로 기존 상품(재고 100개 안팎) 대신 재고 100,000개(등록 상한)짜리 상품을 쓴다.
//   관리자 비밀번호는 저장소와 대화에 두지 않는다. 터미널에서 환경변수로 넘긴다.
// 실행: BASE_URL=https://dev.imhungry.click k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD="$ADMIN_PASSWORD" scenarios/dev-prep/test-product.js
// 정리: 측정이 끝나면 관리자 화면이나 DELETE /api/admin/products/{번호}로 지운다.
import http from 'k6/http';
import { fail } from 'k6';
import { BASE, login, csrf } from '../../lib/auth.js';

const NAME = '부하 테스트용 상품';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL, ADMIN_PASSWORD 환경변수가 필요합니다');

export const options = { vus: 1, iterations: 1 };

export default function () {
  const headers = { ...csrf(login(ADMIN_EMAIL, ADMIN_PASSWORD)), 'Content-Type': 'application/json' };

  const list = http.get(`${BASE}/api/admin/products?page=1&size=100`, { headers });
  const found = (list.json('data.content') || []).find((p) => p.name === NAME);
  if (found) {
    console.log(`이미 있는 테스트 상품: ${found.productId}`);
    return;
  }

  const res = http.post(
    `${BASE}/api/admin/products`,
    JSON.stringify({ productType: 'MEALKIT', name: NAME, description: '부하 테스트에서 주문을 만들고 바로 취소하는 상품입니다.', price: 1000, stock: 100000, storage: 'REFRIGERATED', shelfDays: 7, mealkit: { servings: 1 } }),
    { headers },
  );
  if (res.status !== 201) fail(`상품 등록 실패: ${res.status} ${res.body}`);
  console.log(`테스트 상품 번호: ${res.json('data.productId')}`);
}
