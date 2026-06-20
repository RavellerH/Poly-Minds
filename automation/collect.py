# Hourly collector: snapshots Polymarket category/trending data to
# data/snapshots/{date}/{hour}.json, then diffs against the previous
# snapshot and alerts on any market whose probability moved more than
# ALERT_THRESHOLD_PCT points since the last run.

import glob
import json
import os
from datetime import datetime, timezone

from lib import gamma, telegram

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")
ALERTS_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "alerts.json")
ALERT_THRESHOLD_PCT = 8  # matches the dashboard's DIVERGENCE_THRESHOLD_PCT
MAX_ALERT_LOG_ENTRIES = 50


def build_snapshot():
    tags = gamma.fetch_tags()
    categories = {cat["key"]: gamma.collect_category(cat, tags) for cat in gamma.CATEGORIES}
    trending = gamma.collect_trending()
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categories": categories,
        "trending": trending,
    }


def find_previous_snapshot():
    files = sorted(glob.glob(os.path.join(DATA_DIR, "*", "*.json")))
    return files[-1] if files else None


def load_snapshot(path):
    with open(path) as f:
        return json.load(f)


def all_markets(snapshot):
    markets = list(snapshot.get("trending", []))
    for markets_in_cat in snapshot.get("categories", {}).values():
        markets.extend(markets_in_cat)
    return {m["id"]: m for m in markets if m.get("id")}


def find_moves(previous, current):
    if not previous:
        return []
    prev_markets = all_markets(previous)
    curr_markets = all_markets(current)
    moves = []
    for market_id, market in curr_markets.items():
        prev = prev_markets.get(market_id)
        if not prev:
            continue
        delta_pct = (market["probability"] - prev["probability"]) * 100
        if abs(delta_pct) >= ALERT_THRESHOLD_PCT:
            moves.append({"market": market, "deltaPct": round(delta_pct, 1)})
    moves.sort(key=lambda m: abs(m["deltaPct"]), reverse=True)
    return moves


def record_alert_log(moves, timestamp):
    log = []
    if os.path.exists(ALERTS_PATH):
        with open(ALERTS_PATH) as f:
            log = json.load(f)

    entry = {
        "timestamp": timestamp.isoformat(),
        "moves": [
            {
                "question": m["market"]["question"],
                "url": m["market"]["url"],
                "probability": m["market"]["probability"],
                "deltaPct": m["deltaPct"],
            }
            for m in moves
        ],
    }
    log.append(entry)
    log = log[-MAX_ALERT_LOG_ENTRIES:]

    with open(ALERTS_PATH, "w") as f:
        json.dump(log, f, indent=2)


def format_alert(moves):
    lines = [f"*Polymarket Pulse — {len(moves)} probability shift(s) ≥ {ALERT_THRESHOLD_PCT}pp this hour*"]
    for m in moves[:10]:
        market = m["market"]
        sign = "+" if m["deltaPct"] > 0 else ""
        pct = round(market["probability"] * 100)
        lines.append(f"\n{sign}{m['deltaPct']}pp -> {pct}%: {market['question']}\n{market['url']}")
    return "\n".join(lines)


def main():
    previous_path = find_previous_snapshot()
    previous = load_snapshot(previous_path) if previous_path else None

    current = build_snapshot()

    now = datetime.now(timezone.utc)
    out_dir = os.path.join(DATA_DIR, now.strftime("%Y-%m-%d"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{now.strftime('%H')}.json")
    with open(out_path, "w") as f:
        json.dump(current, f, indent=2)
    print(f"[collect] wrote {out_path}")

    moves = find_moves(previous, current)
    if moves:
        record_alert_log(moves, now)
        telegram.send(format_alert(moves))
    else:
        print("[collect] no moves above threshold")


if __name__ == "__main__":
    main()
