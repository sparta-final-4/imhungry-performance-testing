-- GET /api/recipes/popular 측정용 시드. 최근 30일 요리 기록과 후기를 대량으로 넣는다. 로컬 전용.
-- 이 스크립트가 넣은 행은 요리 기록 memo, 후기 content가 'loadtest-seed'라서 다시 실행하면 그 행만 지우고 다시 넣는다.
-- 실행: docker exec -i data-server docker exec -i mysql mysql -ufridge_user -p12345678 --default-character-set=utf8mb4 fridge_db < scenarios/recipes-popular/seed-cooking-logs.sql
SET @logs = 100000;
SET @reviews = 5000;
SET SESSION cte_max_recursion_depth = 200000;

DELETE FROM cooking_logs WHERE memo = 'loadtest-seed';
DELETE FROM recipe_reviews WHERE content = 'loadtest-seed';

-- 요리 기록: 회원 번호와 레시피 번호를 번호 매겨 한 바퀴씩 돌려 고르게 배분하고, 시각은 최근 30일 안에서 무작위로 둔다.
INSERT INTO cooking_logs (created_at, updated_at, member_id, recipe_id, result, memo)
WITH RECURSIVE seq AS (
  SELECT 1 AS n UNION ALL SELECT n + 1 FROM seq WHERE n < @logs
),
m AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn, COUNT(*) OVER () AS cnt FROM members),
r AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn, COUNT(*) OVER () AS cnt FROM recipes)
SELECT NOW(6) - INTERVAL FLOOR(RAND() * 30 * 24 * 3600) SECOND,
       NOW(6),
       m.id,
       r.id,
       'SUCCESS',
       'loadtest-seed'
FROM seq
JOIN m ON m.rn = seq.n % m.cnt
JOIN r ON r.rn = FLOOR(seq.n / m.cnt) % r.cnt;

-- 후기: 회원과 레시피 조합이 겹치지 않게 앞에서부터 @reviews건. DB에 이미 있는 후기 조합은 건너뛴다.
INSERT INTO recipe_reviews (created_at, updated_at, member_id, recipe_id, rating, content)
SELECT NOW(6), NOW(6), m.id, r.id, 1 + (m.id + r.id) % 5, 'loadtest-seed'
FROM members m CROSS JOIN recipes r
WHERE NOT EXISTS (SELECT 1 FROM recipe_reviews x WHERE x.member_id = m.id AND x.recipe_id = r.id)
ORDER BY m.id, r.id
LIMIT 5000;

SELECT (SELECT COUNT(*) FROM cooking_logs WHERE memo = 'loadtest-seed') AS loadtest_cooking_logs,
       (SELECT COUNT(*) FROM recipe_reviews WHERE content = 'loadtest-seed') AS loadtest_reviews,
       (SELECT COUNT(DISTINCT recipe_id) FROM cooking_logs WHERE memo = 'loadtest-seed') AS recipes_cooked;
