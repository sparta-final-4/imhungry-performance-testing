#!/usr/bin/env bash
# DB 상태를 바꾸는 시나리오 한 회차를 안전하게 돌린다: 앱 확인 → 되돌리기 → 실행 → DB 확인 → 되돌리기 → 앱 확인.
#   ./tools/run-stateful.sh --reset <되돌리기.sql> [--verify <확인.sql>] -- <run.sh에 넘길 인자...>
# 예) DB_USER=<사용자> DB_PASSWORD=<비밀번호> ./tools/run-stateful.sh \
#       --reset scenarios/orders/orders-accuracy-reset.sql --verify scenarios/orders/orders-accuracy-verify.sql -- \
#       -e ADMIN_PASSWORD=<로컬 관리자 비밀번호> scenarios/orders/orders-burst.js
# 환경변수(기본값): DB_SERVER(data-server, MySQL이 든 서버 컨테이너), DB_CONTAINER(mysql), DB_NAME(fridge_db), DB_USER·DB_PASSWORD(필수),
#   APP_HEALTH_URL(http://127.0.0.1:8081/actuator/health), APP_CONTAINER(app-server, 메모리 부족 종료 기록을 보는 바깥 컨테이너)
# 호스트(이 컴퓨터) 부하: 앱도 이 컴퓨터의 Docker 안에서 돌아서 다른 프로그램이 CPU를 쓰면 숫자가 흔들린다.
#   시작 전 1분 부하 평균이 HOST_LOAD_MAX(기본 CPU 코어 수의 절반)보다 높으면 CPU를 많이 쓰는 프로세스를 보여 주고 종료 코드 4로 멈춘다.
#   그래도 돌리려면 HOST_BUSY_OK=1을 붙인다(그 회차는 숫자를 쓰지 않는 것을 권한다). 시작 전과 끝난 뒤 부하 평균은 verify 파일에도 남는다.
# DB 확인 결과는 results/local/<스크립트 이름>-<시각>-verify.txt에도 남는다. 로컬 전용이다. dev·main에서 실행하지 않는다.
set -uo pipefail

DB_SERVER="${DB_SERVER:-data-server}"
DB_CONTAINER="${DB_CONTAINER:-mysql}"
DB_NAME="${DB_NAME:-fridge_db}"
APP_HEALTH_URL="${APP_HEALTH_URL:-http://127.0.0.1:8081/actuator/health}"
APP_CONTAINER="${APP_CONTAINER:-app-server}"
: "${DB_USER:?DB_USER 환경변수가 필요합니다}"
: "${DB_PASSWORD:?DB_PASSWORD 환경변수가 필요합니다}"

reset_sql=""
verify_sql=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset) reset_sql="$2"; shift 2 ;;
    --verify) verify_sql="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "알 수 없는 옵션: $1"; exit 64 ;;
  esac
done
[[ -n "$reset_sql" ]] || { echo "--reset <sql>이 필요합니다"; exit 64; }
[[ $# -gt 0 ]] || { echo "-- 뒤에 run.sh 인자가 필요합니다"; exit 64; }

dir="$(cd "$(dirname "$0")/.." && pwd)"   # 저장소 루트
cd "$dir"

# 비밀번호는 명령줄 대신 환경변수(MYSQL_PWD)로 넘긴다.
sql() { docker exec -i "$DB_SERVER" docker exec -i -e MYSQL_PWD="$DB_PASSWORD" "$DB_CONTAINER" mysql -u"$DB_USER" --default-character-set=utf8mb4 "$DB_NAME" 2>&1 | grep -v "Using a password"; }
alive() { [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$APP_HEALTH_URL")" == "200" ]]; }
oom_kills() { docker exec "$APP_CONTAINER" sh -c 'grep "^oom_kill " /sys/fs/cgroup/memory.events | cut -d" " -f2' 2>/dev/null || echo "?"; }

host_load() { if [[ -r /proc/loadavg ]]; then cut -d' ' -f1 /proc/loadavg; else uptime | sed -E 's/.*load averages?: ([0-9.]+).*/\1/'; fi; }
NCPU="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"
HOST_LOAD_MAX="${HOST_LOAD_MAX:-$(awk -v n="$NCPU" 'BEGIN{print n/2}')}"
load_before="$(host_load)"
if awk -v l="$load_before" -v m="$HOST_LOAD_MAX" 'BEGIN{exit !(l>m)}' && [[ "${HOST_BUSY_OK:-0}" != "1" ]]; then
  echo "호스트 부하가 높습니다: 1분 부하 평균 $load_before (기준 $HOST_LOAD_MAX, CPU $NCPU개). 이 상태에서는 숫자가 흔들립니다."
  if [[ "$(uname)" == "Darwin" ]]; then echo "CPU를 많이 쓰는 프로세스:"; top -l 2 -o cpu -n 5 -stats pid,command,cpu 2>/dev/null | awk '/PID/{c++} c==2' | head -6; fi
  echo "다른 작업을 멈춘 뒤 다시 실행하거나, 그래도 돌리려면 HOST_BUSY_OK=1을 붙이세요."
  exit 4
fi
alive || { echo "앱이 응답하지 않습니다($APP_HEALTH_URL). 먼저 앱을 확인하세요."; exit 2; }
oom_before="$(oom_kills)"

sql < "$reset_sql"
script="${!#}"                       # run.sh의 마지막 인자가 스크립트
name="$(basename "$script" .js)"
stamp_before="$(date +%Y%m%d-%H%M%S)"
"$dir/tools/run.sh" "$@"
code=$?

if [[ -n "$verify_sql" ]]; then
  out="results/local/${name}-${stamp_before}-verify.txt"
  mkdir -p results/local
  { sql < "$verify_sql"; echo "호스트 1분 부하 평균(시작 전 → 끝난 뒤): $load_before → $(host_load) (CPU $NCPU개)"; } | tee "$out"
  echo "DB 확인 결과: $dir/$out"
fi
sql < "$reset_sql"

oom_after="$(oom_kills)"
if ! alive; then echo "경고: 실행 뒤 앱이 응답하지 않습니다. 이 회차의 숫자는 쓰지 않습니다."; code=3; fi
if [[ "$oom_before" != "$oom_after" ]]; then echo "경고: 메모리 부족 종료 기록이 늘었습니다($oom_before → $oom_after). 이 회차의 숫자는 쓰지 않습니다."; code=3; fi
exit "$code"
