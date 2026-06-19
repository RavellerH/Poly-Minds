# DESIGN.md — Polymarket Pulse Dashboard

> Static GitHub Pages app. No backend. No login. No cost.
> Focus: AI, Crypto, Hyperliquid, Finance narrative intelligence.
> Refresh: Auto every 60 seconds.

---

## 1. Project Goal

Build a fast, read-only intelligence dashboard that aggregates Polymarket
prediction market data filtered to specific interest categories. The goal
is NOT trading — it is narrative monitoring: understanding what collective
market intelligence is "saying" about AI, crypto, Hyperliquid, and finance,
correlated with real-time news.

---

## 2. Hosting & Stack

- **Hosting:** GitHub Pages (static, free)
- **No build step required** — pure HTML + Vanilla JS + CSS
- **Tailwind CSS** via CDN (no install)
- **Font:** Inter via Google Fonts
- **State:** localStorage for cache + last-fetch timestamps
- **No Node.js, no npm, no bundler needed**

---

## 3. File Structure

```
/
├── index.html              # Main dashboard shell
├── css/
│   └── style.css           # Custom dark theme overrides
├── js/
│   ├── config.js           # API endpoints, category tags, refresh interval
│   ├── polymarket.js       # Polymarket Gamma + CLOB API fetcher
│   ├── news.js             # RSS + CryptoPanic news fetcher
│   ├── narrative.js        # Narrative synthesis logic
│   ├── renderer.js         # DOM rendering functions
│   └── app.js              # Bootstrap, scheduler, orchestration
└── DESIGN.md               # This file
```

---

## 4. API Sources (All Free, No Key Required Unless Noted)

### 4.1 Polymarket Gamma API
- Base: `https://gamma-api.polymarket.com`
- No auth required
- Endpoints used:
  - `GET /tags` — discover all category tag IDs
  - `GET /events?tag_id={id}&active=true&closed=false&limit=20` — fetch active markets by tag
  - `GET /markets?active=true&closed=false&order=volume&limit=50` — top volume markets (complement)
  - `GET /events?active=true&closed=false&order=volume&limit=20` — trending complement

### 4.2 Polymarket CLOB API
- Base: `https://clob.polymarket.com`
- No auth required for read
- Endpoints used:
  - `GET /midpoint?token_id={id}` — current probability midpoint
  - `GET /prices-history?market={conditionId}&interval=1d` — 24h price history for trend arrow

### 4.3 PolymarketScan Agent API (Bonus — No Key)
- Base: `https://gzydspfquuaudqeztorw.supabase.co/functions/v1/public-api`
- Rate limit: 30 req/min
- Endpoints used:
  - `GET /markets/trending` — trending markets signal
  - `GET /markets/ai-vs-human` — AI vs human divergence (unique signal)

### 4.4 CryptoPanic API (Free Tier)
- Base: `https://cryptopanic.com/api/v1/posts/`
- Requires free API key (register at cryptopanic.com — no credit card)
- Params: `?auth_token={key}&filter=important&currencies=BTC,ETH,HYPE`
- Returns: title, url, published_at, votes (bullish/bearish), source

### 4.5 RSS via rss2json.com (Free, 500 req/day)
- Proxy: `https://api.rss2json.com/v1/api.json?rss_url={url}&count=10`
- No key required for basic use
- Feeds:
  - Decrypt: `https://decrypt.co/feed`
  - The Block: `https://www.theblock.co/rss/all`
  - CoinDesk: `https://www.coindesk.com/arc/outboundfeeds/rss/`

---

## 5. Category Tag Mapping (Primary Interest)

Map these interest labels to Polymarket tag IDs.
Fetch `/tags` on first load and cache in localStorage for 24h.
Then match by tag slug/name:

```js
const INTEREST_TAGS = {
  primary: [
    { label: "AI & Tech",     slugs: ["ai", "technology", "artificial-intelligence"] },
    { label: "Crypto",        slugs: ["crypto", "cryptocurrency", "bitcoin", "ethereum", "defi"] },
    { label: "Hyperliquid",   slugs: ["hyperliquid", "hype", "perp-dex"] },
    { label: "Finance",       slugs: ["finance", "economy", "fed", "macro", "markets"] },
  ],
  complement: {
    label: "Trending All",
    source: "volume_sort"   // top 20 by volume regardless of tag
  }
}
```

---

## 6. UI Layout

### 6.1 Header Bar
- App name: **Polymarket Pulse**
- Last updated timestamp
- Auto-refresh countdown (60s spinner)
- Category filter tabs: [AI] [Crypto] [Hyperliquid] [Finance] [Trending]
- Dark mode only

### 6.2 Pulse Score Bar (top of content)
- 4 horizontal cards, one per primary category
- Each shows: Category name, active market count, avg probability of "yes" on top market,
  24h volume total, momentum arrow (↑↓→)
- Color coded: green (momentum up >5%), red (down), gray (flat)

### 6.3 Market Cards Grid
- Responsive grid: 3 cols desktop, 2 tablet, 1 mobile
- Each card contains:
  - Market question (truncated to 2 lines)
  - Big probability % (e.g. `73%`) with color gradient (green=high, yellow=mid, red=low)
  - 24h change arrow + delta (e.g. `↑ +4.2%`)
  - Volume badge
  - Expiry date
  - **Narrative sentence** (auto-generated — see Section 7)
  - Tag chips (AI, Crypto, etc.)
  - Link to Polymarket

### 6.4 News Feed Sidebar
- Right panel (desktop), bottom section (mobile)
- Shows last 15 news items from all RSS + CryptoPanic feeds combined
- Each item: source favicon, headline, time ago, sentiment badge (bullish/bearish/neutral)
- **Market link chip**: if headline keyword matches any active market title, show a chip
  linking to that market card
- Click headline opens original article in new tab

### 6.5 Narrative Summary Panel
- Collapsible panel above market grid
- Auto-generated text block:
  `"As of [time], prediction markets signal: [AI statement].
   In crypto, [statement]. Hyperliquid markets show [statement].
   Notable divergence: [market with big move, no news]."`
- Refreshes every 60s with market data

### 6.6 Divergence Alert Strip
- Thin banner between header and content
- Shows any market where:
  - 24h odds change > 8%
  - AND no matching recent news found in feed
- Format: `⚡ [Market Question] moved +9.1% — no news found`
- Color: amber/yellow

---

## 7. Narrative Synthesis Logic (`narrative.js`)

No LLM API needed. Pure rule-based string construction.

```js
function buildNarrative(market) {
  const pct = Math.round(market.probability * 100);
  const q = market.question;
  const trend = market.change24h > 0 ? "rising to" : "falling to";
  return `Markets give ${pct}% odds: "${q}" — probability ${trend} ${pct}% in the last 24h.`;
}

function buildCategoryPulse(category, markets) {
  const avgProb = average(markets.map(m => m.probability));
  const topMarket = markets.sort((a,b) => b.volume - a.volume);
  const momentum = markets.filter(m => m.change24h > 0).length > markets.length / 2
    ? "bullish lean" : "bearish lean";
  return `${category}: ${markets.length} active markets, ${momentum},
          top signal: "${topMarket.question}" at ${Math.round(topMarket.probability*100)}%`;
}
```

---

## 8. Caching Strategy

All fetched data cached in `localStorage` with TTL:

| Data | Cache key | TTL |
|---|---|---|
| Tag ID map | `pm_tags` | 24 hours |
| Markets by category | `pm_markets_{tag}` | 60 seconds |
| Trending markets | `pm_trending` | 60 seconds |
| News feed | `pm_news` | 120 seconds |
| Price history (24h) | `pm_history_{id}` | 300 seconds |

On load: show cached data immediately (instant), then refresh in background.
Show stale indicator if cache > 2× TTL.

---

## 9. Auto-Refresh Logic (`app.js`)

```js
const REFRESH_INTERVAL = 60000; // 60 seconds

async function refreshAll() {
  showRefreshSpinner(true);
  await Promise.allSettled([
    fetchMarkets(),
    fetchNews(),
  ]);
  renderAll();
  updateTimestamp();
  showRefreshSpinner(false);
}

// On load
refreshAll();
setInterval(refreshAll, REFRESH_INTERVAL);
```

Use `Promise.allSettled` so a single failed API call doesn't break the whole refresh.

---

## 10. CORS Handling

Polymarket APIs and rss2json support CORS natively.
CryptoPanic API also supports CORS from browser.
PolymarketScan Supabase endpoint supports CORS.

**No proxy needed.** All fetch calls run directly from browser.

---

## 11. Error Handling

- Each fetcher wrapped in try/catch
- On error: show last cached data + `⚠ Using cached data (API error)` badge
- Network offline: show full cached state silently
- If tag ID not found: fall back to keyword search in market question text

---

## 12. Performance Budget

- First meaningful paint: < 300ms (from cache)
- Full live data render: < 2s (all APIs parallel)
- No external JS frameworks (no React, no Vue)
- No images except favicons (loaded lazily)
- Total page weight target: < 150KB

---

## 13. Planned Future Enhancements

### Phase 2
- [ ] PWA manifest + service worker for offline support
- [ ] Web Push notifications for divergence alerts (>10% move)
- [ ] Shareable market snapshot URL (encode state in URL hash)

### Phase 3
- [ ] WebSocket connection to `wss://ws-subscriptions-clob.polymarket.com/ws/`
       for real-time odds streaming (replaces 60s polling)
- [ ] Local LLM narrative via Ollama API (if user runs local server)
- [ ] Keyword → market auto-linker using TF-IDF on market questions vs news headlines
- [ ] Timeline view: plot odds history chart (Chart.js) per market on click

### Phase 4
- [ ] Telegram bot integration (send digest on divergence events)
- [ ] Export to JSON/CSV for personal research archive
- [ ] Multi-venue: add Kalshi markets for same categories (via PolymarketScan Agent API)

---

## 14. Deployment

1. Create GitHub repo: `polymarket-pulse`
2. Push all files to `main` branch
3. Settings → Pages → Source: `main` branch, `/ (root)`
4. App live at: `https://ravellerh.github.io/polymarket-pulse`
5. No build step, no CI needed

---

## 15. CryptoPanic Key Setup

The only optional key needed:

1. Go to https://cryptopanic.com/developers/api/
2. Register free account
3. Copy auth token
4. Paste into `js/config.js` under `CRYPTOPANIC_KEY`
5. If left empty, news falls back to RSS-only mode (still functional)

---

*Generated for Claude Code. All APIs free. No backend. No wallet. No trading.*
