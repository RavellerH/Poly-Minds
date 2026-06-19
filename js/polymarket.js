// Polymarket Pulse — Gamma / CLOB API access and normalization

const Polymarket = {
  _tagMap: null,

  async fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
  },

  // Gamma encodes outcomes/outcomePrices/clobTokenIds as JSON strings.
  _parseJSONField(field, fallback) {
    if (Array.isArray(field)) return field;
    if (typeof field !== 'string') return fallback;
    try {
      return JSON.parse(field);
    } catch {
      return fallback;
    }
  },

  normalizeMarket(raw) {
    const outcomes = this._parseJSONField(raw.outcomes, ['Yes', 'No']);
    const prices = this._parseJSONField(raw.outcomePrices, []).map(Number);
    const clobTokenIds = this._parseJSONField(raw.clobTokenIds, []);
    const yesIdx = outcomes.findIndex((o) => /yes/i.test(o));
    const probability = prices.length
      ? (yesIdx >= 0 ? prices[yesIdx] : prices[0])
      : 0.5;

    return {
      id: raw.id ?? raw.conditionId,
      conditionId: raw.conditionId,
      question: raw.question ?? raw.title ?? 'Untitled market',
      probability,
      change24h: typeof raw.oneDayPriceChange === 'number' ? raw.oneDayPriceChange : 0,
      volume: Number(raw.volume ?? raw.volumeNum ?? 0),
      volume24h: Number(raw.volume24hr ?? 0),
      liquidity: Number(raw.liquidity ?? raw.liquidityNum ?? 0),
      endDate: raw.endDate ?? raw.end_date_iso ?? null,
      slug: raw.slug,
      tags: (raw.tags ?? []).map((t) => (typeof t === 'string' ? t : t.label ?? t.slug)),
      url: raw.slug ? `https://polymarket.com/event/${raw.slug}` : 'https://polymarket.com',
      yesTokenId: yesIdx >= 0 ? clobTokenIds[yesIdx] : clobTokenIds[0],
      closed: Boolean(raw.closed),
    };
  },

  async fetchTags() {
    return Cache.getOrFetch('pm_tags', CONFIG.CACHE_TTL.tags, async () => {
      const tags = await this.fetchJSON(`${CONFIG.ENDPOINTS.GAMMA}/tags`);
      return Array.isArray(tags) ? tags : [];
    });
  },

  async getTagIdsForSlugs(slugs) {
    const { value: tags } = await this.fetchTags();
    return tags
      .filter((t) => slugs.includes((t.slug ?? '').toLowerCase()))
      .map((t) => t.id);
  },

  async fetchMarketsForCategory(category) {
    const cacheKey = `pm_markets_${category.key}`;
    return Cache.getOrFetch(cacheKey, CONFIG.CACHE_TTL.markets, async () => {
      let markets = [];
      try {
        const tagIds = await this.getTagIdsForSlugs(category.slugs);
        for (const tagId of tagIds) {
          const events = await this.fetchJSON(
            `${CONFIG.ENDPOINTS.GAMMA}/events?tag_id=${tagId}&active=true&closed=false&limit=20`
          );
          markets.push(...events.flatMap((e) => e.markets ?? []));
        }
      } catch {
        markets = [];
      }

      // Fall back to keyword search over question text when no tag match exists.
      if (markets.length === 0) {
        try {
          const all = await this.fetchJSON(
            `${CONFIG.ENDPOINTS.GAMMA}/markets?active=true&closed=false&order=volume&ascending=false&limit=100`
          );
          const keywords = category.slugs.map((s) => s.replace(/-/g, ' '));
          markets = all.filter((m) =>
            keywords.some((kw) => (m.question ?? '').toLowerCase().includes(kw))
          );
        } catch {
          markets = [];
        }
      }

      const normalized = markets.map((m) => this.normalizeMarket(m));
      const deduped = Array.from(new Map(normalized.map((m) => [m.id, m])).values());
      return deduped
        .sort((a, b) => b.volume - a.volume)
        .slice(0, CONFIG.MARKETS_PER_CATEGORY);
    });
  },

  async fetchTrending() {
    return Cache.getOrFetch('pm_trending', CONFIG.CACHE_TTL.trending, async () => {
      const all = await this.fetchJSON(
        `${CONFIG.ENDPOINTS.GAMMA}/markets?active=true&closed=false&order=volume&ascending=false&limit=${CONFIG.MARKETS_PER_CATEGORY}`
      );
      return all.map((m) => this.normalizeMarket(m));
    });
  },

  async fetchPriceHistory(conditionId, interval = '1d') {
    const cacheKey = `pm_history_${conditionId}_${interval}`;
    return Cache.getOrFetch(cacheKey, CONFIG.CACHE_TTL.history, async () => {
      const data = await this.fetchJSON(
        `${CONFIG.ENDPOINTS.CLOB}/prices-history?market=${conditionId}&interval=${interval}`
      );
      return data.history ?? [];
    });
  },

  // Best bid/ask off the live order book — used for the spread badge on cards.
  async fetchSpread(tokenId) {
    if (!tokenId) return null;
    const cacheKey = `pm_book_${tokenId}`;
    const { value } = await Cache.getOrFetch(cacheKey, CONFIG.CACHE_TTL.book, async () => {
      const book = await this.fetchJSON(`${CONFIG.ENDPOINTS.CLOB}/book?token_id=${tokenId}`);
      const bestBid = book.bids?.[0]?.price ? Number(book.bids[0].price) : null;
      const bestAsk = book.asks?.[0]?.price ? Number(book.asks[0].price) : null;
      return bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
    });
    return value;
  },

  // Recently closed markets for a category, used to score the market's own
  // track record: did the last live price before close call the outcome right?
  async fetchResolvedForCategory(category) {
    const cacheKey = `pm_resolved_${category.key}`;
    return Cache.getOrFetch(cacheKey, CONFIG.CACHE_TTL.resolved, async () => {
      let markets = [];
      try {
        const tagIds = await this.getTagIdsForSlugs(category.slugs);
        for (const tagId of tagIds) {
          const events = await this.fetchJSON(
            `${CONFIG.ENDPOINTS.GAMMA}/events?tag_id=${tagId}&closed=true&order=endDate&ascending=false&limit=10`
          );
          markets.push(...events.flatMap((e) => e.markets ?? []));
        }
      } catch {
        markets = [];
      }

      if (markets.length === 0) {
        try {
          const all = await this.fetchJSON(
            `${CONFIG.ENDPOINTS.GAMMA}/markets?closed=true&order=endDate&ascending=false&limit=100`
          );
          const keywords = category.slugs.map((s) => s.replace(/-/g, ' '));
          markets = all.filter((m) =>
            keywords.some((kw) => (m.question ?? '').toLowerCase().includes(kw))
          );
        } catch {
          markets = [];
        }
      }

      const normalized = markets.map((m) => this.normalizeMarket(m));
      const deduped = Array.from(new Map(normalized.map((m) => [m.id, m])).values());
      return deduped.slice(0, CONFIG.CALIBRATION_LOOKBACK);
    });
  },

  async fetchResolvedTrending() {
    return Cache.getOrFetch('pm_resolved_trending', CONFIG.CACHE_TTL.resolved, async () => {
      const all = await this.fetchJSON(
        `${CONFIG.ENDPOINTS.GAMMA}/markets?closed=true&order=volume&ascending=false&limit=${CONFIG.CALIBRATION_LOOKBACK}`
      );
      return all.map((m) => this.normalizeMarket(m));
    });
  },
};
