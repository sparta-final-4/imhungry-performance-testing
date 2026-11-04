-- cart-add 시나리오가 끝난 뒤 DB 상태 확인. 응답이 아니라 DB 최종 상태로 판단한다. 테스트 회원(loadtest-%)만 본다.
-- 실행: docker exec -i data-server docker exec -i mysql mysql -u<사용자> -p<비밀번호> --default-character-set=utf8mb4 fridge_db < scenarios/cart-add/cart-add-verify.sql
-- 아래 @product_id는 cart-add-accuracy.js의 PRODUCT_ID(기본 17)와 같게 맞춘다.
SET @product_id = 17;

-- 정확성(cart-add-accuracy.js): 그 상품의 항목 수, 수량 합, 수량 최소·최대, 회원 수.
-- 기대: 수량 합 = 요약의 cart_add_ok 건수. 모자라면 그만큼 갱신이 유실된 것이다.
SELECT COUNT(*) AS cart_items,
       COALESCE(SUM(ci.quantity), 0) AS total_quantity,
       MIN(ci.quantity) AS min_quantity,
       MAX(ci.quantity) AS max_quantity,
       COUNT(DISTINCT c.member_id) AS members
FROM cart_items ci
  JOIN carts c ON c.id = ci.cart_id
  JOIN members m ON m.id = c.member_id
WHERE m.email LIKE 'loadtest-%' AND ci.product_id = @product_id;

-- 속도(cart-add-burst.js): 전체 항목 수와 수량. 기대: 항목 수 = 요약의 201 응답 수(cart_adds_created), 수량 최소·최대 = 1.
SELECT COUNT(*) AS cart_items,
       COALESCE(SUM(ci.quantity), 0) AS total_quantity,
       MIN(ci.quantity) AS min_quantity,
       MAX(ci.quantity) AS max_quantity,
       COUNT(DISTINCT c.member_id) AS members
FROM cart_items ci
  JOIN carts c ON c.id = ci.cart_id
  JOIN members m ON m.id = c.member_id
WHERE m.email LIKE 'loadtest-%';

-- 회원마다 장바구니가 하나여야 한다(둘 이상이면 처음 담기가 동시에 장바구니를 중복으로 만든 것이다).
SELECT COUNT(*) AS members_with_multiple_carts
FROM (SELECT c.member_id FROM carts c JOIN members m ON m.id = c.member_id
      WHERE m.email LIKE 'loadtest-%' GROUP BY c.member_id HAVING COUNT(*) > 1) d;

-- 같은 장바구니에 같은 상품이 둘 이상인 항목(유니크 제약이 있어 0이어야 한다).
SELECT COUNT(*) AS duplicated_items
FROM (SELECT ci.cart_id, ci.product_id FROM cart_items ci
        JOIN carts c ON c.id = ci.cart_id JOIN members m ON m.id = c.member_id
      WHERE m.email LIKE 'loadtest-%' GROUP BY ci.cart_id, ci.product_id HAVING COUNT(*) > 1) d;
