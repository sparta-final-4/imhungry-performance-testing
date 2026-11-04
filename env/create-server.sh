#!/usr/bin/env bash
# dev 서버 한 대(t4g.small: 2 CPU, 2GB)에 해당하는 바깥 컨테이너를 만들고 그 안에서 Docker를 띄웁니다.
# 사용: ./create-server.sh <이름> <네트워크 별칭(쉼표로 구분, 없으면 "")> [docker run 추가 옵션...]
# 예)   ./create-server.sh data-server mysql,redis,kafka -v <볼륨>:/data/mysql
#
# 바깥 컨테이너 이미지(SERVER_IMAGE, 기본 ec2-base:docker)는 없으면 같은 폴더의 Dockerfile로 빌드합니다.
# PLATFORM(예: linux/arm64)을 주면 그 CPU용으로 만들고, 주지 않으면 이 컴퓨터의 CPU를 따릅니다.
# 호스트 이름은 서버 이름으로 고정합니다. 안쪽 컨테이너(--network host)는 만들 때의 호스트 이름을 저장하므로, 서버를 지우고 다시 만들어도 같은 이름이어야 Kafka가 시작됩니다.
# 안쪽 컨테이너에 메모리 제한을 걸려면 dockerd를 띄우기 전에 cgroup에 메모리 제어를 위임해야 하므로 여기서 같이 합니다.
set -euo pipefail

NAME="${1:?서버 컨테이너 이름이 필요합니다}"
ALIASES="${2-}"
shift 2 || shift $#
IMAGE="${SERVER_IMAGE:-ec2-base:docker}"
NETWORK="${NETWORK:-take-care-of-my-fridge_default}"
HERE="$(cd "$(dirname "$0")" && pwd)"

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -t "$IMAGE" ${PLATFORM:+--platform "$PLATFORM"} "$HERE"

alias_args=()
IFS=, read -ra names <<<"$ALIASES"
for a in ${names[@]+"${names[@]}"}; do
  [ -n "$a" ] && alias_args+=(--network-alias "$a")
done

docker run -d --name "$NAME" --hostname "$NAME" --privileged ${PLATFORM:+--platform "$PLATFORM"} \
  --cpus=2 --memory=2g --memory-swap=3g --network "$NETWORK" \
  ${alias_args[@]+"${alias_args[@]}"} \
  -v "$NAME-docker:/var/lib/docker" "$@" \
  "$IMAGE" sleep infinity >/dev/null

docker exec "$NAME" sh -c '
  mkdir -p /sys/fs/cgroup/init
  for p in $(cat /sys/fs/cgroup/cgroup.procs); do echo $p > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null; done
  echo "+cpuset +cpu +io +memory +pids" > /sys/fs/cgroup/cgroup.subtree_control'
docker exec -d "$NAME" sh -c 'rm -rf /var/run/docker.pid /var/run/docker.sock /var/run/docker/containerd; dockerd > /var/log/dockerd.log 2>&1'

for _ in $(seq 1 30); do
  docker exec "$NAME" docker info >/dev/null 2>&1 && { echo "$NAME: dockerd 준비됨"; exit 0; }
  sleep 2
done
echo "$NAME: dockerd가 뜨지 않았습니다(/var/log/dockerd.log 확인)" >&2
exit 1
