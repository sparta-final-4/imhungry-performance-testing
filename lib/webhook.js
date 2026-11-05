// PortOne 웹훅을 흉내 내서 서명한 요청을 만든다(표준 웹훅 방식: HMAC-SHA256(id.timestamp.본문), 비밀값은 whsec_ 뒤를 base64로 푼 값).
// 앱의 로컬 기본 웹훅 시크릿(application.yml의 PORTONE_WEBHOOK_SECRET 기본값)과 같은 값을 기본으로 쓴다. 다른 값을 쓰려면 -e WEBHOOK_SECRET=whsec_... 로 넘긴다.
import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { BASE } from './auth.js';

const SECRET = __ENV.WEBHOOK_SECRET || 'whsec_bG9jYWwtZHVtbXktd2ViaG9vay1zZWNyZXQ=';
const KEY = encoding.b64decode(SECRET.replace(/^whsec_/, ''), 'std');

// 결제와 매칭되지 않는 결제 완료 웹훅 본문. 앱은 서명을 검증하고 웹훅을 기록한 뒤 결제를 못 찾아 무시한다.
export function unmatchedBody(paymentId) {
  return JSON.stringify({
    type: 'Transaction.Paid',
    timestamp: new Date().toISOString(),
    data: { storeId: 'loadtest-store', paymentId, transactionId: `tx-${paymentId}` },
  });
}

export function postWebhook(webhookId, body, { badSignature = false, tag = 'webhook' } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = badSignature
    ? 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    : `v1,${crypto.hmac('sha256', KEY, `${webhookId}.${timestamp}.${body}`, 'base64')}`;
  return http.post(`${BASE}/api/webhooks/portone`, body, {
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    },
    tags: { name: tag },
  });
}
