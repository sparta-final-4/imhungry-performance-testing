# 주문 정확성 테스트: 기준선 (번개 드롭 재고 동시 주문)

상태: 초안 · 측정일: 2026-11-05 · 도메인 담당자: 장준혁

- 근거 자료
  - 스크립트: [`scenarios/orders/orders-accuracy.js`](../../../scenarios/orders/orders-accuracy.js)
  - k6 결과 화면: 만들지 않았습니다(이 측정은 DB 확인 결과로 판정합니다)
  - DB 확인: [`orders-accuracy-verify.sql`](../../../scenarios/orders/orders-accuracy-verify.sql)
  - 되돌리기: [`orders-accuracy-reset.sql`](../../../scenarios/orders/orders-accuracy-reset.sql)
  - 환경과 실행 방법: [README.md](../../../README.md)
- 미정 항목: 합격선, 측정한 앱 커밋 해시와 이 저장소의 커밋 해시.

## 1. 대상

| 항목 | 내용 |
|---|---|
| API | POST /api/orders |
| 상황 | 번개 드롭 한정 수량에 회원이 같은 순간 몰려 주문 |
| 로그인 | 필요 (회원 쿠키) |
| 확인 대상 | 주문 성공 건수가 한정 수량과 정확히 같은지, 나머지가 5xx 없이 거절되는지, DB 최종 상태 |

## 2. 측정 조건

- 번개 드롭 한정 수량 10개(상품 16, 재고 98)에 테스트 회원 100명이 각자 한 번씩 같은 순간에 주문했습니다.
- 응답이 아니라 DB 최종 상태로 판단했습니다. 끝난 뒤 행사 상품 남은 수량, 저장된 주문 수, 상품 재고를 읽었습니다.
- 회차마다 되돌리기 SQL로 주문·재고·행사를 원래대로 돌린 뒤 시작했습니다.

## 3. 실행 방법

```bash
DB_USER=<사용자> DB_PASSWORD=<비밀번호> ./tools/run-stateful.sh \
  --reset scenarios/orders/orders-accuracy-reset.sql --verify scenarios/orders/orders-accuracy-verify.sql -- \
  -e ADMIN_PASSWORD=<로컬 관리자 비밀번호> scenarios/orders/orders-accuracy.js
```

## 4. 결과

3회 모두 기대한 대로였습니다.

| 회차 | 주문 성공 | 거절(4xx) | 서버 오류(5xx) | 남은 수량 | DB 주문 수 | 상품 재고(98에서) | p95 | 시작 전 부하 평균(1분) |
|---|---|---|---|---|---|---|---|---|
| 1 | 10 | 90 | 0 | 0 | 10 | 88 | 251ms | 2.39 |
| 2 | 10 | 90 | 0 | 0 | 10 | 88 | 132ms | 2.77 |
| 3 | 10 | 90 | 0 | 0 | 10 | 88 | 110ms | 2.21 |

- 한정 수량보다 많이 팔리거나 재고가 음수가 되는 일이 없었습니다.
- p95가 회차마다 110–251ms로 흔들렸습니다. 요청이 100건뿐이라 한 회차의 지연이 크게 반영된 값입니다.
