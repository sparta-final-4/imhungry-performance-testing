# 이번 달 많이 만든 레시피 부하 테스트: dev.imhungry.click 기준선 (담당자 조건, 동시 사용자 20명)

상태: 초안 · 측정 시각: 2026-11-05 18:06:50–18:07:36 · 도메인 담당자: 이현정

- 환경: `https://dev.imhungry.click`. k6는 집 회선에서 인터넷을 거쳐 보냈으므로 응답 시간에 그 왕복 시간이 들어 있습니다.
- 근거 자료
  - 스크립트: [`scenarios/recipes-popular/recipes-popular.js`](../../../scenarios/recipes-popular/recipes-popular.js)
  - k6 결과 화면: [`recipes-popular-20261105-180650.html`](recipes-popular-20261105-180650.html) (내려받아 브라우저로 엽니다)
  - 10초 단위 표: [`tools/timeline.py`](../../../tools/timeline.py)로 만들었습니다
- 같은 API를 가상 사용자(VU) 1,000명까지 올린 측정은 [ramp-baseline.md](ramp-baseline.md)에 있습니다.
- 미정 항목: 측정한 앱 커밋 해시. 합격선은 담당자가 정한 후보 값입니다.

## 1. 대상

| 항목 | 내용 |
|---|---|
| API | GET /api/recipes/popular?size=6 |
| 화면 | 메인 화면 이번 달 많이 만든 레시피 |
| 로그인 | 필요 없음 |

## 2. 측정 조건

- dev.imhungry.click의 데이터를 그대로 썼습니다.
- 이 API는 Redis 캐시(24시간)가 걸려 있고, dev.imhungry.click은 공용 서버라 캐시를 비우지 않았습니다. 그래서 이 측정은 **캐시 적중 경로**만 측정한 값입니다. 캐시 없는 상태는 로컬 보고서([../../local/recipes-popular/baseline.md](../../local/recipes-popular/baseline.md))에 있습니다.
- 부하 조건은 로컬 보고서와 같은 담당자 조건입니다.

## 3. 부하 조건

| 항목 | 값 |
|---|---|
| 동시 사용자 | 20명 (10초 동안 올림 → 30초 유지 → 5초 내림) |
| 요청 간격 | 요청이 끝난 뒤 1초 쉼 |
| 합격선 | p95 < 500ms, 실패율 < 1% |
| 반복 | 1회 |

## 4. 실행 방법

```bash
BASE_URL=https://dev.imhungry.click ./tools/run.sh scenarios/recipes-popular/recipes-popular.js
python3 tools/timeline.py results/dev/recipes-popular-<시각>.html
```

## 5. 결과

**합격선을 통과했습니다.** 749건 모두 200이었고(실패 0%), p95는 20.86ms로 합격선(500ms)보다 낮았습니다.

| p50 | p90 | p95 | p99 | 최대 | 요청 수 | 실패율 |
|---|---|---|---|---|---|---|
| 13.56ms | 17.87ms | 20.86ms | 37.71ms | 423.58ms | 749 | 0.00% |

- 최대 423.58ms는 시작 10초 안에 나온 요청입니다. 20명을 유지한 구간(20–40초)의 p95는 17–21ms였습니다.

<details><summary>10초 단위 전체 표</summary>

| 경과(초) | 가상 사용자 | 초당 요청 | 실패율 | p50 | p95 | p99 | 최대 |
|---|---|---|---|---|---|---|---|
| 10 | 18 | 10 | 0.00% | 17ms | 28ms | 68ms | 424ms |
| 20 | 20 | 20 | 0.00% | 14ms | 21ms | 26ms | 39ms |
| 30 | 20 | 20 | 0.00% | 13ms | 17ms | 36ms | 45ms |
| 40 | 20 | 20 | 0.00% | 13ms | 17ms | 43ms | 91ms |

</details>
