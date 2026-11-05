# 웹훅 정확성 테스트: 기준선 (중복 수신, 서명 오류)

상태: 초안 · 측정일: 2026-11-05 · 도메인 담당자: 최용범

- 근거 자료: 스크립트 [`scenarios/webhook/webhook-accuracy.js`](../../../scenarios/webhook/webhook-accuracy.js), 서명 [`lib/webhook.js`](../../../lib/webhook.js), DB 확인 [`webhook-verify.sql`](../../../scenarios/webhook/webhook-verify.sql), 되돌리기 [`webhook-reset.sql`](../../../scenarios/webhook/webhook-reset.sql). 환경과 실행 방법은 [README.md](../../../README.md)를 따릅니다. 원본 결과 파일은 저장소에 두지 않습니다.
- 미정 항목: 합격선, 측정한 앱 커밋 해시와 이 저장소의 커밋 해시.

## 1. 대상

| 항목 | 내용 |
|---|---|
| API | POST /api/webhooks/portone |
| 호출 주체 | PortOne 서버 (이 측정에서는 k6가 서명한 요청을 직접 보냄) |
| 인증 | 로그인이 아니라 헤더 서명(`webhook-id`, `webhook-timestamp`, `webhook-signature`) |
| 확인 대상 | 같은 웹훅이 동시에 여러 번 와도 한 번만 기록되는지, 서명이 틀린 요청이 거절되는지 |

## 2. 측정 조건

- 결제와 매칭되지 않는 결제 완료(`Transaction.Paid`) 웹훅입니다. 앱은 서명을 검증하고 웹훅을 DB에 기록한 뒤 결제를 못 찾아 무시합니다. 결제 조회나 PG 호출은 일어나지 않습니다.
- 서명은 표준 웹훅 방식(HMAC-SHA256)으로 만들었고, 앱의 로컬 기본 웹훅 시크릿과 같은 값을 썼습니다.
- webhook-id 20개마다 가상 사용자 10명이 같은 순간 같은 웹훅을 보냈습니다(총 200건). 별도로 서명이 틀린 요청 20건을 보냈습니다.
- 응답이 아니라 DB 최종 상태로 판단했습니다. 끝난 뒤 webhook-id별 기록 수와 서명이 틀린 요청의 기록 수를 읽었습니다.
- 회차마다 되돌리기 SQL로 웹훅 기록을 지운 뒤 시작했습니다.

## 3. 실행 방법

```bash
DB_USER=<사용자> DB_PASSWORD=<비밀번호> ./tools/run-stateful.sh \
  --reset scenarios/webhook/webhook-reset.sql --verify scenarios/webhook/webhook-verify.sql -- \
  scenarios/webhook/webhook-accuracy.js
```

## 4. 결과

3회 모두 기대한 대로였습니다.

| 회차 | 유효한 요청 | 200 응답 | 서명 오류 요청 | 401 응답 | 5xx | DB 기록(webhook-id 20개) | 서명 오류의 DB 기록 | p95 | 시작 전 부하 평균(1분) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 200 | 20 | 20 | 0 | 20 | 0 | 175ms | 3.94 |
| 2 | 200 | 200 | 20 | 20 | 0 | 20 | 0 | 391ms | 3.07 |
| 3 | 200 | 200 | 20 | 20 | 0 | 20 | 0 | 263ms | 2.23 |

- 같은 webhook-id의 중복 수신 200건이 모두 200으로 응답됐고, DB에는 id마다 1건씩 20건만 기록됐습니다(중복 저장 없음). 기록 상태는 모두 무시(IGNORED)입니다.
- 서명이 틀린 요청은 모두 401로 거절됐고 DB에 기록되지 않았습니다.
- 요청이 220건뿐이라 p95는 회차마다 175–391ms로 흔들립니다. 시작 전 호스트 부하 평균이 2.2–3.9로 앞선 측정(1–2)보다 높았습니다.
