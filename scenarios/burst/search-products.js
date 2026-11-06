// GET /api/search/products(상품 검색) 같은 순간 몰림. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   검색어는 KEYWORDS에서 무작위로 고른다(검색 결과 화면 1차 측정과 같은 목록).
// 실행: ./tools/run-burst.sh scenarios/burst/search-products.js guest|login   (회차·인원은 tools/run-burst.sh가 정한다)
import { BASE } from '../../lib/auth.js';
import { burstOptions, burstSetup, fireOnce, pick } from '../../lib/burst.js';

const NAME = 'GET /api/search/products';
const KEYWORDS = ['대파', '두부', '계란', '된장', '김치', '삼겹살', '밀키트'];
export const options = burstOptions(NAME);

export function setup() {
  return burstSetup();
}

export default function (data) {
  fireOnce(data, `${BASE}/api/search/products?sort=RELEVANCE&keyword=${encodeURIComponent(pick(KEYWORDS))}&page=1&size=16`, NAME);
}
