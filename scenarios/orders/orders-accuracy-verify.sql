-- orders-accuracy.js 실행 뒤 DB 상태 확인. 응답이 아니라 DB 최종 상태로 판단한다.
-- 실행: docker exec -i data-server docker exec -i mysql mysql -ufridge_user -p12345678 --default-character-set=utf8mb4 fridge_db < scenarios/orders/orders-accuracy-verify.sql
-- 아래 @product_id는 스크립트의 PRODUCT_ID(기본 16)와 같게 맞춘다.
SET @product_id = 16;

-- 가장 최근에 만든 번개 드롭 항목
SELECT id AS sale_event_item_id, limited_quantity, remaining_quantity
FROM sale_event_items WHERE product_id = @product_id ORDER BY id DESC LIMIT 1;

-- 기대: order_count = limited_quantity, remaining_quantity = 0 (음수 없음)
SELECT COUNT(*) AS order_count
FROM order_items oi
WHERE oi.sale_event_item_id = (SELECT MAX(id) FROM sale_event_items WHERE product_id = @product_id);

-- 상품 재고 (시작 재고 - 성공 주문 수여야 한다)
SELECT id, stock FROM products WHERE id = @product_id;
