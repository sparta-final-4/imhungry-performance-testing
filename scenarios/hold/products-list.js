// GET /api/products(상품 목록) 한계 찾기. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   1·2쪽(20개씩)을 무작위로 연다(1차 측정과 같음).
// 실행: ./tools/run-hold.sh scenarios/hold/products-list.js guest|login   (단계·회차는 tools/run-hold.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { holdOptions, hit } from '../../lib/hold.js';

const NAME = 'GET /api/products';
export const options = holdOptions(NAME);

export default function () {
  const page = 1 + Math.floor(Math.random() * 2);
  hit(`${BASE}/api/products?page=${page}&size=20`, NAME);
}
