#!/usr/bin/env bash
# k6를 실행하고 결과를 results/<환경>/ 에 남긴다. 모니터링(Prometheus·Grafana) 없이도 같은 파일이 남는다.
#   환경은 BASE_URL(환경변수 또는 -e BASE_URL=...)로 정한다. 없거나 127.0.0.1·localhost면 local, dev.이 들어가면 dev, 그 밖은 remote.
#   다른 폴더에 남기려면 RESULTS_DIR을 준다.
#   ./tools/run.sh <폴더>/<스크립트>.js [k6 옵션...]
# 예) ./tools/run.sh scenarios/products/products.js
#     ./tools/run.sh -e SMOKE=1 scenarios/products/products.js            (옵션은 스크립트 이름 앞에 둔다)
# Prometheus(127.0.0.1:9090, PROM_URL로 바꿈)가 응답하면 결과를 자동으로 Prometheus에도 보낸다(옵션을 따로 줄 필요 없음).
#     보내지 않으려면 NO_PROM=1을 붙인다. 응답이 없으면 파일만 남긴다.
# 남는 파일: results/<환경>/<스크립트 이름>-<시각>.html (보고서), .json (요약 수치), .txt (터미널 출력)
set -euo pipefail

args=("$@")
script="${args[${#args[@]}-1]}"
unset 'args[${#args[@]}-1]'

dir="$(cd "$(dirname "$0")/.." && pwd)"   # 저장소 루트
name="$(basename "$script" .js)"
stamp="$(date +%Y%m%d-%H%M%S)"
# 대상 주소로 환경을 정한다. -e BASE_URL=... 이 있으면 그 값을 쓴다.
target="${BASE_URL:-}"
for a in ${args[@]+"${args[@]}"}; do [[ "$a" == BASE_URL=* ]] && target="${a#BASE_URL=}"; done
case "$target" in
  ""|*://127.0.0.1*|*://localhost*) env_name=local ;;
  *://dev.*) env_name=dev ;;
  *) env_name=remote ;;
esac
results_dir="${RESULTS_DIR:-$dir/results/$env_name}"
base="$results_dir/$name-$stamp"
mkdir -p "$results_dir"

cd "$dir"
# 모니터링이 떠 있으면 k6 결과를 Prometheus로도 보낸다. 이미 -o experimental-prometheus-rw를 줬으면 그대로 둔다.
PROM_URL="${PROM_URL:-http://127.0.0.1:9090}"
if [[ "${NO_PROM:-0}" != "1" && " ${args[*]-} " != *experimental-prometheus-rw* ]] \
   && [[ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "$PROM_URL/-/ready")" == "200" ]]; then
  export K6_PROMETHEUS_RW_SERVER_URL="${K6_PROMETHEUS_RW_SERVER_URL:-$PROM_URL/api/v1/write}"
  export K6_PROMETHEUS_RW_TREND_STATS="${K6_PROMETHEUS_RW_TREND_STATS:-p(90),p(95),p(99),avg,max}"
  args=(-o experimental-prometheus-rw ${args[@]+"${args[@]}"})
  echo "k6 결과를 Prometheus($PROM_URL)로도 보냅니다. testid=$name-$stamp"
else
  echo "k6 결과는 파일로만 남깁니다(Prometheus가 응답하지 않거나 NO_PROM=1)."
fi
# 웹 대시보드는 서버를 띄우지 않고(-1) 끝난 뒤 HTML 보고서만 저장한다.
# --tag testid=...: Prometheus로 보낼 때 실행마다 구분되는 이름이 라벨로 붙는다(Grafana의 'k6 실행(testid)' 선택 값).
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_PORT=-1 K6_WEB_DASHBOARD_EXPORT="$base.html" \
  k6 run --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
         --summary-export="$base.json" --tag "testid=$name-$stamp" ${args[@]+"${args[@]}"} "$script" 2>&1 | tee "$base.txt"

echo
echo "결과 파일: $base.html / .json / .txt"
