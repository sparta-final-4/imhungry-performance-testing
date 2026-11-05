-- webhook 시나리오가 끝난 뒤 DB 상태 확인. 응답이 아니라 DB 최종 상태로 판단한다.
-- 정확성(webhook-accuracy.js): 기대 = 같은 webhook-id의 기록 1건(중복 0), 서명이 틀린 요청의 기록 0건.
SELECT COUNT(*) AS acc_rows, COUNT(DISTINCT webhook_id) AS acc_distinct_ids FROM webhook_events WHERE webhook_id LIKE 'lt-wh-acc-%';
SELECT COUNT(*) AS bad_signature_rows FROM webhook_events WHERE webhook_id LIKE 'lt-wh-bad-%';
-- 속도(webhook-burst.js): 기대 = 기록 수가 요약의 200 응답 수와 같다.
SELECT COUNT(*) AS burst_rows, COUNT(DISTINCT webhook_id) AS burst_distinct_ids FROM webhook_events WHERE webhook_id LIKE 'lt-wh-burst-%';
-- 처리 상태(결제와 매칭되지 않아 모두 IGNORED여야 한다).
SELECT process_status, COUNT(*) AS rows_by_status FROM webhook_events WHERE webhook_id LIKE 'lt-wh-%' GROUP BY process_status;
