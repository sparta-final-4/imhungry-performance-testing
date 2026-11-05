// POST /api/webhooks/portone 속도: 결제와 매칭되지 않는 결제 완료 웹훅을 매번 새 webhook-id로 초당 요청 수를 단계별로 올려 보낸다.
//   앱은 서명을 검증하고 웹훅을 DB에 기록한 뒤 결제를 못 찾아 무시한다(결제 조회·PG 호출 없음).
//   끝난 뒤 webhook-verify.sql: 기록 수가 200 응답 수와 같아야 한다.
//   공통 부하 방식(초당 요청 수 단계 상승, SMOKE 모드, 자동 중단)은 lib/read.js에 있다.
// 실행: ./tools/run.sh -e RATES=200,500,1000,2000 scenarios/webhook/webhook-burst.js   (스모크: -e SMOKE=1)
import { check } from 'k6';
import exec from 'k6/execution';
import { readOptions } from '../../lib/read.js';
import { unmatchedBody, postWebhook } from '../../lib/webhook.js';

export const options = readOptions();

// 실행마다 webhook-id가 겹치지 않게 시작할 때 한 번 정한 값을 모든 가상 사용자가 같이 쓴다.
export function setup() {
  return { run: __ENV.RUN_ID || String(Date.now()) };
}

export default function (data) {
  const RUN = data.run;
  const n = exec.scenario.iterationInTest;
  const res = postWebhook(`lt-wh-burst-${RUN}-${n}`, unmatchedBody(`lt-nomatch-burst-${n % 1000}`), { tag: 'POST /api/webhooks/portone' });
  check(res, { 'status is 200': (r) => r.status === 200 });
}
