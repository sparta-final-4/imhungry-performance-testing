-- flash-drop-create.js 반복 실행 전에 로컬 DB를 되돌린다. 로컬 전용. dev·main에서 실행하지 않는다.
-- 한정 수량 7개(이 시나리오만 쓰는 값)인 번개 드롭 행사와 그 알림(FLASH_DROP_*)을 지운다. 다른 알림·행사는 건드리지 않는다.
-- 실행: docker exec -i data-server docker exec -i mysql mysql -ufridge_user -p12345678 --default-character-set=utf8mb4 fridge_db < scenarios/flash-drop/flash-drop-reset.sql
CREATE TEMPORARY TABLE reset_events AS
SELECT DISTINCT sale_event_id FROM sale_event_items WHERE limited_quantity = 7;

DELETE FROM notifications WHERE notification_type = 'FLASH_DROP'
  AND SUBSTRING_INDEX(SUBSTRING_INDEX(dedupe_key, ':', 2), ':', -1) IN (SELECT sale_event_id FROM reset_events);
DELETE FROM sale_event_items WHERE limited_quantity = 7;
DELETE FROM sale_events WHERE id IN (SELECT sale_event_id FROM reset_events)
  AND id NOT IN (SELECT sale_event_id FROM sale_event_items);
