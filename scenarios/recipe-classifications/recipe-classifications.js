// GET /api/recipes/classifications(레시피 분류·필터 조회) 읽기 부하.
//   팀 목록에는 /api/recipe/classifications로 적혀 있지만 실제 경로는 이 주소다. 로그인은 필요 없다.
//   이 API는 Redis 캐시(키 recipe:classifications::all)가 걸려 있어서, 캐시 없는 상태를 재려면 run-no-cache.sh로 실행한다.
//   공통 부하 방식(초당 요청 수 단계 상승, SMOKE 모드, 자동 중단)은 lib/read.js에 있다.
// 실행: ./tools/run-no-cache.sh scenarios/recipe-classifications/recipe-classifications.js   (스모크: ./tools/run-no-cache.sh -e SMOKE=1 scenarios/recipe-classifications/recipe-classifications.js)
import { BASE, readOptions, getJson } from '../../lib/read.js';

export const options = readOptions();

export default function () {
  getJson(`${BASE}/api/recipes/classifications`, 'GET /api/recipes/classifications');
}
