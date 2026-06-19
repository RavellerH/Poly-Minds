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
    const price = Number(raw.price ?? 0);
    const size = Number(raw.size ?? 0);
    const tsRaw = Number(raw.timestamp ?? 0);
    return {
      id: raw.transactionHash ?? `${tsRaw}-${price}-${size}`,
      market: raw.title ?? raw.slug ?? 'Unknown market',
      slug: raw.slug ?? raw.eventSlug ?? null,
      outcome: raw.outcome ?? '',
      side: raw.side ?? '',
      price,
      size,
      // /trades has no usdValue field — estimate USD size as price * size (shares).
      usdValue: price * size,
      wallet: raw.proxyWallet ?? null,
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
      wallet: raw.proxyWallet ?? null,
      pseudonym: raw.pseudonym ?? raw.name ?? raw.displayUsernamePublic ?? null,
      amount: Number(raw.amount ?? 0),
      outcomeIndex: raw.outcomeIndex ?? null,
    };
  },

  // Top holders for a market, used to add concentration context to
  // divergence alerts. Lazily called per-card, never blocks initial render.
  // /holders takes the market's conditionId (not a CLOB token id) and
  // returns one holder group per outcome token: [{ token, holders: [...] }].
  async fetchHolders(conditionId, limit = 5) {
    if (!conditionId) return [];
    const cacheKey = `pm_holders_${conditionId}`;
    const { value } = await Cache.getOrFetch(cacheKey, CONFIG.CACHE_TTL.holders, async () => {
      const raw = await this.fetchJSON(`${CONFIG.ENDPOINTS.DATA_API}/holders?market=${conditionId}&limit=${limit}`);
      const groups = Array.isArray(raw) ? raw : raw.data ?? [];
      const holders = groups.flatMap((g) => g.holders ?? []).map((h) => this.normalizeHolder(h));
      return holders.sort((a, b) => b.amount - a.amount).slice(0, limit);
    });
    return value;
  },
};
