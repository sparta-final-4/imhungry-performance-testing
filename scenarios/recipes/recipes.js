// GET /api/recipes(레시피 목록)와 GET /api/recipes/{id}(레시피 상세) 읽기 부하.
//   목록(페이지), 키워드 목록, 상세를 섞어 호출한다. 로그인은 필요 없다.
//   카테고리 조회와 이번 달 많이 만든 레시피는 캐시가 걸린 API라 따로 있다(recipe-classifications.js, recipes-popular.js).
//   레시피가 많아야 의미가 있다(dev DB를 복원한 상태에서는 충분하다).
//   공통 부하 방식(초당 요청 수 단계 상승, SMOKE 모드, 자동 중단)은 lib/read.js에 있다.
// 실행: ./tools/run.sh scenarios/recipes/recipes.js   (스모크: ./tools/run.sh -e SMOKE=1 scenarios/recipes/recipes.js)
import http from 'k6/http';
import { BASE, readOptions, getJson } from '../../lib/read.js';

export const options = readOptions();

// 부하를 걸기 전에 목록 API로 실제 레시피 ID를 받아 온다(없는 ID의 상세는 404).
export function setup() {
  const res = http.get(`${BASE}/api/recipes?size=100`);
  return { ids: res.json('data.content').map((r) => r.recipeId) };
}

// 키워드 검색에 쓰는 단어. 레시피 이름에 포함되는지로 조회한다.
const KEYWORDS = ['찌개', '볶음', '국', '계란', '두부'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export default function (data) {
  // 호출 비율: 목록 50%, 키워드 목록 25%, 상세 25%.
  const roll = Math.random();
  if (roll < 0.5) {
    getJson(`${BASE}/api/recipes?page=${1 + Math.floor(Math.random() * 3)}&size=20`, 'GET /api/recipes');
  } else if (roll < 0.75) {
    getJson(`${BASE}/api/recipes?keyword=${encodeURIComponent(pick(KEYWORDS))}`, 'GET /api/recipes?keyword');
  } else {
    const id = pick(data.ids);
    getJson(`${BASE}/api/recipes/${id}`, 'GET /api/recipes/{id}');
  }
}
