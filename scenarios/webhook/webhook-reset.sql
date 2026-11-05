-- webhook 시나리오 반복 실행 전에 로컬 DB를 되돌린다. 로컬 전용. dev·main에서 실행하지 않는다.
-- webhook_id가 'lt-wh-'로 시작하는 웹훅 기록만 지운다.
-- 실행: docker exec -i data-server docker exec -i mysql mysql -ufridge_user -p12345678 --default-character-set=utf8mb4 fridge_db < scenarios/webhook/webhook-reset.sql
DELETE FROM webhook_events WHERE webhook_id LIKE 'lt-wh-%';
