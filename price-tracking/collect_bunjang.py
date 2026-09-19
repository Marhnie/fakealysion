"""번개장터 디지몬 카드게임 한글판 시세 수집기.

watchlist.txt 를 읽어 번개장터 공개 검색 API(판매중 매물)를 조회하고,
price-history.csv 에 오늘 행을 추가한 뒤 report-YYYY-MM-DD.md 를 만든다.
사용: python collect_bunjang.py [--date YYYY-MM-DD]
"""
import csv, datetime, json, re, statistics, sys, time, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
WATCH, HIST = HERE / "watchlist.txt", HERE / "price-history.csv"
HEADER = ["date", "query", "kind", "item", "lowest_price", "median_price", "listing_count", "url"]
API = "https://api.bunjang.co.kr/api/1/find_v2.json"

EXCLUDE = ["일판", "일본", "jp판", "영판", "영문", "중국", "중판", "일괄", "묶음", "빈박스", "빈 박스", "구매", "삽니다",
           "psa", "brg", "등급", "구디지몬", "구 디지몬", "교환만", "카톤", "슬리브", "플레이매트", "디덱", "덱케이스"]
MULTI_BOX = re.compile(r"([2-9]|\d{2,})\s*(박스|box|bx)", re.I)
PARALLEL = ["페레", "페러렐", "패러렐", "패레렐", "parallel", "-p ", "sec-p", "sr-p"]
CARD_EXCLUDE = ["세트", "뭉치", "오르골", "에칭", "킹레어", "/", ",", "장 ", "등"]
CODE = re.compile(r"\b(?:bt|ex|st|lm|rb|ad|p)\d*-\d+\b", re.I)


def norm(s):
    return re.sub(r"\s+", "", s.lower())


def load_watchlist():
    items, kind = [], None
    for line in WATCH.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line.lower() == "# boxes":
            kind = "box"
        elif line.lower() == "# cards":
            kind = "card"
        elif line and not line.startswith("#") and kind:
            parts = [p.strip() for p in line.split("|")]
            if len(parts) == 3:
                items.append({"kind": kind, "item": parts[0],
                              "queries": [q for q in parts[1].split(";") if q.strip()],
                              "keys": [norm(k) for k in parts[2].split(";") if k.strip()]})
    return items


def search(q):
    url = API + "?" + urllib.parse.urlencode({"q": q, "order": "price_asc", "page": 0, "n": 100})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("list", [])


def keep(it, x):
    name = x.get("name", "")
    n, low = norm(name), name.lower()
    if str(x.get("status")) != "0" or x.get("ad"):  # 판매중만, 광고 제외
        return False
    # 키워드는 '+'로 묶으면 모두 포함해야 매칭
    if not any(all(p in n for p in k.split("+")) for k in it["keys"]):
        return False
    if any(norm(e) in n for e in EXCLUDE):
        return False
    if it["kind"] == "box":
        return ("박스" in n or "box" in n) and "미개봉" in n and not MULTI_BOX.search(name)
    # 카드: 다른 카드번호가 적혀 있으면 다른 판(재판/동명 카드)이므로 제외
    targets = {k for k in it["keys"] if CODE.fullmatch(k)}
    if any(c.lower() not in targets for c in CODE.findall(name)):
        return False
    return ("박스" not in n and not any(p in low + " " for p in PARALLEL)
            and not any(e in low for e in CARD_EXCLUDE))


def collect(items):
    rows, detail = [], {}
    for it in items:
        seen, kept, err = set(), [], None
        for q in it["queries"]:
            try:
                for x in search(q):
                    if x["pid"] not in seen:
                        seen.add(x["pid"])
                        if keep(it, x):
                            kept.append(x)
            except Exception as e:  # noqa: BLE001
                err = f"{type(e).__name__}: {e}"
            time.sleep(1)
        prices = sorted(int(x["price"]) for x in kept if str(x.get("price", "")).isdigit() and int(x["price"]) > 0)
        q0 = it["queries"][0]
        url = "https://m.bunjang.co.kr/search/products?" + urllib.parse.urlencode({"q": q0, "order": "price_asc"})
        if err and not seen:
            vals = ["실패", "실패", "실패"]
        elif prices:
            vals = [prices[0], int(statistics.median(prices)), len(prices)]
        else:
            vals = ["매물없음", "매물없음", 0]
        rows.append({"query": "번개장터:" + q0, "kind": it["kind"], "item": it["item"],
                     "lowest_price": vals[0], "median_price": vals[1], "listing_count": vals[2], "url": url})
        detail[it["item"]] = {"error": err, "raw": len(seen),
                              "kept": [(int(x["price"]), x["name"], x["pid"]) for x in sorted(kept, key=lambda x: int(x["price"]))]}
    return rows, detail


def read_hist():
    if not HIST.exists():
        return []
    with HIST.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def fmt(v):
    return f"{v:,}원" if isinstance(v, int) else str(v)


def delta(cur, base):
    if cur is None or base is None:
        return "비교 기준 없음"
    d = cur - base
    return f"{d:+,}원 ({d / base * 100:+.1f}%)" if base else f"{d:+,}원"


def baseline(hist, key, today, days):
    """days=None: 가장 최근 이전 날짜. 아니면 today-days 이전(이하) 중 가장 가까운 날짜."""
    cands = [r for r in hist if (r["query"], r["kind"], r["item"]) == key and r["date"] < today
             and num(r["median_price"]) is not None]
    if days is not None:
        lim = (datetime.date.fromisoformat(today) - datetime.timedelta(days=days)).isoformat()
        cands = [r for r in cands if r["date"] <= lim]
    return max(cands, key=lambda r: r["date"]) if cands else None


def main():
    today = datetime.date.today().isoformat()
    if "--date" in sys.argv:
        today = sys.argv[sys.argv.index("--date") + 1]
    items = load_watchlist()
    rows, detail = collect(items)
    hist = read_hist()
    existing = {(r["date"], r["query"], r["item"]) for r in hist}
    new = [dict(date=today, **r) for r in rows if (today, r["query"], r["item"]) not in existing]
    skipped = len(rows) - len(new)
    write_header = not HIST.exists()
    with HIST.open("a", encoding="utf-8-sig" if write_header else "utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        if write_header:
            w.writeheader()
        w.writerows(new)
    (HERE / f"listings-{today}.json").write_text(json.dumps(detail, ensure_ascii=False, indent=1), encoding="utf-8")

    hist = read_hist()
    today_rows = [r for r in hist if r["date"] == today and r["query"].startswith("번개장터:")]
    movers, out = [], [f"# 디지몬 카드게임 한글판 번개장터 시세 리포트 — {today}", "",
                       "> 출처: 번개장터 판매중 매물(공개 검색 API, 낮은가격순 상위 100건/검색어). "
                       "집계 기준은 watchlist.txt 머리말 참고. 중고거래 특성상 **중간값**을 주 지표로 본다.", ""]
    for kind, title in (("box", "박스 가격 추이"), ("card", "카드 시세 추이")):
        out += [f"## {title}", "", "| 항목 | 최저가 | 중간값 | 매물 수 | 전회 대비(중간값) | 7일 전 대비 | 30일 전 대비 |",
                "|---|---|---|---|---|---|---|"]
        for r in [r for r in today_rows if r["kind"] == kind]:
            key, cur = (r["query"], r["kind"], r["item"]), num(r["median_price"])
            b = [baseline(hist, key, today, d) for d in (None, 7, 30)]
            ds = [delta(cur, num(x["median_price"])) if x else "비교 기준 없음" for x in b]
            if cur is not None and b[0] and num(b[0]["median_price"]):
                bp = num(b[0]["median_price"])
                movers.append((( cur - bp) / bp * 100, cur - bp, r["item"]))
            out.append(f"| {r['item']} | {fmt(num(r['lowest_price']) or r['lowest_price'])} | "
                       f"{fmt(cur if cur is not None else r['median_price'])} | {r['listing_count']} | " + " | ".join(ds) + " |")
        out.append("")
    out += ["## 크게 오른/내린 상위 5개 (전회 대비 중간값)", ""]
    if movers:
        up = sorted([m for m in movers if m[0] > 0], reverse=True)[:5]
        dn = sorted([m for m in movers if m[0] < 0])[:5]
        out += ["**상승**: " + (", ".join(f"{m[2]} {m[1]:+,}원({m[0]:+.1f}%)" for m in up) or "없음"),
                "", "**하락**: " + (", ".join(f"{m[2]} {m[1]:+,}원({m[0]:+.1f}%)" for m in dn) or "없음"), ""]
    else:
        out += ["비교 기준 없음 (번개장터 기준 기록이 오늘 하루뿐).", ""]
    notes = []
    for r in today_rows:
        d = detail.get(r["item"], {})
        if r["lowest_price"] == "실패":
            notes.append(f"- 수집 실패: {r['item']} — {d.get('error')}")
        elif r["lowest_price"] == "매물없음":
            notes.append(f"- 매물 없음: {r['item']} (검색 결과 {d.get('raw', '?')}건 중 조건 충족 0건)")
        elif num(r["listing_count"]) is not None and num(r["listing_count"]) <= 2:
            notes.append(f"- 표본 적음({r['listing_count']}건): {r['item']} — 시세 신뢰도 낮음")
        b = baseline(hist, (r["query"], r["kind"], r["item"]), today, None)
        if b and num(b["listing_count"]) and num(r["listing_count"]) is not None and num(r["listing_count"]) <= num(b["listing_count"]) / 2:
            notes.append(f"- 매물 급감: {r['item']} {b['listing_count']}→{r['listing_count']}건")
    if skipped:
        notes.append(f"- 같은 날짜·검색어 기록이 이미 있어 {skipped}행은 추가하지 않음")
    out += ["## 특이사항", ""] + (notes or ["- 없음"]) + ["", f"집계에 쓴 개별 매물 목록: listings-{today}.json", ""]
    (HERE / f"report-{today}.md").write_text("\n".join(out), encoding="utf-8")
    print(f"rows added: {len(new)}, skipped: {skipped}")
    for r in today_rows:
        print(r["kind"], r["item"], r["lowest_price"], r["median_price"], r["listing_count"])


if __name__ == "__main__":
    main()
