// GET /api/products(상품 목록) 같은 순간 몰림. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   1·2쪽(20개씩)을 무작위로 연다(1차 측정과 같음).
// 실행: ./tools/run-burst.sh scenarios/burst/products-list.js guest|login   (회차·인원은 tools/run-burst.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { burstOptions, burstSetup, fireOnce } from '../../lib/burst.js';

const NAME = 'GET /api/products';
export const options = burstOptions(NAME);

export function setup() {
  return burstSetup();
}

export default function (data) {
  const page = 1 + Math.floor(Math.random() * 2);
  fireOnce(data, `${BASE}/api/products?page=${page}&size=20`, NAME);
}
