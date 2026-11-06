// 한계 찾기의 로그인 조건에 쓸 쿠키를 만든다. 테스트 회원 1..MEMBERS가 로그인하고 회원마다 Cookie 헤더 값을 한 줄씩 출력한다.
//   tools/run-hold.sh가 회차마다 부른다(액세스 토큰이 15분이라 회차마다 새로 만든다). 직접 부를 일은 없다.
// 실행: BASE_URL=https://dev.imhungry.click k6 run -e MEMBERS=1000 scenarios/hold/login-dump.js
import { loginAll } from '../../lib/prepare.js';

const MEMBERS = Number(__ENV.MEMBERS || 1000);

export const options = { vus: 1, iterations: 1, setupTimeout: '10m' };

export default function () {
  loginAll(MEMBERS).forEach((m) => console.log(`AUTH_COOKIE=${m.auth.Cookie}`));
}
