// GET /api/recipes/classifications(레시피 분류) 같은 순간 몰림. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   결과는 Redis에 1시간 캐시된다. 캐시 조건은 담당자와 정하기 전이라 지금은 캐시를 그대로 둔다.
// 실행: ./tools/run-burst.sh scenarios/burst/recipe-classifications.js guest|login   (회차·인원은 tools/run-burst.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { burstOptions, burstSetup, fireOnce } from '../../lib/burst.js';

const NAME = 'GET /api/recipes/classifications';
export const options = burstOptions(NAME);

export function setup() {
  return burstSetup();
}

export default function (data) {
  fireOnce(data, `${BASE}/api/recipes/classifications`, NAME);
}
