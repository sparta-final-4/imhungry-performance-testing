-- cart-add 시나리오를 다시 돌리기 전에 로컬 DB를 되돌린다. 로컬 전용. dev·main에서 실행하지 않는다.
-- 테스트 회원(loadtest-%)의 장바구니 항목과 장바구니를 지운다. 장바구니가 없는 상태에서 시작해야 처음 담기 동시 생성까지 재현된다.
-- 다른 회원의 장바구니와 주문은 건드리지 않는다.
-- 실행: docker exec -i data-server docker exec -i mysql mysql -u<사용자> -p<비밀번호> --default-character-set=utf8mb4 fridge_db < scenarios/cart-add/cart-add-reset.sql

DELETE ci FROM cart_items ci
  JOIN carts c ON c.id = ci.cart_id
  JOIN members m ON m.id = c.member_id
  WHERE m.email LIKE 'loadtest-%';

DELETE c FROM carts c
  JOIN members m ON m.id = c.member_id
  WHERE m.email LIKE 'loadtest-%';
