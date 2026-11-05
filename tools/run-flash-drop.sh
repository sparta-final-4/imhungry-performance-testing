#!/usr/bin/env bash
# 번개 드롭 등록 한 건이 만드는 알림을 측정한다: 등록 요청 응답 시간 → 알림이 전부 저장될 때까지 걸리는 시간 → 개수(유실·중복).
#   DB_USER=<사용자> DB_PASSWORD=<비밀번호> ./tools/run-flash-drop.sh -e ADMIN_PASSWORD=<로컬 관리자 비밀번호>
# 회원 수는 미리 flash-drop-seed-members.sql로 맞춰 둔다(현재 일반 회원 전체가 알림을 받는다). 한 번 실행 = 등록 1건 = 회차 1번.
# 결과는 stdout과 results/local/flash-drop-<시각>.txt에 남긴다. 로컬 전용이다. dev·main에서 실행하지 않는다.
set -uo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)"; cd "$dir"
: "${DB_USER:?DB_USER 환경변수가 필요합니다}"; : "${DB_PASSWORD:?DB_PASSWORD 환경변수가 필요합니다}"
DB_SERVER="${DB_SERVER:-data-server}"; DB_CONTAINER="${DB_CONTAINER:-mysql}"; DB_NAME="${DB_NAME:-fridge_db}"
TIMEOUT="${POLL_TIMEOUT:-900}"; STALL="${POLL_STALL:-90}"
out="results/local/flash-drop-$(date +%Y%m%d-%H%M%S).txt"; mkdir -p results/local
sql() { docker exec -i "$DB_SERVER" docker exec -i "$DB_CONTAINER" mysql -u"$DB_USER" -p"$DB_PASSWORD" --default-character-set=utf8mb4 -N -B "$DB_NAME" 2>/dev/null; }
say() { echo "$@" | tee -a "$out"; }

sql < scenarios/flash-drop/flash-drop-reset.sql
members=$(echo "SELECT COUNT(*) FROM members WHERE role='USER' AND status='ACTIVE'" | sql)
say "회원(알림 받는 일반 회원) $members명, 시작 전 부하 평균 $(uptime | sed 's/.*load averages*: //')"

log=$(mktemp); ./tools/run.sh "$@" scenarios/flash-drop/flash-drop-create.js > "$log" 2>&1
line=$(grep -o 'FLASH_DROP_RESULT.*' "$log" | head -1)
[ -n "$line" ] || { say "등록 실패. k6 로그: $log"; tail -20 "$log"; exit 3; }
api_ms=$(echo "$line" | sed -E 's/.*duration_ms=([0-9.]+).*/\1/')
event_id=$(echo "$line" | sed -E 's/.*saleEventIds[^0-9]*([0-9]+).*/\1/')
say "등록 요청 응답 시간 ${api_ms}ms, 행사 번호 $event_id"

q="FROM notifications WHERE notification_type='FLASH_DROP' AND dedupe_key LIKE 'FLASH_DROP_CREATED:${event_id}:%'"
t0=$(date +%s); last=-1; last_change=$t0
while :; do
  n=$(echo "SELECT COUNT(*) $q" | sql); now=$(date +%s)
  [ "$n" != "$last" ] && { last=$n; last_change=$now; }
  [ "$n" -ge "$members" ] && break
  [ $((now-last_change)) -ge "$STALL" ] && { say "알림 저장이 ${STALL}초 동안 늘지 않아 중단(저장 $n건)"; break; }
  [ $((now-t0)) -ge "$TIMEOUT" ] && { say "제한 시간 ${TIMEOUT}초 초과(저장 $n건)"; break; }
  sleep 2
done
sleep 5   # 마지막 저장과 중복 건너뛰기까지 기다린다.
cnt=$(echo "SELECT COUNT(*) $q" | sql); dist=$(echo "SELECT COUNT(DISTINCT member_id) $q" | sql)
first=$(echo "SELECT MIN(created_at) $q" | sql); lastc=$(echo "SELECT MAX(created_at) $q" | sql)
ev_created=$(echo "SELECT created_at FROM sale_events WHERE id=$event_id" | sql)
say "저장된 알림 $cnt건 (기대 $members건), 서로 다른 회원 $dist명"
say "행사 저장 시각 $ev_created, 첫 알림 $first, 마지막 알림 $lastc"
secs=$(echo "SELECT TIMESTAMPDIFF(MICROSECOND, '$ev_created', '$lastc')/1000000" | sql)
say "행사 저장부터 마지막 알림 저장까지 ${secs}초"
say "끝난 뒤 부하 평균 $(uptime | sed 's/.*load averages*: //'), 앱 상태 $(curl -s -m 3 -o /dev/null -w '%{http_code}' 127.0.0.1:8081/actuator/health)"
sql < scenarios/flash-drop/flash-drop-reset.sql
say "결과 파일: $out"
