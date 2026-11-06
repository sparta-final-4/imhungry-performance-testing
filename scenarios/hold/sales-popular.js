// GET /api/sales/popular(메인 화면 지금 뜨는 할인) 한계 찾기. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   결과는 10초 캐시가 걸려 있어 대부분 캐시 적중이고 10초마다 한 번 미스가 난다. 캐시는 그대로 둔다.
// 실행: ./tools/run-hold.sh scenarios/hold/sales-popular.js guest|login   (단계·회차는 tools/run-hold.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { holdOptions, hit } from '../../lib/hold.js';

const NAME = 'GET /api/sales/popular';
export const options = holdOptions(NAME);

export default function () {
  hit(`${BASE}/api/sales/popular`, NAME);
}
