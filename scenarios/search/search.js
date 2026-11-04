// GET /api/search/recipes, GET /api/search/products 통합검색 읽기 부하.
//   검색어와 페이지를 바꿔 가며 호출한다. 검색은 Elasticsearch를 쓰므로 색인이 DB와 맞는지 먼저 확인한다
//   (curl -s "localhost:9200/_cat/indices?h=index,docs.count"). 로그인은 필요 없다.
//   공통 부하 방식(초당 요청 수 단계 상승, SMOKE 모드, 자동 중단)은 lib/read.js에 있다.
// 실행: ./tools/run.sh -e TARGET=recipes scenarios/search/search.js   (TARGET: recipes | products | both(기본, 번갈아 호출))
import { BASE, readOptions, getJson } from '../../lib/read.js';

export const options = readOptions();

const TARGET = __ENV.TARGET || 'both';
// 검색어. 결과가 있는 단어와 적은 단어를 섞었다.
const KEYWORDS = ['대파', '두부', '계란', '된장', '김치', '삼겹살', '밀키트'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export default function () {
  const keyword = encodeURIComponent(pick(KEYWORDS));
  const page = 1 + Math.floor(Math.random() * 2);
  // both이면 요청마다 레시피·상품 검색 중 하나를 반반 고른다.
  const kind = TARGET === 'both' ? (Math.random() < 0.5 ? 'recipes' : 'products') : TARGET;
  getJson(`${BASE}/api/search/${kind}?keyword=${keyword}&page=${page}&size=20`, `GET /api/search/${kind}`);
}
