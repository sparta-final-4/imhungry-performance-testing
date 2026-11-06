// GET /api/cart-items(장바구니 조회) 한계 찾기. 로그인이 필요해 login 조건으로만 측정한다.
//   회원의 장바구니는 지금 dev에 담겨 있는 그대로 읽는다(바꾸지 않는다).
// 실행: ./tools/run-hold.sh scenarios/hold/cart-items.js login   (단계·회차는 tools/run-hold.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { holdOptions, hit } from '../../lib/hold.js';

const NAME = 'GET /api/cart-items';
export const options = holdOptions(NAME);

export default function () {
  hit(`${BASE}/api/cart-items`, NAME);
}
