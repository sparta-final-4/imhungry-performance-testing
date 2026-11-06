// GET /api/recipes/{recipeId}(레시피 상세) 같은 순간 몰림. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   setup에서 레시피 목록 1–3쪽(100개씩)의 번호를 받아 무작위로 연다.
// 실행: ./tools/run-burst.sh scenarios/burst/recipe-detail.js guest|login   (회차·인원은 tools/run-burst.sh가 정한다)
import http from 'k6/http';
import { fail } from 'k6';
import { BASE } from '../../lib/auth.js';
import { burstOptions, burstSetup, fireOnce, pick } from '../../lib/burst.js';

const NAME = 'GET /api/recipes/{recipeId}';
export const options = burstOptions(NAME);

export function setup() {
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const res = http.get(`${BASE}/api/recipes?page=${page}&size=100`, { tags: { name: 'setup' } });
    (res.json('data.content') || []).forEach((r) => ids.push(r.recipeId));
  }
  if (ids.length === 0) fail('레시피 목록을 받지 못했습니다');
  return burstSetup({ ids });
}

export default function (data) {
  fireOnce(data, `${BASE}/api/recipes/${pick(data.ids)}`, NAME);
}
