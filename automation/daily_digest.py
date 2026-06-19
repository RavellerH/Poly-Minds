# Daily digest: reads the day's hourly snapshots, summarizes per-category
# movement (first-vs-last probability, biggest mover, total volume), writes
# data/digests/{date}.json, and sends a Telegram summary.

import glob
import json
import os
from datetime import datetime, timezone

from lib import telegram

SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")
DIGEST_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "digests")


def load_today_snapshots(date_str):
    files = sorted(glob.glob(os.path.join(SNAPSHOT_DIR, date_str, "*.json")))
    return [json.load(open(f)) for f in files]


def summarize_category(key, label, snapshots):
    by_market = {}
    for snap in snapshots:
        for m in snap.get("categories", {}).get(key, []):
            by_market.setdefault(m["id"], []).append(m)

    if not by_market:
        return {"label": label, "marketCount": 0}

    movers = []
    total_volume = 0
    for market_id, points in by_market.items():
        first, last = points[0], points[-1]
        total_volume = max(total_volume, last["volume"])
        delta_pct = round((last["probability"] - first["probability"]) * 100, 1)
        movers.append({"question": last["question"], "url": last["url"], "deltaPct": delta_pct})

    movers.sort(key=lambda m: abs(m["deltaPct"]), reverse=True)
    return {
        "label": label,
        "marketCount": len(by_market),
        "topMover": movers[0] if movers else None,
        "totalVolume": total_volume,
    }


def format_digest(date_str, summaries):
    lines = [f"*Polymarket Pulse — daily digest {date_str}*"]
    for summary in summaries:
        if summary["marketCount"] == 0:
            lines.append(f"\n*{summary['label']}*: no data")
            continue
        mover = summary.get("topMover")
        mover_line = f"biggest move: {mover['deltaPct']:+.1f}pp on \"{mover['question']}\"" if mover else "no notable moves"
        lines.append(f"\n*{summary['label']}*: {summary['marketCount']} markets tracked, {mover_line}")
    return "\n".join(lines)


def main():
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snapshots = load_today_snapshots(date_str)
    if not snapshots:
        print(f"[daily_digest] no snapshots found for {date_str} — skipping")
        return

    from lib import gamma  # local import to avoid unused dep when run standalone

    summaries = [summarize_category(cat["key"], cat["label"], snapshots) for cat in gamma.CATEGORIES]

    os.makedirs(DIGEST_DIR, exist_ok=True)
    digest_path = os.path.join(DIGEST_DIR, f"{date_str}.json")
    with open(digest_path, "w") as f:
        json.dump({"date": date_str, "categories": summaries}, f, indent=2)
    print(f"[daily_digest] wrote {digest_path}")

    telegram.send(format_digest(date_str, summaries))


if __name__ == "__main__":
    main()
