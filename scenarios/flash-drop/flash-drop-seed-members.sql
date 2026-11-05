-- 번개 드롭 알림 측정용: 일반 회원(USER, ACTIVE)을 합계 @target명이 될 때까지 늘린다. 로컬 전용.
-- 이 스크립트가 넣은 회원은 이메일이 'flash-seed-%'라서 flash-drop-clean-members.sql로 지울 수 있다. 로그인은 안 된다(비밀번호 해시가 가짜).
-- 실행: sed "s/@target = 10000/@target = 50000/" 처럼 목표를 바꿔서 넣는다.
--   docker exec -i data-server docker exec -i mysql mysql -ufridge_user -p12345678 --default-character-set=utf8mb4 fridge_db < scenarios/flash-drop/flash-drop-seed-members.sql
SET @target = 10000;
SET SESSION cte_max_recursion_depth = 200000;
SET @have = (SELECT COUNT(*) FROM members WHERE role = 'USER' AND status = 'ACTIVE');
SET @need = GREATEST(@target - @have, 0);
SET @start = COALESCE((SELECT MAX(CAST(SUBSTRING(email, 12) AS UNSIGNED)) FROM members WHERE email LIKE 'flash-seed-%'), 0);

INSERT INTO members (email, password_hash, nickname, role, status)
WITH RECURSIVE seq AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM seq WHERE n < @need)
SELECT CONCAT('flash-seed-', CAST(@start + n AS UNSIGNED), '@example.com'), 'x', CONCAT('fs', CAST(@start + n AS UNSIGNED)), 'USER', 'ACTIVE' FROM seq WHERE @need > 0;

SELECT COUNT(*) AS active_users FROM members WHERE role = 'USER' AND status = 'ACTIVE';
