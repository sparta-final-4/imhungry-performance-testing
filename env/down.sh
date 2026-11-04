#!/usr/bin/env bash
# 부하 테스트 환경을 내립니다(서버 컨테이너 4개와 포트 중계 컨테이너 삭제).
#   ./down.sh            컨테이너만 지웁니다. 데이터(MySQL·Kafka)와 서버 안쪽 이미지는 볼륨에 남습니다.
#   ./down.sh --volumes  서버 볼륨까지 지웁니다. MySQL 데이터가 사라지므로 다시 올릴 때 덤프를 복원해야 합니다.
set -euo pipefail
docker rm -f mon-ports app-server data-server search-server monitoring-server 2>/dev/null || true
if [ "${1:-}" = "--volumes" ]; then
  docker volume rm app-server-docker data-server-docker search-server-docker monitoring-server-docker data-server-mysql data-server-kafka 2>/dev/null || true
fi
echo "내렸습니다."
