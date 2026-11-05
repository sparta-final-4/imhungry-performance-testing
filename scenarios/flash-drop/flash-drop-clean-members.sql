-- flash-drop-seed-members.sql이 넣은 회원과 그 알림을 지운다. 로컬 전용.
DELETE n FROM notifications n JOIN members m ON m.id = n.member_id WHERE m.email LIKE 'flash-seed-%';
DELETE FROM members WHERE email LIKE 'flash-seed-%';
