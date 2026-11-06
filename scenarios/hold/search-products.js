// GET /api/search/products(상품 검색) 한계 찾기. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   검색어는 KEYWORDS에서 무작위로 고른다(검색 결과 화면 1차 측정과 같은 목록).
// 실행: ./tools/run-hold.sh scenarios/hold/search-products.js guest|login   (단계·회차는 tools/run-hold.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { holdOptions, hit, pick } from '../../lib/hold.js';

const NAME = 'GET /api/search/products';
const KEYWORDS = ['대파', '두부', '계란', '된장', '김치', '삼겹살', '밀키트'];
export const options = holdOptions(NAME);

export default function () {
  const keyword = encodeURIComponent(pick(KEYWORDS));
  hit(`${BASE}/api/search/products?sort=RELEVANCE&keyword=${keyword}&page=1&size=16`, NAME);
}
