#!/usr/bin/env python3
"""k6 결과 화면(HTML)에서 이 컴퓨터의 로컬 경로를 지운 사본을 만든다. 보고서 옆에 올려 공유할 때 쓴다.

k6 웹 대시보드 HTML은 그래프 데이터를 <script id="data"> 안에 gzip+base64로 담고 있고,
그 안의 스크립트 경로(scriptPath)에 이 컴퓨터의 절대 경로가 들어간다. 그 앞부분을 지워 저장소 기준 경로로 바꾼다.

사용: python3 tools/share-html.py results/dev/<파일>.html reports/dev/<폴더>/
"""
import base64
import gzip
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, dest_dir = Path(sys.argv[1]), Path(sys.argv[2])
    html = src.read_text(encoding="utf-8")
    m = re.search(r'(<script id="data"[^>]*>)(.*?)(</script>)', html, re.S)
    if not m:
        sys.exit(f"k6 결과 데이터가 없는 HTML입니다: {src}")

    data = gzip.decompress(base64.b64decode(m.group(2).strip())).decode("utf-8")
    data = data.replace(f"file://{REPO}/", "").replace(str(REPO) + "/", "")
    if "/Users/" in data or "/home/" in data:
        sys.exit("로컬 경로가 남아 있어 만들지 않았습니다. 직접 확인하세요.")

    packed = base64.b64encode(gzip.compress(data.encode("utf-8"))).decode("ascii")
    out = html[: m.start(2)] + packed + html[m.end(2):]
    if "/Users/" in out or "/home/" in out:
        sys.exit("HTML 본문에 로컬 경로가 남아 있어 만들지 않았습니다. 직접 확인하세요.")

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    dest.write_text(out, encoding="utf-8")
    print(dest)


if __name__ == "__main__":
    main()
