// GET /api/products/{productId}(상품 상세) 같은 순간 몰림. 로그인 없이 열린 API라 guest, login 두 조건으로 측정한다.
//   setup에서 상품 목록 1쪽(100개)의 번호를 받아 무작위로 연다.
// 실행: ./tools/run-burst.sh scenarios/burst/product-detail.js guest|login   (회차·인원은 tools/run-burst.sh가 정한다)
import http from 'k6/http';
import { fail } from 'k6';
import { BASE } from '../../lib/auth.js';
import { burstOptions, burstSetup, fireOnce, pick } from '../../lib/burst.js';

const NAME = 'GET /api/products/{productId}';
export const options = burstOptions(NAME);

export function setup() {
  const res = http.get(`${BASE}/api/products?page=1&size=100`, { tags: { name: 'setup' } });
  const ids = (res.json('data.content') || []).map((p) => p.productId);
  if (ids.length === 0) fail(`상품 목록을 받지 못했습니다: ${res.status}`);
  return burstSetup({ ids });
}

export default function (data) {
  fireOnce(data, `${BASE}/api/products/${pick(data.ids)}`, NAME);
}
