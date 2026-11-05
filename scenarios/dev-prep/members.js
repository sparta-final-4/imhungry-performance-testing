// dev.imhungry.click에 테스트 회원(loadtest-1 ~ loadtest-N@example.com)을 만든다. 한 번만 실행하면 된다.
//   이미 있는 회원은 409로 건너뛴다. 장바구니·주문 시나리오는 이 회원으로 로그인한다.
//   가입은 서버에서 비밀번호 해시를 하느라 CPU를 쓰므로 PREPARE_BATCH명씩 묶어 보낸다(기본 25명).
// 실행: BASE_URL=https://dev.imhungry.click k6 run -e MEMBERS=1000 scenarios/dev-prep/members.js
import http from 'k6/http';
import { check } from 'k6';
import { BASE, PASSWORD, memberEmail } from '../../lib/auth.js';

const MEMBERS = Number(__ENV.MEMBERS || 1000);
const BATCH = Number(__ENV.PREPARE_BATCH || 25);

export const options = { vus: 1, iterations: 1, setupTimeout: '10m' };

export default function () {
  let created = 0;
  let existed = 0;
  for (let start = 1; start <= MEMBERS; start += BATCH) {
    const ids = [];
    for (let i = start; i < start + BATCH && i <= MEMBERS; i++) ids.push(i);
    const res = http.batch(
      ids.map((i) => [
        'POST',
        `${BASE}/api/members`,
        JSON.stringify({ email: memberEmail(i), password: PASSWORD, nickname: `loadtest${i}`, phone: `010-9000-${String(i).padStart(4, '0')}`, tastes: ['SALTY'] }),
        { headers: { 'Content-Type': 'application/json' }, responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 409) },
      ]),
    );
    res.forEach((r, k) => {
      if (r.status === 409) existed++;
      else if (check(r, { 'signup 2xx': (x) => x.status < 300 })) created++;
      else console.error(`가입 실패 (member ${ids[k]}): ${r.status} ${r.body}`);
    });
  }
  console.log(`새로 만든 회원 ${created}명, 이미 있던 회원 ${existed}명`);
}
