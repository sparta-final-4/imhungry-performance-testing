#!/usr/bin/env python3
"""k6 결과(JSON)와 Prometheus 지표로 보고서에 붙일 표를 만든다. 손으로 집계하다 생기는 실수를 줄이려는 도구다.

사용법 (저장소 루트에서):
  python3 tools/summarize.py --prefix cart-add-burst --last 3 --steps 50:15,100:15,250:15,500:15 \
      --warmup 10 --uri /api/cart-items --method POST
  python3 tools/summarize.py --prefix cart-read --last 3 --steps 200:60,500:60,1000:60,2000:60 \
      --uri /api/cart-items --method GET

- --prefix: results/ 아래 `<prefix>-<날짜>-<시각>.json` 중 가장 최근 --last개를 쓴다.
- --steps: 단계 이름:초 목록. 단계 이름은 목표 속도나 구분 이름이고, 초는 그 단계가 이어진 시간이다.
- --warmup: 앞의 워밍업 시간(초). 서버 지표 구간을 맞추는 데만 쓴다.
- --constant: 단계마다 초당 요청 수를 고정한 시나리오(주문·담기 순간 몰림)라면 단계별 목표 요청 수(속도 × 시간 + 1)와 실제로 보낸 요청 수를 견준다.
- --uri, --method: 앱이 받은 요청 수로 부하 시작 시각을 잡고 앱 쪽 p95를 읽는 데 쓴다.
- 서버 지표 구간은 앱이 요청을 받기 시작한 시각에서 --steps 순서대로 잘라 추정한다(경계에 ±10초 정도 오차가 있다).
- Prometheus 주소는 --prom(기본 http://127.0.0.1:9090).
표는 3회 중앙값과 회차별 값을 마크다운으로 출력한다. 요청 1건당 쿼리 수는 MySQL 초당 쿼리 수를 앱 초당 요청 수로 나눈 값이다.
"""
import argparse
import glob
import json
import os
import re
import statistics as st
import time
import urllib.parse
import urllib.request


def prom_range(base, expr, start, end, step=5):
    url = f"{base}/api/v1/query_range?" + urllib.parse.urlencode({"query": expr, "start": start, "end": end, "step": step})
    result = json.load(urllib.request.urlopen(url))["data"]["result"]
    if not result:
        return {}
    return {int(float(t)): float(v) for t, v in result[0]["values"] if v != "NaN"}


def stamp_to_epoch(path):
    m = re.search(r"-(\d{8}-\d{6})\.json$", path)
    return time.mktime(time.strptime(m.group(1), "%Y%m%d-%H%M%S")) if m else None


def median(values):
    values = [v for v in values if v == v]
    return st.median(values) if values else float("nan")


def fmt(v, digits=0):
    return "-" if v != v else f"{v:,.{digits}f}"


def k6_steps(metrics, step_names):
    """단계별 하위 지표(태그 step)가 있으면 단계별 응답 시간 값을 돌려준다."""
    rows = {}
    for name in step_names:
        # step:50이 step:500과 섞이지 않도록 태그 값이 정확히 같은 지표만 고른다.
        exact = re.compile(rf"step:{re.escape(name)}(?=[,}}])")
        d = next((v for k, v in metrics.items() if k.startswith("http_req_duration{") and exact.search(k)), None)
        if not d:
            continue
        dropped = metrics.get(f"dropped_iterations{{step:{name}}}", {}).get("count", 0)
        sent = next((v.get("count") for k, v in metrics.items() if k.startswith("http_reqs{") and exact.search(k)), None)
        rows[name] = dict(p50=d.get("med"), p90=d.get("p(90)"), p95=d.get("p(95)"), p99=d.get("p(99)"), max=d.get("max"), dropped=dropped, sent=sent)
    return rows


def server_steps(base, uri, method, files, warmup, steps):
    """앱이 받은 요청 수로 부하 시작을 잡고 단계 구간마다 서버 지표를 읽는다."""
    selector = f'uri="{uri}",method="{method}"'
    out = []
    for f in files:
        start = stamp_to_epoch(f)
        end = start + 3600
        app = prom_range(base, f"sum(rate(http_server_requests_seconds_count{{{selector}}}[10s]))", start, end)
        times = sorted(t for t, v in app.items() if v > 5)
        if not times:
            out.append(None)
            continue
        t0 = times[0] - 5 + warmup
        queries = {
            "pool": "sum(hikaricp_connections_active)",
            "pending": "sum(hikaricp_connections_pending)",
            "mysql": "mysql_global_status_threads_running",
            "cpu": "process_cpu_usage*100",
            "gc": "sum(rate(jvm_gc_pause_seconds_sum[10s]))*100",
            "heap": 'sum(jvm_memory_used_bytes{area="heap"})/1048576',
            "p95": f"histogram_quantile(0.95,sum by (le)(rate(http_server_requests_seconds_bucket{{{selector}}}[10s])))",
            "p99": f"histogram_quantile(0.99,sum by (le)(rate(http_server_requests_seconds_bucket{{{selector}}}[10s])))",
        }
        series = {k: prom_range(base, q, start, end) for k, q in queries.items()}
        mq = prom_range(base, "rate(mysql_global_status_queries[10s])", start, end)
        per_step = {}
        cursor = t0
        for name, seconds in steps:
            lo, hi = cursor, cursor + seconds
            cursor = hi
            in_step = [t for t in app if lo <= t < hi]
            qpr = [mq[t] / app[t] for t in in_step if t in mq and app[t] > 20]

            def peak(d, scale=1.0):
                vals = [d[t] for t in d if lo <= t < hi]
                return max(vals) * scale if vals else float("nan")

            per_step[name] = dict(
                rate=st.mean([app[t] for t in in_step]) if in_step else float("nan"),
                p95=peak(series["p95"], 1000), p99=peak(series["p99"], 1000),
                pool=peak(series["pool"]), pending=peak(series["pending"]), mysql=peak(series["mysql"]),
                qpr=st.median(qpr) if qpr else float("nan"),
                cpu=peak(series["cpu"]), gc=peak(series["gc"]), heap=peak(series["heap"]),
            )
        out.append(per_step)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--last", type=int, default=3)
    ap.add_argument("--steps", required=True)
    ap.add_argument("--warmup", type=int, default=0)
    ap.add_argument("--uri", required=True)
    ap.add_argument("--method", default="GET")
    ap.add_argument("--since", help="이 시각(YYYYMMDD-HHMMSS) 이후에 시작한 실행만 쓴다")
    ap.add_argument("--until", help="이 시각(YYYYMMDD-HHMMSS) 이전에 시작한 실행만 쓴다")
    ap.add_argument("--constant", action="store_true", help="단계마다 초당 요청 수를 고정한 시나리오(주문·담기 순간 몰림)라면 목표 요청 수를 계산한다")
    ap.add_argument("--prom", default="http://127.0.0.1:9090")
    ap.add_argument("--results", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results"))
    a = ap.parse_args()

    steps = [(s.split(":")[0], int(s.split(":")[1])) for s in a.steps.split(",")]
    names = [n for n, _ in steps]
    candidates = sorted(glob.glob(os.path.join(a.results, f"{a.prefix}-????????-??????.json")), key=os.path.getmtime)
    # 확인용 실행이 섞이지 않게 --since/--until(파일 이름의 날짜-시각, 예: 20261104-040000)으로 기간을 좁힐 수 있다.
    in_range = [f for f in candidates
                if (not a.since or re.search(r"-(\d{8}-\d{6})\.json$", f).group(1) >= a.since)
                and (not a.until or re.search(r"-(\d{8}-\d{6})\.json$", f).group(1) <= a.until)]
    files = in_range[-a.last:]
    if not files:
        raise SystemExit(f"결과 파일이 없습니다: {a.results}/{a.prefix}-*.json")

    metrics = [json.load(open(f))["metrics"] for f in files]
    print(f"결과 {len(files)}개: " + ", ".join(os.path.basename(f)[len(a.prefix) + 1:-5] for f in files) + "\n")

    k6 = [k6_steps(m, names) for m in metrics]
    if any(k6):
        print("### k6 단계별 응답 시간 (3회 중앙값)\n")
        # 단계마다 목표 요청 수(속도 × 시간 + 1)와 실제로 보낸 요청 수를 견준다. 단계 이름이 초당 요청 수일 때만 계산한다.
        seconds = dict(steps)
        print("| 단계 | p50 | p90 | p95 | p99 | 최대 | 보낸 요청 / 목표 (3회 중앙값) |\n|---|---|---|---|---|---|---|")
        for n in names:
            rows = [r[n] for r in k6 if n in r]
            if rows:
                g = lambda k: median([x[k] for x in rows if x[k] is not None])
                planned = f" / {int(n) * seconds[n] + 1:,}" if a.constant and n.isdigit() else ""
                print(f"| {n} | {fmt(g('p50'))}ms | {fmt(g('p90'))}ms | {fmt(g('p95'))}ms | {fmt(g('p99'))}ms | {fmt(g('max'))}ms | {fmt(g('sent'))}{planned} |")
        print()
        # 단계별 못 따라간 요청의 합이 전체와 다르면 알린다(단계 태그가 붙지 않은 곳에서 생겼다는 뜻이다).
        for i, (rows, m) in enumerate(zip(k6, metrics), 1):
            by_step = sum(r["dropped"] for r in rows.values())
            total = m.get("dropped_iterations", {}).get("count", 0)
            if by_step != total:
                print(f"> 주의: {i}회차의 단계별 못 따라간 요청 합({by_step:,})이 전체({total:,})와 다릅니다. 전체 값을 기준으로 보세요.")
        print()
    else:
        print("(k6 결과에 단계별 하위 지표가 없습니다. 전체 값만 아래에 적습니다.)\n")

    print("### k6 전체 (회차별)\n")
    print("| 회차 | p50 | p90 | p95 | p99 | 최대 | 요청 수 | 못 따라간 요청 | 실패율 |\n|---|---|---|---|---|---|---|---|---|")
    for i, m in enumerate(metrics, 1):
        h = m["http_req_duration"]
        print(f"| {i} | {fmt(h['med'])}ms | {fmt(h['p(90)'])}ms | {fmt(h['p(95)'])}ms | {fmt(h['p(99)'])}ms | {fmt(h['max'])}ms | "
              f"{fmt(m['http_reqs']['count'])} | {fmt(m.get('dropped_iterations', {}).get('count', 0))} | {m['http_req_failed']['value'] * 100:.2f}% |")
    print()

    srv = server_steps(a.prom, a.uri, a.method, files, a.warmup, steps)
    if not any(srv):
        print("(Prometheus에서 앱 요청 지표를 찾지 못해 서버 지표를 건너뜁니다.)")
        return
    print("### 서버 쪽 지표 (단계별 최대, 3회 중앙값 · 범위는 괄호)\n")
    print("단계 구간은 요청 시작 시각에서 추정해 경계에 ±10초 정도 오차가 있습니다.\n")
    print("| 지표 | " + " | ".join(names) + " |\n|---|" + "---|" * len(names))
    labels = [("rate", "앱 처리 속도 평균(건/초)", 0), ("p95", "앱 p95(ms, 구간 최대)", 0), ("p99", "앱 p99(ms, 구간 최대)", 0),
              ("pool", "커넥션 풀 사용 중(최대 10)", 0), ("pending", "커넥션 풀 기다리는 요청", 0), ("mysql", "MySQL 실행 중 스레드", 0),
              ("qpr", "요청 1건당 쿼리", 1), ("cpu", "앱 프로세스 CPU(%)", 1), ("gc", "GC 멈춤(시간 중 %)", 1), ("heap", "힙 사용(MB)", 0)]
    for key, label, digits in labels:
        cells = []
        for n in names:
            vals = [s[n][key] for s in srv if s and n in s]
            med, lo, hi = median(vals), min((v for v in vals if v == v), default=float("nan")), max((v for v in vals if v == v), default=float("nan"))
            cells.append(f"{fmt(med, digits)} ({fmt(lo, digits)}~{fmt(hi, digits)})")
        print(f"| {label} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
