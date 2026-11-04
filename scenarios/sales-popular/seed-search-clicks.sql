-- GET /api/sales/popular 측정용 시드. 최근 7일 검색 클릭 이력을 대량으로 넣는다. 로컬 전용.
-- 이 스크립트가 넣은 행은 keyword가 'loadtest-seed'라서 다시 실행하면 그 행만 지우고 다시 넣는다.
-- 실행: docker exec -i data-server docker exec -i mysql mysql -ufridge_user -p12345678 --default-character-set=utf8mb4 fridge_db < scenarios/sales-popular/seed-search-clicks.sql
SET @rows = 100000;
SET SESSION cte_max_recursion_depth = 200000;

DELETE FROM search_click_histories WHERE keyword = 'loadtest-seed';

-- 상품 번호를 1부터 매긴 뒤 클릭 번호를 상품 수로 나눈 나머지로 고르게 배분한다.
INSERT INTO search_click_histories (created_at, updated_at, keyword, member_id, product_id)
WITH RECURSIVE seq AS (
  SELECT 1 AS n UNION ALL SELECT n + 1 FROM seq WHERE n < @rows
),
ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn, COUNT(*) OVER () AS cnt FROM products
)
SELECT NOW(6) - INTERVAL FLOOR(RAND() * 7 * 24 * 3600) SECOND,
       NOW(6),
       'loadtest-seed',
       NULL,
       r.id
FROM seq JOIN ranked r ON r.rn = seq.n % r.cnt;

SELECT COUNT(*) AS loadtest_clicks FROM search_click_histories WHERE keyword = 'loadtest-seed';
