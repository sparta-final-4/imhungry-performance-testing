// GET /api/sales/popular(메인 화면 지금 뜨는 할인) 같은 순간 몰림. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   결과는 10초 캐시가 걸려 있다. 캐시는 그대로 둔다.
// 실행: ./tools/run-burst.sh scenarios/burst/sales-popular.js guest|login   (회차·인원은 tools/run-burst.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { burstOptions, burstSetup, fireOnce } from '../../lib/burst.js';

const NAME = 'GET /api/sales/popular';
export const options = burstOptions(NAME);

export function setup() {
  return burstSetup();
}

export default function (data) {
  fireOnce(data, `${BASE}/api/sales/popular`, NAME);
}
