#!/usr/bin/env bash
# 같은 순간 몰림: 가상 사용자 USERS명이 같은 시각에 API를 한 번씩 부르는 것을 ROUNDS회 반복하고 회차마다 판정한다.
#   ./tools/run-burst.sh <scenarios/burst/스크립트.js> <guest|login>
#   guest: 로그인 없이, login: 테스트 회원 쿠키를 붙여서(회차마다 setup에서 새로 로그인)
# 환경변수(기본값): BASE_URL(https://dev.imhungry.click), USERS(1000), ROUNDS(3), WARMUP(1, 기록 안 하는 예열 회차 수),
#   PREWARM(0, 1이면 같은 시각 전에 연결을 미리 맺어 API 응답 시간만 봄), GAP(10, 회차 사이 쉬는 초)
# 결과: results/dev/burst/<스크립트>-<조건>-<시각>/
#   rounds.csv(회차, 요청 수, 실패 수, p50·p95·최대·최소 ms, 판정), 회차마다 k6 결과(html·json·txt), summary.txt
# 판정: 대상 요청의 p95가 670ms 이하이고 실패 0이면 PASS. 최대값은 "같은 시각에 보내고 마지막 응답까지 걸린 시간"이다.
set -uo pipefail

script=${1:?스크립트 경로가 필요합니다}
cond=${2:?guest 또는 login이 필요합니다}
[[ "$cond" == guest || "$cond" == login ]] || { echo "조건은 guest 또는 login" >&2; exit 2; }
dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$dir"
export BASE_URL="${BASE_URL:-https://dev.imhungry.click}"
USERS="${USERS:-1000}"; ROUNDS="${ROUNDS:-3}"; WARMUP="${WARMUP:-1}"; PREWARM="${PREWARM:-0}"; GAP="${GAP:-10}"
LIMIT_MS="${LIMIT_MS:-670}"  # 팀 합의 기준. 실행 도구 확인 때만 바꾼다
name="$(basename "$script" .js)"
out="$dir/results/dev/burst/$name-$cond-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
echo "round,requests,failed,p50_ms,p95_ms,max_ms,min_ms,verdict" > "$out/rounds.csv"

run_round() {  # run_round <results_dir>
  local extra=(-e USERS="$USERS" -e PREWARM="$PREWARM"); [ "$cond" = login ] && extra+=(-e LOGIN=1)
  RESULTS_DIR="$1" ./tools/run.sh "${extra[@]}" "$script" > "$1/last-run.log" 2>&1
  echo $?
}

read_round() {  # read_round <json>
  python3 -I - "$1" <<'EOF'
import json, sys
m = json.load(open(sys.argv[1]))['metrics']
d = next((v for k, v in m.items() if k.startswith('http_req_duration{name:')), {})
f = next((v for k, v in m.items() if k.startswith('http_req_failed{name:')), {})
fails, passes = f.get('passes', 0), f.get('fails', 0)  # Rate: passes = 실패로 센 요청, fails = 성공한 요청
print(fails + passes, fails, round(d.get('med', 0)), round(d.get('p(95)', 0)), round(d.get('max', 0)), round(d.get('min', 0)))
EOF
}

total=$((WARMUP + ROUNDS))
for i in $(seq 1 "$total"); do
  if [ "$i" -le "$WARMUP" ]; then label="warmup$i"; else label="r$((i - WARMUP))"; fi
  rd="$out/$label"; mkdir -p "$rd"
  code=$(run_round "$rd")
  json=$(ls "$rd"/*.json 2>/dev/null | head -1)
  if [ -z "$json" ]; then echo "$label: 결과 없음(k6 exit $code)"; tail -5 "$rd/last-run.log"; exit 1; fi
  read -r reqs failed p50 p95 mx mn <<< "$(read_round "$json")"
  verdict=PASS; { [ "$p95" -gt "$LIMIT_MS" ] || [ "$failed" -gt 0 ]; } && verdict=FAIL
  [ "$label" = "${label#warmup}" ] && echo "${label#r},$reqs,$failed,$p50,$p95,$mx,$mn,$verdict" >> "$out/rounds.csv"
  echo "$label · $USERS명 같은 시각: 요청 $reqs, 실패 $failed, p50 ${p50}ms, p95 ${p95}ms, 최대 ${mx}ms, 최소 ${mn}ms → $verdict"
  [ "$i" -lt "$total" ] && sleep "$GAP"
done

python3 -I - "$out/rounds.csv" > "$out/summary.txt" <<'EOF'
import csv, sys, statistics
rows = list(csv.DictReader(open(sys.argv[1])))
p95s = [int(r['p95_ms']) for r in rows]
print(f"회차 {len(rows)}개: 통과 {sum(r['verdict']=='PASS' for r in rows)}, p95 {p95s}, 가운데 값 {statistics.median(p95s)}ms")
EOF
cat "$out/summary.txt"
echo "결과: $out"
