#!/usr/bin/env bash
# 부하 테스트 환경 전체(서버 4대 + 모니터링 포트)를 한 번에 올립니다. 이미 있는 것은 건너뛰므로 여러 번 실행해도 됩니다.
#   ./up.sh
# 환경변수(모두 선택):
#   DUMP_FILE      DB가 비어 있을 때 복원할 DB 덤프(.sql 또는 .sql.gz). 복원 뒤 시작 데이터 SQL도 같이 넣습니다.
#   LOADTEST_ENV   앱 서버 환경변수 파일 경로(기본: 저장소 루트의 .loadtest.env, 없으면 loadtest.env.example을 복사)
#   APP_REPO       소스코드 저장소의 클론 경로(기본: 이 저장소 옆의 take-care-of-my-fridge). 그 저장소에서 체크아웃해 둔 커밋을 빌드합니다.
#   PLATFORM       컨테이너 CPU 종류(예: linux/arm64). 주지 않으면 이 컴퓨터를 따릅니다.
# 끝나면 점검 결과를 보여 주고, 하나라도 실패하면 종료 코드 1로 끝납니다. 필요한 자원: Docker 메모리 9GB 이상(서버 컨테이너 4개 × 2GB에 호스트와 k6 몫).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
APP_REPO="${APP_REPO:-$REPO/../take-care-of-my-fridge}"
source "$HERE/lib.sh"
ENV_FILE="${LOADTEST_ENV:-$REPO/.loadtest.env}"
NETWORK=take-care-of-my-fridge_default
DB_PASSWORD_LOCAL=12345678     # 로컬 전용 기본값(앱 loadtest 프로필의 기본값과 같음)
PROXY_IMAGE=tecnativa/docker-socket-proxy:0.3.0   # Alloy가 서버 안쪽 컨테이너 로그를 읽을 때 쓰는 읽기 전용 Docker API 프록시

step() { printf '\n== %s\n' "$*"; }
fail() { echo "실패: $*" >&2; exit 1; }

step "1. 준비 확인"
docker info >/dev/null 2>&1 || fail "Docker가 실행 중이 아닙니다. Docker Desktop을 켜세요."
mem_gb=$(( $(docker info --format '{{.MemTotal}}') / 1073741824 ))
cpus=$(docker info --format '{{.NCPU}}')
echo "Docker 자원: 메모리 ${mem_gb}GB, CPU ${cpus}개"
[ "$mem_gb" -ge 9 ] || fail "Docker 메모리가 ${mem_gb}GB입니다. 서버 4대에 9GB 이상이 필요합니다. Docker Desktop(Windows는 %UserProfile%\\.wslconfig의 memory)에서 늘리세요."
[ "$cpus" -ge 8 ] || echo "경고: CPU가 ${cpus}개입니다. 8개 이상을 권장하며, 적으면 측정 숫자가 흔들립니다."
K6_VER="$(k6 version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if [ -z "$K6_VER" ]; then
  echo "경고: k6가 없습니다. 환경은 올리지만 측정하려면 설치해야 합니다."
  echo "  맥: brew install k6 / 윈도우: winget install k6 (WSL2 안에서는 리눅스용) / 리눅스: https://grafana.com/docs/k6/latest/set-up/install-k6/"
else
  echo "k6 $K6_VER"
fi
if [ ! -f "$ENV_FILE" ]; then
  [ -z "${LOADTEST_ENV:-}" ] || fail "LOADTEST_ENV 파일이 없습니다: $ENV_FILE"
  cp "$HERE/loadtest.env.example" "$ENV_FILE"; echo "$ENV_FILE 을(를) 기본값으로 만들었습니다."
fi
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
docker image inspect ec2-base:docker >/dev/null 2>&1 || { echo "서버 기반 이미지를 빌드합니다..."; docker build -q -t ec2-base:docker ${PLATFORM:+--platform "$PLATFORM"} "$HERE" >/dev/null; }
if ! docker image inspect fridge-be:loadtest >/dev/null 2>&1; then
  # 소스코드 저장소에서 체크아웃된 커밋을 꺼내 부하 테스트용 변경(app-patch)을 얹어 빌드합니다. 소스코드 저장소의 작업 폴더는 건드리지 않습니다.
  git -C "$APP_REPO" rev-parse HEAD >/dev/null 2>&1 || fail "소스코드 저장소를 찾을 수 없습니다: $APP_REPO (APP_REPO로 경로를 지정하세요)"
  app_commit="$(git -C "$APP_REPO" rev-parse --short HEAD)"
  build_dir="$(mktemp -d)"
  git -C "$APP_REPO" archive HEAD take-care-of-my-fridge-be | tar -x -C "$build_dir"
  (cd "$build_dir" && git init -q . && git apply --unidiff-zero "$REPO/app-patch/loadtest-app.patch") || fail "app-patch를 앱 소스코드(커밋 $app_commit)에 적용하지 못했습니다. 앱 소스코드가 바뀌어 패치가 맞지 않는 경우입니다."
  echo "앱 이미지를 빌드합니다(앱 커밋 $app_commit, 처음엔 몇 분 걸립니다)..."
  docker build -q -t fridge-be:loadtest --label "app.commit=$app_commit" ${PLATFORM:+--platform "$PLATFORM"} "$build_dir/take-care-of-my-fridge-be" >/dev/null
  rm -rf "$build_dir"
fi

ensure_server() {   # ensure_server <이름> <별칭> [docker run 옵션...]
  local name=$1; shift
  if docker inspect "$name" >/dev/null 2>&1; then
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || docker start "$name" >/dev/null
    "$HERE/recover-server.sh" "$name" >/dev/null
  else
    "$HERE/create-server.sh" "$name" "$@" >/dev/null
  fi
  docker exec "$name" sh -c 'grep -qw memory /sys/fs/cgroup/cgroup.subtree_control' \
    || fail "$name 안에서 메모리 제한을 쓸 수 없습니다(cgroup 위임 실패). README의 '메모리 제한이 안 걸릴 때'를 보세요."
  echo "$name 준비됨"
}

step "2. 서버 컨테이너"
ensure_server data-server mysql,redis,kafka -v data-server-mysql:/data/mysql -v data-server-kafka:/data/kafka
ensure_server search-server elasticsearch
ensure_server monitoring-server prometheus,grafana,loki,alloy,tempo,mysqld-exporter,redis-exporter,kafka-exporter,elasticsearch-exporter \
  -v "$REPO/monitoring:/monitoring:ro" -v "$REPO/logs:/var/log/fridge:ro"
mkdir -p "$REPO/logs"
ensure_server app-server "" -v "$REPO/logs:/logs" -v "$ENV_FILE:/run/loadtest.env:ro" -p 127.0.0.1:8080:8080 -p 127.0.0.1:8081:8081

step "3. 데이터 서버: MySQL, Redis, Kafka"
load_images data-server mysql:8.4 redis:7 apache/kafka:3.8.0 "$PROXY_IMAGE"
docker exec data-server chown 1000:1000 /data/kafka   # Kafka 이미지는 uid 1000으로 실행되는데 새 볼륨은 root 소유라 쓰지 못한다
start_inner data-server mysql --network host --memory 600m --memory-swap 1200m \
  -e MYSQL_DATABASE=fridge_db -e MYSQL_USER=fridge_user -e MYSQL_PASSWORD=$DB_PASSWORD_LOCAL -e MYSQL_ROOT_PASSWORD=$DB_PASSWORD_LOCAL -e TZ=Asia/Seoul \
  -v /data/mysql:/var/lib/mysql mysql:8.4 \
  --innodb-buffer-pool-size=256M --max-connections=200 --thread-cache-size=10 --performance-schema=OFF
start_inner data-server redis --network host --memory 200m --memory-swap 400m redis:7 \
  redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
start_inner data-server kafka --network host --memory 700m --memory-swap 1400m \
  -e KAFKA_NODE_ID=1 -e KAFKA_PROCESS_ROLES=broker,controller -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:9093 \
  -e KAFKA_LISTENERS=CONTROLLER://:9093,INTERNAL://:29092,EXTERNAL://:9092 \
  -e KAFKA_ADVERTISED_LISTENERS=INTERNAL://kafka:29092,EXTERNAL://localhost:9092 \
  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER -e KAFKA_INTER_BROKER_LISTENER_NAME=INTERNAL \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 -e KAFKA_DEFAULT_REPLICATION_FACTOR=1 -e KAFKA_NUM_PARTITIONS=1 \
  -e KAFKA_LOG_DIRS=/var/lib/kafka/data -e "KAFKA_HEAP_OPTS=-Xms384m -Xmx384m" \
  -v /data/kafka:/var/lib/kafka/data apache/kafka:3.8.0
start_inner data-server docker-socket-proxy --network host --memory 32m --memory-swap 64m \
  -e CONTAINERS=1 -e NETWORKS=1 -e POST=0 -v /var/run/docker.sock:/var/run/docker.sock:ro "$PROXY_IMAGE"

mysql_exec() { docker exec -i data-server docker exec -i -e MYSQL_PWD=$DB_PASSWORD_LOCAL mysql mysql -uroot --default-character-set=utf8mb4 "$@"; }
echo -n "MySQL 기동 대기"
for _ in $(seq 1 60); do mysql_exec -e 'select 1' >/dev/null 2>&1 && break; echo -n .; sleep 3; done; echo
recipes=$(mysql_exec -N fridge_db -e 'select count(*) from recipes' 2>/dev/null || echo 0)
if [ "$recipes" = "0" ] && [ -n "${DUMP_FILE:-}" ]; then
  [ -f "$DUMP_FILE" ] || fail "DUMP_FILE을 찾을 수 없습니다: $DUMP_FILE"
  echo "DB가 비어 있어 덤프를 복원합니다: $DUMP_FILE"
  if [[ "$DUMP_FILE" == *.gz ]]; then gunzip -c "$DUMP_FILE" | mysql_exec fridge_db; else mysql_exec fridge_db < "$DUMP_FILE"; fi
  echo "시작 데이터(요리 기록, 후기, 검색 클릭 이력)를 넣습니다..."
  mysql_exec fridge_db < "$REPO/scenarios/recipes-popular/seed-cooking-logs.sql"
  mysql_exec fridge_db < "$REPO/scenarios/sales-popular/seed-search-clicks.sql"
  recipes=$(mysql_exec -N fridge_db -e 'select count(*) from recipes')
fi

step "4. 검색 서버: Elasticsearch"
ES_IMAGE=docker.elastic.co/elasticsearch/elasticsearch:9.2.0
load_images search-server "$ES_IMAGE" "$PROXY_IMAGE"
start_inner search-server elasticsearch --network host --memory 1400m --memory-swap 2800m \
  -e discovery.type=single-node -e xpack.security.enabled=false -e xpack.security.autoconfiguration.enabled=false \
  -e "ES_JAVA_OPTS=-Xms768m -Xmx768m" --entrypoint /bin/bash "$ES_IMAGE" -c \
  'bin/elasticsearch-plugin list | grep -qx analysis-nori || bin/elasticsearch-plugin install --batch analysis-nori
exec /bin/tini -- /usr/local/bin/docker-entrypoint.sh eswrapper'
start_inner search-server docker-socket-proxy --network host --memory 32m --memory-swap 64m \
  -e CONTAINERS=1 -e NETWORKS=1 -e POST=0 -v /var/run/docker.sock:/var/run/docker.sock:ro "$PROXY_IMAGE"

step "5. 모니터링 서버"
"$HERE/start-monitoring.sh" monitoring-server
docker inspect mon-ports >/dev/null 2>&1 || docker run -d --name mon-ports --restart unless-stopped --network "$NETWORK" \
  -p 127.0.0.1:9090:9090 -p 127.0.0.1:3000:3000 -p 127.0.0.1:3100:3100 -p 127.0.0.1:12345:12345 \
  --entrypoint sh alpine/socat -c 'for p in 9090 3000 3100 12345; do socat tcp-listen:$p,fork,reuseaddr tcp:monitoring-server:$p & done; wait' >/dev/null
docker start mon-ports >/dev/null 2>&1 || true

step "6. 앱 서버"
load_images app-server fridge-be:loadtest
docker exec app-server sh -c 'grep -v "^PORTONE_" /run/loadtest.env > /tmp/app.env'
start_inner app-server app --network host --memory 1100m --memory-swap 2100m --env-file /tmp/app.env -v /logs:/logs fridge-be:loadtest

step "7. 점검"
ok=1
check() { if eval "$2"; then echo "OK    $1"; else echo "실패  $1"; ok=0; fi; }
echo -n "앱 기동 대기"
for _ in $(seq 1 60); do [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' 127.0.0.1:8081/actuator/health)" = 200 ] && break; echo -n .; sleep 5; done; echo
check "앱 health 200 (127.0.0.1:8081)" '[ "$(curl -s -m 3 -o /dev/null -w "%{http_code}" 127.0.0.1:8081/actuator/health)" = 200 ]'
check "앱 컨테이너 메모리 제한 1100MB" '[ "$(inner app-server inspect -f "{{.HostConfig.Memory}}" app)" = 1153433600 ]'
check "앱 JVM 힙 768MB" 'inner app-server exec app printenv JAVA_TOOL_OPTIONS | grep -q "Xmx768m"'
check "Prometheus 타깃 6개 up" '[ "$(curl -s -m 5 127.0.0.1:9090/api/v1/targets | grep -o "\"health\":\"up\"" | wc -l | tr -d " ")" -ge 6 ]'
check "k6 설치됨, v2 이상 (현재: ${K6_VER:-없음})" '[ "${K6_VER%%.*}" -ge 2 ] 2>/dev/null'
check "Grafana 응답 (127.0.0.1:3000)" '[ "$(curl -s -m 3 -o /dev/null -w "%{http_code}" 127.0.0.1:3000/api/health)" = 200 ]'
check "DB에 레시피 있음 (${recipes}개)" '[ "${recipes:-0}" -gt 0 ]'
echo
[ $ok = 1 ] && echo "환경이 준비됐습니다. 측정은 README.md의 '실행 방법'을 따르세요." && exit 0
echo "위에서 실패한 항목을 README의 '문제 해결'로 확인하세요. DB가 비어 있다면 DUMP_FILE=<덤프.sql> ./up.sh 로 다시 실행하세요."
exit 1
