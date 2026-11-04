// GET /api/products(상품 목록)와 GET /api/products/{id}(상품 상세) 읽기 부하.
//   목록(페이지), 키워드 검색 목록, 상세를 섞어 호출한다. 목록 한 페이지·상세마다 진행 중 할인 조회가 더해지는 비용을 본다.
//   로그인은 필요 없다. 공통 부하 방식(초당 요청 수 단계 상승, SMOKE 모드, 자동 중단)은 lib/read.js에 있다.
// 실행: ./tools/run.sh scenarios/products/products.js   (스모크: ./tools/run.sh -e SMOKE=1 scenarios/products/products.js)
import http from 'k6/http';
import { BASE, readOptions, getJson } from '../../lib/read.js';

export const options = readOptions();

// 상품 ID는 연속이 아니라서(없는 ID의 상세는 404) 부하를 걸기 전에 목록 API로 실제 ID를 받아 온다.
export function setup() {
  const res = http.get(`${BASE}/api/products?size=100`);
  return { ids: res.json('data.content').map((p) => p.productId) };
}

// 키워드 검색에 쓰는 단어. 로컬 시드 상품 이름 기준이다.
const KEYWORDS = ['대파', '두부', '양파', '우유', '계란', '밀키트'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export default function (data) {
  // 호출 비율: 목록 50%, 키워드 목록 20%, 상세 30%.
  const roll = Math.random();
  if (roll < 0.5) {
    getJson(`${BASE}/api/products?page=${1 + Math.floor(Math.random() * 3)}&size=20`, 'GET /api/products');
  } else if (roll < 0.7) {
    getJson(`${BASE}/api/products?keyword=${encodeURIComponent(pick(KEYWORDS))}`, 'GET /api/products?keyword');
  } else {
    const id = pick(data.ids);
    getJson(`${BASE}/api/products/${id}`, 'GET /api/products/{id}');
  }
}
