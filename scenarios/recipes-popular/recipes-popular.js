// GET /api/recipes/popular?size=6(메인 첫 화면 인기 레시피) 부하 테스트. 이현정 님의 부하 조건 기준이다.
//   동시 사용자 20명(10초 동안 올림 → 30초 유지 → 5초 내림), 요청 간격 1초, 합격선 p95 < 500ms·실패율 < 1%.
//   요청마다 최근 30일 요리 기록 집계와 레시피·후기 조회가 돈다. 로그인은 필요 없다.
//   이 API는 Redis 캐시(키 recipe:popular::6)가 걸려 있어서, 캐시 없는 상태를 재려면 run-no-cache.sh로 실행한다.
//   요리 기록과 후기가 많아야 의미가 있으므로 seed-cooking-logs.sql로 먼저 채운다.
// 실행: ./tools/run-no-cache.sh scenarios/recipes-popular/recipes-popular.js   (캐시 있는 상태는 ./tools/run.sh scenarios/recipes-popular/recipes-popular.js)
import { sleep } from 'k6';
import { BASE, getJson } from '../../lib/read.js';

export const options = {
  // 사용자 수를 단계별로 올리는 방식이다(초당 요청 수를 고정하는 읽기 공통 부하와 다르다).
  stages: [
    { duration: '10s', target: 20 }, // 올림
    { duration: '30s', target: 20 }, // 유지
    { duration: '5s', target: 0 }, // 내림
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  getJson(`${BASE}/api/recipes/popular?size=6`, 'GET /api/recipes/popular');
  sleep(1); // 요청 간격 1초
}
