#!/usr/bin/env bash
# monitoring-server 안에서 모니터링 컨테이너들을 띄웁니다. 먼저 create-server.sh로 서버를 만들어 두어야 합니다.
#   ./create-server.sh monitoring-server prometheus,grafana,loki,alloy,tempo,mysqld-exporter,redis-exporter,kafka-exporter,elasticsearch-exporter \
#     -v <저장소>/monitoring:/monitoring:ro -v <저장소>/logs:/var/log/fridge:ro \
#     -p 127.0.0.1:9090:9090 -p 127.0.0.1:3000:3000 -p 127.0.0.1:3100:3100 -p 127.0.0.1:12345:12345
# 모든 컨테이너는 바깥 컨테이너의 네트워크를 그대로 쓰고(--network host), 서로는 바깥 컨테이너에 붙은 네트워크 별칭으로 찾습니다.
# 이미지는 호스트 Docker에서 받아 둔 것을 안쪽으로 옮겨 넣습니다.
set -euo pipefail
S="${1:-monitoring-server}"
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib.sh"

load_images "$S" prom/prometheus:v3.5.0 grafana/grafana:12.2.0 grafana/loki:3.5.0 grafana/alloy:v1.10.0 grafana/tempo:2.8.2 \
  prom/mysqld-exporter:v0.17.2 oliver006/redis_exporter:v1.67.0 danielqsj/kafka-exporter:v1.9.0 \
  quay.io/prometheuscommunity/elasticsearch-exporter:v1.9.0

run() { name=$1; mem=$2; shift 2; start_inner "$S" "$name" --network host --memory "$mem" --memory-swap "$mem" "$@"; }

run prometheus 384m -v /monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro -v prometheus_data:/prometheus \
  prom/prometheus:v3.5.0 --config.file=/etc/prometheus/prometheus.yml --web.enable-remote-write-receiver
run loki 512m -v /monitoring/loki-config.yml:/etc/loki/loki-config.yml:ro -v loki_data:/loki \
  grafana/loki:3.5.0 -config.file=/etc/loki/loki-config.yml
run tempo 256m -v /monitoring/tempo.yml:/etc/tempo/tempo.yml:ro -v tempo_data:/var/tempo \
  grafana/tempo:2.8.2 -config.file=/etc/tempo/tempo.yml
run alloy 384m -v /monitoring/alloy/config.loadtest.alloy:/etc/alloy/config.alloy:ro -v /var/log/fridge:/var/log/fridge:ro \
  grafana/alloy:v1.10.0 run --server.http.listen-addr=0.0.0.0:12345 --storage.path=/var/lib/alloy/data /etc/alloy/config.alloy
run grafana 384m -e GF_SECURITY_ADMIN_USER=admin -e GF_SECURITY_ADMIN_PASSWORD=admin \
  -v /monitoring/grafana/provisioning:/etc/grafana/provisioning:ro -v grafana_data:/var/lib/grafana \
  grafana/grafana:12.2.0
run mysqld-exporter 64m -e MYSQLD_EXPORTER_PASSWORD=12345678 \
  prom/mysqld-exporter:v0.17.2 --mysqld.address=mysql:3306 --mysqld.username=root
run redis-exporter 64m oliver006/redis_exporter:v1.67.0 --redis.addr=redis://redis:6379
run kafka-exporter 64m danielqsj/kafka-exporter:v1.9.0 --kafka.server=kafka:29092
run elasticsearch-exporter 64m quay.io/prometheuscommunity/elasticsearch-exporter:v1.9.0 --es.uri=http://elasticsearch:9200
