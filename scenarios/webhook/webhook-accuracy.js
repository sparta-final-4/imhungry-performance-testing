// POST /api/webhooks/portone 정확성: 같은 웹훅(같은 webhook-id)이 동시에 여러 번 와도 한 번만 기록되는지, 서명이 틀린 요청은 거절되는지 본다.
//   IDS개의 webhook-id마다 CONCURRENCY개의 가상 사용자가 같은 순간에 같은 웹훅을 보낸다(결제와 매칭되지 않는 결제 완료 웹훅).
//   기대: 유효한 요청은 모두 200(중복 수신도 200으로 건너뜀), 서명이 틀린 요청은 모두 401, 5xx 0건.
//   응답이 아니라 DB 최종 상태로 판단한다 → 끝난 뒤 webhook-verify.sql: webhook_id마다 기록 1건, 서명이 틀린 요청의 기록 0건.
//   다시 돌리기 전에는 webhook-reset.sql로 지운다.
// 실행: ./tools/run.sh scenarios/webhook/webhook-accuracy.js   (옵션: -e IDS=20 -e CONCURRENCY=10)
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { unmatchedBody, postWebhook } from '../../lib/webhook.js';

const IDS = Number(__ENV.IDS || 20);
const CONCURRENCY = Number(__ENV.CONCURRENCY || 10);

const okCount = new Counter('webhook_ok'); // 유효한 요청의 200
const rejectedValid = new Counter('webhook_valid_not_200'); // 유효한데 200이 아닌 응답. 0이어야 한다
const badRejected = new Counter('webhook_bad_signature_401'); // 서명이 틀려 401로 거절
const badAccepted = new Counter('webhook_bad_signature_accepted'); // 서명이 틀렸는데 401이 아닌 응답. 0이어야 한다
const fiveXx = new Counter('webhook_5xx');

export const options = {
  scenarios: {
    duplicate: {
      executor: 'per-vu-iterations',
      vus: IDS * CONCURRENCY,
      iterations: 1,
      maxDuration: '1m',
    },
    bad_signature: {
      executor: 'per-vu-iterations',
      vus: IDS,
      iterations: 1,
      maxDuration: '1m',
    },
  },
};

// 실행마다 webhook-id가 겹치지 않게 시작할 때 한 번 정한 값을 모든 가상 사용자가 같이 쓴다.
export function setup() {
  return { run: __ENV.RUN_ID || String(Date.now()) };
}

export default function (data) {
  const RUN = data.run;
  const vu = exec.vu.idInTest;
  if (exec.scenario.name === 'bad_signature') {
    const n = (vu - 1) % IDS;
    const res = postWebhook(`lt-wh-bad-${RUN}-${n}`, unmatchedBody(`lt-nomatch-bad-${n}`), { badSignature: true, tag: 'webhook-bad' });
    if (res.status >= 500) fiveXx.add(1);
    if (res.status === 401) badRejected.add(1);
    else badAccepted.add(1);
    check(res, { 'bad signature is 401': (r) => r.status === 401 });
    return;
  }
  const n = (vu - 1) % IDS;
  const res = postWebhook(`lt-wh-acc-${RUN}-${n}`, unmatchedBody(`lt-nomatch-acc-${n}`), { tag: 'webhook-dup' });
  if (res.status >= 500) fiveXx.add(1);
  if (res.status === 200) okCount.add(1);
  else rejectedValid.add(1);
  check(res, { 'valid webhook is 200': (r) => r.status === 200 });
}
