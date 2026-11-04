#!/usr/bin/env bash
# 서버 컨테이너를 재시작(docker restart/start)한 뒤 안쪽 Docker와 컨테이너들을 다시 살립니다.
# 사용: ./recover-server.sh <서버 컨테이너 이름>
# 바깥 컨테이너가 다시 뜨면 cgroup 위임과 dockerd가 사라지고, 안쪽 컨테이너는 옛 실행 정보 때문에 자동으로 시작되지 못합니다.
set -euo pipefail
NAME="${1:?서버 컨테이너 이름이 필요합니다}"

if ! docker exec "$NAME" docker info >/dev/null 2>&1; then
docker exec "$NAME" sh -c '
  mkdir -p /sys/fs/cgroup/init
  for p in $(cat /sys/fs/cgroup/cgroup.procs); do echo $p > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null; done
  echo "+cpuset +cpu +io +memory +pids" > /sys/fs/cgroup/cgroup.subtree_control'
docker exec -d "$NAME" sh -c 'rm -rf /var/run/docker.pid /var/run/docker.sock /var/run/docker/containerd; dockerd > /var/log/dockerd.log 2>&1'
for _ in $(seq 1 30); do docker exec "$NAME" docker info >/dev/null 2>&1 && break; sleep 2; done
fi
sleep 5
docker exec "$NAME" sh -c 'ids=$(docker ps -aq --filter status=exited --filter status=created); [ -z "$ids" ] || docker start $ids >/dev/null'
docker exec "$NAME" docker ps --format "$NAME: {{.Names}} {{.Status}}"
