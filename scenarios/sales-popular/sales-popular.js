// GET /api/sales/popular(메인 화면 지금 뜨는 할인) 읽기 부하.
//   요청마다 진행 중 행사 조회와 최근 7일 검색 클릭 집계(상품별 그룹)가 돌고 캐시는 없다.
//   클릭 이력이 많아야 집계 비용이 드러나므로 seed-search-clicks.sql로 먼저 채운다. 로그인은 필요 없다.
//   공통 부하 방식(초당 요청 수 단계 상승, SMOKE 모드, 자동 중단)은 lib/read.js에 있다.
// 실행: ./tools/run.sh scenarios/sales-popular/sales-popular.js   (스모크: ./tools/run.sh -e SMOKE=1 scenarios/sales-popular/sales-popular.js)
import { BASE, readOptions, getJson } from '../../lib/read.js';

export const options = readOptions();

export default function () {
  getJson(`${BASE}/api/sales/popular`, 'GET /api/sales/popular');
}
