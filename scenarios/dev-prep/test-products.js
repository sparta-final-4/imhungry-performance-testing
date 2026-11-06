// dev.imhungry.click에 상품 분산 주문 부하 테스트용 상품 COUNT개를 등록한다. 이미 같은 이름이 있으면 등록하지 않고 번호만 모은다.
//   이름은 '부하 테스트용 분산 상품 01'처럼 번호를 붙이고, 재고는 등록 상한인 100,000개다. 일반 상품 등록이라 회원 알림은 가지 않는다.
//   끝나면 상품 번호를 쉼표로 이어 출력한다. order-ramp-spread.js의 PRODUCT_POOL에 그대로 넣는다.
//   관리자 비밀번호는 저장소와 대화에 두지 않는다. 터미널에서 환경변수로 넘긴다.
// 실행: BASE_URL=https://dev.imhungry.click k6 run -e COUNT=50 scenarios/dev-prep/test-products.js   (ADMIN_EMAIL, ADMIN_PASSWORD 환경변수 필요)
// 정리: 측정이 끝나면 관리자 화면이나 DELETE /api/admin/products/{번호}로 지운다.
import http from 'k6/http';
import { fail } from 'k6';
import { BASE, login, csrf } from '../../lib/auth.js';

const PREFIX = '부하 테스트용 분산 상품 ';
const COUNT = Number(__ENV.COUNT || 50);
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL, ADMIN_PASSWORD 환경변수가 필요합니다');

export const options = { vus: 1, iterations: 1, setupTimeout: '5m' };

function existingByName(headers) {
  const byName = {};
  for (let page = 1; page <= 50; page++) {
    const res = http.get(`${BASE}/api/admin/products?page=${page}&size=100`, { headers });
    if (res.status !== 200) fail(`관리자 상품 목록 실패: ${res.status} ${res.body}`);
    const content = res.json('data.content') || [];
    content.forEach((p) => {
      if (p.name.startsWith(PREFIX)) byName[p.name] = p.productId;
    });
    if (content.length < 100) break;
  }
  return byName;
}

export default function () {
  const headers = { ...csrf(login(ADMIN_EMAIL, ADMIN_PASSWORD)), 'Content-Type': 'application/json' };
  const byName = existingByName(headers);
  const ids = [];
  for (let i = 1; i <= COUNT; i++) {
    const name = PREFIX + String(i).padStart(2, '0');
    if (byName[name]) {
      ids.push(byName[name]);
      continue;
    }
    const res = http.post(
      `${BASE}/api/admin/products`,
      JSON.stringify({ productType: 'MEALKIT', name, description: '부하 테스트에서 주문을 만들고 바로 취소하는 상품입니다.', price: 1000, stock: 100000, storage: 'REFRIGERATED', shelfDays: 7, mealkit: { servings: 1 } }),
      { headers },
    );
    if (res.status !== 201) fail(`상품 등록 실패 (${name}): ${res.status} ${res.body}`);
    ids.push(res.json('data.productId'));
  }
  console.log(`PRODUCT_POOL=${ids.join(',')}`);
}
