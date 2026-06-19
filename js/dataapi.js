// Polymarket Pulse — Data API access (live trades, top holders)
//
// data-api.polymarket.com has no published schema, so normalizers here
// defensively check several plausible key names per field and fail closed
// to empty results rather than throwing on an unexpected shape.

const DataAPI = {
  async fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
  },

  normalizeTrade(raw) {
    const price = Number(raw.price ?? raw.p ?? 0);
    const size = Number(raw.size ?? raw.amount ?? raw.s ?? 0);
    const tsRaw = Number(raw.timestamp ?? raw.t ?? 0);
    return {
      id: raw.transactionHash ?? raw.id ?? `${tsRaw}-${price}-${size}`,
      market: raw.title ?? raw.question ?? raw.market ?? 'Unknown market',
      slug: raw.slug ?? raw.eventSlug ?? null,
      outcome: raw.outcomeName ?? raw.outcome ?? raw.side ?? '',
      price,
      size,
      usdValue: Number(raw.usdcSize ?? raw.value ?? (price * size)),
      wallet: raw.proxyWallet ?? raw.wallet ?? raw.maker ?? null,
      pseudonym: raw.pseudonym ?? raw.name ?? null,
      timestamp: tsRaw > 0 ? (tsRaw < 1e12 ? tsRaw * 1000 : tsRaw) : Date.now(),
    };
  },

  async fetchRecentTrades(limit = 100) {
    return Cache.getOrFetch('pm_trades_recent', CONFIG.CACHE_TTL.trades, async () => {
      const raw = await this.fetchJSON(`${CONFIG.ENDPOINTS.DATA_API}/trades?limit=${limit}`);
      const list = Array.isArray(raw) ? raw : raw.data ?? [];
      return list.map((t) => this.normalizeTrade(t));
    });
  },

  // Largest recent fills by estimated USD value — a proxy "smart/whale money" feed.
  async fetchWhaleTrades() {
    const { value: trades, stale } = await this.fetchRecentTrades(100);
    const whales = trades
      .filter((t) => t.usdValue >= CONFIG.WHALE_THRESHOLD_USD)
      .sort((a, b) => b.usdValue - a.usdValue)
      .slice(0, CONFIG.WHALE_FEED_LIMIT);
    return { value: whales, stale };
  },

  normalizeHolder(raw) {
    return {
      wallet: raw.proxyWallet ?? raw.wallet ?? raw.address ?? null,
      pseudonym: raw.pseudonym ?? raw.name ?? null,
      amount: Number(raw.amount ?? raw.shares ?? raw.balance ?? 0),
      outcome: raw.outcomeName ?? raw.outcome ?? null,
    };
  },

  // Top holders for a market's token, used to add concentration context to
  // divergence alerts. Lazily called per-card, never blocks initial render.
  async fetchHolders(tokenId, limit = 5) {
    if (!tokenId) return [];
    const cacheKey = `pm_holders_${tokenId}`;
    const { value } = await Cache.getOrFetch(cacheKey, CONFIG.CACHE_TTL.holders, async () => {
      const raw = await this.fetchJSON(`${CONFIG.ENDPOINTS.DATA_API}/holders?market=${tokenId}&limit=${limit}`);
      const list = Array.isArray(raw) ? raw : raw.data ?? raw.holders ?? [];
      return list.map((h) => this.normalizeHolder(h));
    });
    return value;
  },
};
