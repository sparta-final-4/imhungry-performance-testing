// GET /api/recipes/classifications(레시피 분류) 한계 찾기. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   결과는 Redis에 1시간 캐시된다. 캐시 조건은 담당자와 정하기 전이라 지금은 캐시를 그대로 둔다.
// 실행: ./tools/run-hold.sh scenarios/hold/recipe-classifications.js guest|login   (단계·회차는 tools/run-hold.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { holdOptions, hit } from '../../lib/hold.js';

const NAME = 'GET /api/recipes/classifications';
export const options = holdOptions(NAME);

export default function () {
  hit(`${BASE}/api/recipes/classifications`, NAME);
}
