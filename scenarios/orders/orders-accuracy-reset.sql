-- orders-accuracy.js 반복 실행 전에 로컬 DB를 되돌린다. 로컬 전용. dev·main에서 실행하지 않는다.
-- 테스트 회원(loadtest-%)의 주문·장바구니 항목을 지우고, 그 주문이 쓴 번개 드롭 행사를 지우고,
-- 지운 주문 수량만큼 상품 재고를 되돌린다. 다른 회원의 주문이나 다른 행사는 건드리지 않는다.
-- 실행: docker exec -i data-server docker exec -i mysql mysql -ufridge_user -p12345678 --default-character-set=utf8mb4 fridge_db < scenarios/orders/orders-accuracy-reset.sql

-- 지우기 전에 되돌릴 대상을 기억해 둔다.
CREATE TEMPORARY TABLE reset_items AS
SELECT DISTINCT oi.sale_event_item_id FROM order_items oi
  JOIN orders o ON o.id = oi.order_id JOIN members m ON m.id = o.member_id
  WHERE m.email LIKE 'loadtest-%' AND oi.sale_event_item_id IS NOT NULL;

CREATE TEMPORARY TABLE reset_stock AS
SELECT oi.product_id, SUM(oi.quantity) AS quantity FROM order_items oi
  JOIN orders o ON o.id = oi.order_id JOIN members m ON m.id = o.member_id
  WHERE m.email LIKE 'loadtest-%' GROUP BY oi.product_id;

CREATE TEMPORARY TABLE reset_events AS
SELECT DISTINCT sale_event_id FROM sale_event_items WHERE id IN (SELECT sale_event_item_id FROM reset_items);

UPDATE products p JOIN reset_stock rs ON rs.product_id = p.id SET p.stock = p.stock + rs.quantity;

DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id
  JOIN members m ON m.id = o.member_id WHERE m.email LIKE 'loadtest-%';
DELETE o FROM orders o JOIN members m ON m.id = o.member_id WHERE m.email LIKE 'loadtest-%';
DELETE ci FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
  JOIN members m ON m.id = c.member_id WHERE m.email LIKE 'loadtest-%';

DELETE FROM sale_event_items WHERE id IN (SELECT sale_event_item_id FROM reset_items);
DELETE FROM sale_events WHERE id IN (SELECT sale_event_id FROM reset_events)
  AND id NOT IN (SELECT sale_event_id FROM sale_event_items);
