// GET /api/recipes/{recipeId}(레시피 상세) 한계 찾기. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   setup에서 레시피 목록 1–3쪽(100개씩)의 번호를 받아 무작위로 연다.
// 실행: ./tools/run-hold.sh scenarios/hold/recipe-detail.js guest|login   (단계·회차는 tools/run-hold.sh가 정한다)
import http from 'k6/http';
import { fail } from 'k6';
import { BASE } from '../../lib/auth.js';
import { holdOptions, hit, pick } from '../../lib/hold.js';

const NAME = 'GET /api/recipes/{recipeId}';
export const options = holdOptions(NAME);

export function setup() {
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const res = http.get(`${BASE}/api/recipes?page=${page}&size=100`, { tags: { name: 'setup' } });
    (res.json('data.content') || []).forEach((r) => ids.push(r.recipeId));
  }
  if (ids.length === 0) fail('레시피 목록을 받지 못했습니다');
  return { ids };
}

export default function ({ ids }) {
  hit(`${BASE}/api/recipes/${pick(ids)}`, NAME);
}
