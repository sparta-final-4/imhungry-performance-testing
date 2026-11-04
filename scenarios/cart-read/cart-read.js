// GET /api/cart-items: 회원이 로그인한 상태로 자기 장바구니를 조회한다.
//   로그인과 인증 요청이 되는지, 장바구니 조회(상품·할인 조회 포함)의 응답 시간을 본다.
//   테스트 회원 MEMBERS명의 로그인과 장바구니 준비는 setup에서 한다. 요청마다 회원을 돌아가며 고른다.
//   공통 부하 방식(초당 요청 수 단계 상승, SMOKE 모드, 자동 중단)은 lib/read.js에 있다.
// 실행: ./tools/run.sh scenarios/cart-read/cart-read.js   (스모크: ./tools/run.sh -e SMOKE=1 scenarios/cart-read/cart-read.js)
//   옵션: -e MEMBERS=100 -e PRODUCT_IDS=16,17,19 (단계는 -e RATES=200:30,500:60,1000:60,2000:60 처럼 속도:초)
//   고정 속도(비교용): -e PLATEAU=430 -e PLATEAU_SEC=120   (그 속도까지 30초 올린 뒤 120초 동안 고정)
import exec from 'k6/execution';
import { BASE, readOptions, getJson } from '../../lib/read.js';
import { ensureMembers, loginAll, fillCartsIfEmpty } from '../../lib/prepare.js';

const MEMBERS = Number(__ENV.MEMBERS || 100);

// 장바구니에 미리 담아 둘 상품 번호(기본: 상품 16·17·19). 장바구니가 비어 있으면 조회 비용이 안 드러난다.
const PRODUCT_IDS = (__ENV.PRODUCT_IDS || '16,17,19').split(',').map(Number);

export const options = readOptions();

// 부하를 걸기 전 준비. 측정 시간에 들어가지 않는다.
// 로그인·CSRF·장바구니 준비는 lib/prepare.js가 여러 명씩 동시에 보낸다.
// 로그인 쿠키는 15분 뒤 만료되므로 준비 시간과 측정 시간의 합이 그 안에 들어야 한다.
export function setup() {
  ensureMembers(MEMBERS);
  const members = loginAll(MEMBERS);
  fillCartsIfEmpty(members, PRODUCT_IDS);
  return { members: members.map((m) => m.auth) };
}

export default function (data) {
  const auth = data.members[exec.scenario.iterationInTest % data.members.length];
  getJson(`${BASE}/api/cart-items`, 'GET /api/cart-items', auth);
}
