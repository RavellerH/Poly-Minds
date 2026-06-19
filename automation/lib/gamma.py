# Gamma API access for the automation collectors.
#
# Deliberately mirrors js/polymarket.js's legacy /markets and /events calls
# (not the unverified /keyset endpoints — see DESIGN.md for why those were
# reverted) since those are the only endpoints this project has confirmed
# work in production.

import json

import requests

GAMMA = "https://gamma-api.polymarket.com"

# Subset of js/config.js's INTEREST_TAGS — the "balanced crypto/finance/AI"
# scope requested, not the full 8-category dashboard list.
CATEGORIES = [
    {"key": "ai", "label": "AI & Tech", "slugs": ["ai", "technology", "artificial-intelligence"]},
    {"key": "crypto", "label": "Crypto", "slugs": ["crypto", "cryptocurrency", "bitcoin", "ethereum", "defi"]},
    {"key": "finance", "label": "Finance", "slugs": ["finance", "economy", "fed", "macro", "markets"]},
]


def fetch_json(url, timeout=15):
    res = requests.get(url, timeout=timeout)
    res.raise_for_status()
    return res.json()


def _parse_json_field(field, fallback):
    if isinstance(field, list):
        return field
    if not isinstance(field, str):
        return fallback
    try:
        return json.loads(field)
    except (TypeError, ValueError):
        return fallback


def normalize_market(raw):
    outcomes = _parse_json_field(raw.get("outcomes"), ["Yes", "No"])
    prices = [float(p) for p in _parse_json_field(raw.get("outcomePrices"), [])]
    yes_idx = next((i for i, o in enumerate(outcomes) if "yes" in str(o).lower()), -1)
    probability = (prices[yes_idx] if yes_idx >= 0 else prices[0]) if prices else 0.5

    return {
        "id": raw.get("id") or raw.get("conditionId"),
        "conditionId": raw.get("conditionId"),
        "question": raw.get("question") or raw.get("title") or "Untitled market",
        "probability": probability,
        "change24h": raw.get("oneDayPriceChange") if isinstance(raw.get("oneDayPriceChange"), (int, float)) else 0,
        "volume": float(raw.get("volume") or raw.get("volumeNum") or 0),
        "liquidity": float(raw.get("liquidity") or raw.get("liquidityNum") or 0),
        "endDate": raw.get("endDate"),
        "slug": raw.get("slug"),
        "url": f"https://polymarket.com/event/{raw['slug']}" if raw.get("slug") else "https://polymarket.com",
    }


def fetch_tags():
    tags = fetch_json(f"{GAMMA}/tags")
    return tags if isinstance(tags, list) else []


def get_tag_ids_for_slugs(slugs, tags):
    wanted = set(slugs)
    return [t["id"] for t in tags if str(t.get("slug", "")).lower() in wanted]


def collect_category(category, tags, limit=12):
    markets = []
    try:
        tag_ids = get_tag_ids_for_slugs(category["slugs"], tags)
        for tag_id in tag_ids:
            events = fetch_json(f"{GAMMA}/events?tag_id={tag_id}&active=true&closed=false&limit=20")
            for event in events:
                markets.extend(event.get("markets") or [event])
    except requests.RequestException as exc:
        print(f"[gamma] category {category['key']} fetch failed: {exc}")

    if not markets:
        try:
            all_markets = fetch_json(f"{GAMMA}/markets?active=true&closed=false&order=volume&ascending=false&limit=100")
            keywords = [s.replace("-", " ") for s in category["slugs"]]
            markets = [m for m in all_markets if any(kw in (m.get("question") or "").lower() for kw in keywords)]
        except requests.RequestException as exc:
            print(f"[gamma] category {category['key']} fallback fetch failed: {exc}")
            markets = []

    normalized = [normalize_market(m) for m in markets]
    deduped = list({m["id"]: m for m in normalized if m["id"]}.values())
    deduped.sort(key=lambda m: m["volume"], reverse=True)
    return deduped[:limit]


def collect_trending(limit=50):
    try:
        all_markets = fetch_json(f"{GAMMA}/markets?active=true&closed=false&order=volume&ascending=false&limit={limit}")
    except requests.RequestException as exc:
        print(f"[gamma] trending fetch failed: {exc}")
        return []
    return [normalize_market(m) for m in all_markets]
