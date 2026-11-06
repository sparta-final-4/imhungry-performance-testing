#!/usr/bin/env bash
# 읽기 API 한계 찾기: 가상 사용자를 단계별로 늘리며 p95가 0.67초를 처음 넘는 단계에서 멈춘다. 이것을 ROUNDS회 반복한다.
#   ./tools/run-hold.sh <scenarios/hold/스크립트.js> <guest|login>
#   guest: 로그인 없이, login: 테스트 회원 쿠키를 붙여서(회차마다 새로 로그인)
# 환경변수(기본값):
#   BASE_URL(https://dev.imhungry.click), STEPS(50,100,200,300,400,600,800,1000,1500,2000) 단계별 가상 사용자 수,
#   DURATION(60s) 단계마다 유지하는 시간, WARMUP(30s) 첫 회차 앞의 예열(기록 안 함), ROUNDS(3), MEMBERS(1000) 로그인 회원 수
# 결과: results/dev/hold/<스크립트>-<조건>-<시각>/
#   steps.csv(회차, 단계, p95·p50·최대 ms, 초당 요청, 실패율, 판정), 단계마다 k6 결과(html·json·txt), summary.txt(회차별 한계)
# 판정: 그 단계의 대상 요청 p95가 670ms 이하이고 실패율 0이면 PASS. 처음 FAIL이 난 단계에서 그 회차를 끝낸다. 한계 = 마지막 PASS 단계.
set -uo pipefail

script=${1:?스크립트 경로가 필요합니다}
cond=${2:?guest 또는 login이 필요합니다}
[[ "$cond" == guest || "$cond" == login ]] || { echo "조건은 guest 또는 login" >&2; exit 2; }
dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$dir"
export BASE_URL="${BASE_URL:-https://dev.imhungry.click}"
STEPS="${STEPS:-50,100,200,300,400,600,800,1000,1500,2000}"
DURATION="${DURATION:-60s}"; WARMUP="${WARMUP:-30s}"; ROUNDS="${ROUNDS:-3}"; MEMBERS="${MEMBERS:-1000}"
LIMIT_MS="${LIMIT_MS:-670}"  # 팀 합의 기준. 실행 도구 확인 때만 바꾼다
name="$(basename "$script" .js)"
out="$dir/results/dev/hold/$name-$cond-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
echo "round,step_vus,p95_ms,p50_ms,max_ms,req_per_s,fail_rate,verdict" > "$out/steps.csv"
auth="$out/auth-cookies.txt"; auth_at=0

login_dump() {
  echo "로그인 쿠키 만들기(회원 $MEMBERS명)..."
  k6 run -q --log-format raw -e MEMBERS="$MEMBERS" scenarios/hold/login-dump.js 2>&1 | grep '^AUTH_COOKIE=' | sed 's/^AUTH_COOKIE=//' > "$auth"
  [ -s "$auth" ] || { echo "로그인 쿠키를 만들지 못했습니다" >&2; exit 1; }
  auth_at=$(date +%s)
}

run_step() {  # run_step <vus> <duration> <results_dir>
  local extra=(); [ "$cond" = login ] && extra=(-e LOGIN=1 -e AUTH_FILE="$auth")
  RESULTS_DIR="$3" ./tools/run.sh -e VUS="$1" -e DURATION="$2" ${extra[@]+"${extra[@]}"} "$script" > "$3/last-run.log" 2>&1
  echo $?
}

# 요약 json에서 대상 요청의 p95 등을 읽는다.
read_step() {  # read_step <json>
  python3 -I - "$1" <<'EOF'
import json, sys
m = json.load(open(sys.argv[1]))['metrics']
key = next((k for k in m if k.startswith('http_req_duration{name:')), None)
d = m[key] if key else {}
reqs = m.get('http_reqs', {})
failed = m.get('http_req_failed', {}).get('value', m.get('http_req_failed', {}).get('rate', 0))
print(round(d.get('p(95)', 0)), round(d.get('med', 0)), round(d.get('max', 0)), round(reqs.get('rate', 0), 1), round(failed or 0, 4))
EOF
}

IFS=',' read -r -a steps <<< "$STEPS"
for r in $(seq 1 "$ROUNDS"); do
  [ "$cond" = login ] && login_dump
  if [ "$r" = 1 ]; then
    echo "예열: 가상 사용자 ${steps[0]}명, $WARMUP (기록 안 함)"
    mkdir -p "$out/warmup"; run_step "${steps[0]}" "$WARMUP" "$out/warmup" > /dev/null
  fi
  for s in "${steps[@]}"; do
    # 로그인 조건은 토큰이 15분이라 12분이 지나면 다시 로그인한다.
    if [ "$cond" = login ] && [ $(( $(date +%s) - auth_at )) -gt 720 ]; then login_dump; fi
    sd="$out/r$r-vus$s"; mkdir -p "$sd"
    code=$(run_step "$s" "$DURATION" "$sd")
    json=$(ls "$sd"/*.json 2>/dev/null | head -1)
    if [ -z "$json" ]; then echo "$r,$s,,,,,,ERROR(k6 exit $code)" >> "$out/steps.csv"; echo "회차 $r 단계 $s: 결과 없음(k6 exit $code)"; break; fi
    read -r p95 p50 mx rps fail <<< "$(read_step "$json")"
    verdict=PASS
    if [ "$p95" -gt "$LIMIT_MS" ] || python3 -c "import sys; sys.exit(0 if $fail > 0 else 1)"; then verdict=FAIL; fi
    [ "$code" = 99 ] && verdict="FAIL(실패율 5% 초과로 중단)"
    echo "$r,$s,$p95,$p50,$mx,$rps,$fail,$verdict" >> "$out/steps.csv"
    echo "회차 $r · 가상 사용자 $s명: p95 ${p95}ms, p50 ${p50}ms, 최대 ${mx}ms, 초당 ${rps}건, 실패율 $fail → $verdict"
    [ "$verdict" = PASS ] || break
  done
done

python3 -I - "$out/steps.csv" > "$out/summary.txt" <<'EOF'
import csv, sys
rows = list(csv.DictReader(open(sys.argv[1])))
for r in sorted({x['round'] for x in rows}):
    rr = [x for x in rows if x['round'] == r]
    passed = [x for x in rr if x['verdict'] == 'PASS']
    first_fail = next((x for x in rr if x['verdict'] != 'PASS'), None)
    limit = passed[-1]['step_vus'] if passed else '없음'
    ff = f"{first_fail['step_vus']}명(p95 {first_fail['p95_ms']}ms)" if first_fail else '없음(마지막 단계까지 통과)'
    print(f"회차 {r}: 한계 {limit}명, 처음 넘은 단계 {ff}")
EOF
cat "$out/summary.txt"
echo "결과: $out"
