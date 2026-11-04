#!/usr/bin/env bash
# 캐시가 걸린 API를 캐시 없이 측정한다. 앱 소스코드는 건드리지 않고, 측정 중에 Redis 캐시 키를 계속 지운다.
#   ./tools/run-no-cache.sh <폴더>/<스크립트>.js [k6 옵션...]      (옵션은 run.sh와 같다)
# 한계: 서버가 DB에서 읽어 캐시를 채운 직후에 삭제가 따라오므로, 그 사이 요청은 캐시에 맞을 수 있다.
#       그래서 시작·끝의 Redis keyspace_hits/misses를 results/<스크립트 이름>-<시각>-cache.txt에 남긴다(서버 전체 값이라 참고용).
set -euo pipefail

REDIS_SERVER="${REDIS_SERVER:-data-server}"
REDIS_CONTAINER="${REDIS_CONTAINER:-redis}"
KEYS=(recipe:popular::6 recipe:popular::20 recipe:classifications::all)

dir="$(cd "$(dirname "$0")/.." && pwd)"   # 저장소 루트
mkdir -p "$dir/results"
stamp="$(date +%Y%m%d-%H%M%S)"
args=("$@")
script="${args[${#args[@]}-1]}"
note="$dir/results/$(basename "$script" .js)-$stamp-cache.txt"

stats() { docker exec "$REDIS_SERVER" docker exec "$REDIS_CONTAINER" redis-cli INFO stats | tr -d '\r' | grep -E '^keyspace_(hits|misses)'; }

echo "시작 전 Redis: $(stats | tr '\n' ' ')" | tee "$note"

# 키 삭제를 한 연결로 쉬지 않고 보낸다. 끝나면 이 연결을 닫아 삭제를 멈춘다.
yes "DEL ${KEYS[*]}" | docker exec -i "$REDIS_SERVER" docker exec -i "$REDIS_CONTAINER" redis-cli > /dev/null &
deleter=$!
trap 'kill "$deleter" 2>/dev/null || true' EXIT

# run.sh는 마지막 인자가 스크립트 이름이다. 결과 파일 이름 시각이 달라질 수 있어 같은 시각을 쓰지 않는다.
"$dir/tools/run.sh" "$@"

kill "$deleter" 2>/dev/null || true
echo "끝난 뒤 Redis: $(stats | tr '\n' ' ')" | tee -a "$note"
echo "캐시 기록: $note"
