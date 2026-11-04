# 서버 컨테이너(app-server, data-server, search-server, monitoring-server)의 공통 바깥 이미지.
# dev 서버(Amazon Linux)처럼 안쪽에서 Docker를 실행한다. CPU 종류는 이 이미지를 빌드하는 컴퓨터를 따른다.
FROM amazonlinux:2023
RUN dnf install -y docker && dnf clean all
CMD ["sleep", "infinity"]
