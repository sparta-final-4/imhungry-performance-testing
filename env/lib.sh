# env 스크립트들이 같이 쓰는 함수. 직접 실행하지 않고 source로 불러 쓴다.

# 서버 컨테이너 안에서 docker 명령을 실행한다: inner <서버> <docker 인자...>
inner() { local s=$1; shift; docker exec "$s" docker "$@"; }

# 이미지를 서버 컨테이너 안쪽 Docker에 넣는다. 호스트에 없으면 먼저 받고, 안쪽에 이미 있으면 건너뛴다.
#   load_images <서버> <이미지...>
load_images() {
  local s=$1 img missing=()
  shift
  for img in "$@"; do
    inner "$s" image inspect "$img" >/dev/null 2>&1 && continue
    docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img" >/dev/null
    missing+=("$img")
  done
  [ ${#missing[@]} -eq 0 ] && return 0
  echo "$s: 이미지 ${#missing[@]}개를 안쪽 Docker에 넣는 중..."
  docker save "${missing[@]}" | docker exec -i "$s" docker load >/dev/null
}

# 안쪽 컨테이너를 띄운다. 이미 실행 중이면 건너뛰고, 멈춰 있으면 시작하고, 없으면 만든다.
#   start_inner <서버> <이름> <docker run 인자...>   (인자에는 이미지와 실행 인자까지 모두 넣는다)
start_inner() {
  local s=$1 name=$2; shift 2
  local state; state=$(inner "$s" inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo none)
  case "$state" in
    true)  echo "$name 이미 실행 중"; return 0;;
    false) inner "$s" start "$name" >/dev/null && echo "$name 시작(기존)"; return 0;;
  esac
  inner "$s" run -d --name "$name" --restart unless-stopped "$@" >/dev/null && echo "$name 시작"
}
