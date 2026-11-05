// POST /api/admin/sale-events/flash-drop: 번개 드롭 한 건을 등록한다(1회). 등록 요청의 응답 시간을 본다.
//   등록이 커밋되면 같은 요청 스레드 안에서 전체 일반 회원의 알림 요청을 만들어 Kafka에 발행한다(응답은 그 뒤에 나감).
//   알림이 모두 저장되는 시간과 개수는 이 스크립트가 아니라 tools/run-flash-drop.sh가 DB로 확인한다.
//   시작 시각을 START_MIN분 뒤로 잡아 측정 중에 시작 알림(STARTED)이 섞이지 않게 한다.
// 실행: tools/run-flash-drop.sh 로 돌린다(직접 돌리면 -e ADMIN_PASSWORD=... 필요).
import http from 'k6/http';
import { fail } from 'k6';
import { BASE, login, csrf } from '../../lib/auth.js';

const PRODUCT_ID = Number(__ENV.PRODUCT_ID || 16);
const LIMIT = Number(__ENV.LIMIT || 7); // 정리 SQL이 이 값으로 테스트 행사를 찾는다. 다른 시나리오와 겹치지 않는 값이다.
const START_MIN = Number(__ENV.START_MIN || 20);
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD 환경변수가 필요합니다 (-e ADMIN_PASSWORD=...)');

export const options = { vus: 1, iterations: 1 };

// 서울 시각 문자열(yyyy-MM-ddTHH:mm:ss). 서버가 서울 시각 기준이라 UTC에 9시간을 더해 만든다.
function seoulTime(offsetMs) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetMs).toISOString().slice(0, 19);
}

export default function () {
  const auth = login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const headers = { ...csrf(auth), 'Content-Type': 'application/json' };
  const res = http.post(
    `${BASE}/api/admin/sale-events/flash-drop`,
    JSON.stringify({
      startsAt: seoulTime(START_MIN * 60 * 1000),
      endsAt: seoulTime((START_MIN + 30) * 60 * 1000),
      items: [{ productId: PRODUCT_ID, discountRate: 10, limitedQuantity: LIMIT }],
    }),
    { headers, tags: { api: 'flash-drop-create' } },
  );
  if (res.status !== 201) fail(`번개 드롭 등록 실패: ${res.status} ${res.body}`);
  console.log(`FLASH_DROP_RESULT status=${res.status} duration_ms=${res.timings.duration.toFixed(1)} body=${res.body}`);
}
