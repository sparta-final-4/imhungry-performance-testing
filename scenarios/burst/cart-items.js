// GET /api/cart-items(장바구니 조회) 같은 순간 몰림. 로그인이 필요해 login 조건으로만 측정한다.
//   회원의 장바구니는 지금 dev에 담겨 있는 그대로 읽는다(바꾸지 않는다).
// 실행: ./tools/run-burst.sh scenarios/burst/cart-items.js login   (회차·인원은 tools/run-burst.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { burstOptions, burstSetup, fireOnce, LOGIN } from '../../lib/burst.js';

const NAME = 'GET /api/cart-items';
if (!LOGIN) throw new Error('장바구니 조회는 로그인이 필요합니다. login 조건으로 실행하세요.');
export const options = burstOptions(NAME);

export function setup() {
  return burstSetup();
}

export default function (data) {
  fireOnce(data, `${BASE}/api/cart-items`, NAME);
}
