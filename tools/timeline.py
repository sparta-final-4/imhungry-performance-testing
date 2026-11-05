#!/usr/bin/env python3
"""k6 HTML 보고서(K6_WEB_DASHBOARD_EXPORT)에서 10초 단위 시간대별 표를 뽑는다.

k6 콘솔 요약은 전체 구간을 합친 값이라, 부하를 올리다 어디서 꺾였는지가 묻힌다.
HTML 보고서 안에 들어 있는 10초 단위 기록을 꺼내 마크다운 표로 보여 준다.

    python3 tools/timeline.py results/dev/products-list-20261105-110416.html

열: 경과(초), 가상 사용자, 초당 요청, 실패율, 응답 시간 p50·p95·p99·최대(ms).
"""
import base64
import gzip
import json
import re
import sys

TREND = ["avg", "max", "med", "min", "p(90)", "p(95)", "p(99)"]


def load_events(path):
    html = open(path, encoding="utf-8").read()
    m = re.search(r'<script[^>]*id="data"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise SystemExit(f"k6 보고서 데이터를 찾지 못했습니다: {path}")
    text = gzip.decompress(base64.b64decode(m.group(1).strip())).decode()
    return [json.loads(line) for line in text.split("\n") if line.strip()]


def main():
    if len(sys.argv) != 2:
        raise SystemExit("사용: python3 tools/timeline.py <k6 HTML 보고서>")
    events = load_events(sys.argv[1])
    # 기록(snapshot)의 값 순서는 그 기록까지 나온 지표 이름을 정렬한 순서다.
    # 준비 단계(setup)가 길면 중간에 새 지표가 생겨 순서가 바뀌므로 기록마다 다시 계산한다.
    seen, snaps = set(), []
    for e in events:
        if e["event"] == "metric":
            seen.update(e["data"])
        elif e["event"] == "snapshot":
            names = sorted(seen)
            row = {n: e["data"][i] for i, n in enumerate(names) if i < len(e["data"])}
            # 요청 기록이 없는 기록(준비 단계 등)은 건너뛴다.
            if row.get("time") and row.get("vus") and row.get("http_req_duration"):
                snaps.append(row)
    if not snaps:
        raise SystemExit("시간대별 기록이 없습니다.")
    t0 = snaps[0]["time"][0]
    print("| 경과(초) | 가상 사용자 | 초당 요청 | 실패율 | p50 | p95 | p99 | 최대 |")
    print("|---|---|---|---|---|---|---|---|")
    for s in snaps:
        dur = dict(zip(TREND, s["http_req_duration"]))
        reqs = s["http_reqs"]
        failed = s["http_req_failed"][0] if s.get("http_req_failed") else 0
        elapsed = (s["time"][0] - t0) / 1000 + 10  # 기록은 10초 구간이 끝날 때 남는다
        print(f"| {elapsed:.0f} | {s['vus'][0]:.0f} | {reqs[1]:.0f} | {failed * 100:.2f}% "
              f"| {dur['med']:.0f}ms | {dur['p(95)']:.0f}ms | {dur['p(99)']:.0f}ms | {dur['max']:,.0f}ms |")


if __name__ == "__main__":
    main()
