// Polymarket Pulse — Gamma / CLOB API access and normalization

const Polymarket = {
  _tagMap: null,

  async fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
  },

  // Gamma's legacy /markets and /events list endpoints were sunset
  // 2026-05-01 in favor of cursor-based /markets/keyset and /events/keyset.
  // We only ever fetch the first page, so the cursor itself is unused here —
  // but the response is now `{ data: [...], next_cursor }` instead of a bare
  // array, and the keyset endpoints don't reliably support `order`/`ascending`,
  // so callers sort client-side instead.
  async fetchKeyset(url) {
    const raw = await this.fetchJSON(url);
    return Array.isArray(raw) ? raw : raw.data ?? [];
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
      description: raw.description ?? null,
      probability,
      change24h: typeof raw.oneDayPriceChange === 'number' ? raw.oneDayPriceChange : 0,
      volume: Number(raw.volume ?? raw.volumeNum ?? 0),
      volume24h: Number(raw.volume24hr ?? 0),
      volume1wk: Number(raw.volume1wk ?? raw.volume1Wk ?? 0),
      volume1mo: Number(raw.volume1mo ?? raw.volume1Mo ?? 0),
      liquidity: Number(raw.liquidity ?? raw.liquidityNum ?? 0),
      endDate: raw.endDate ?? raw.end_date_iso ?? null,
      slug: raw.slug,
      tags: (raw.tags ?? []).map((t) => (typeof t === 'string' ? t : t.label ?? t.slug)),
      url: raw.slug ? `https://polymarket.com/event/${raw.slug}` : 'https://polymarket.com',
      yesTokenId: yesIdx >= 0 ? clobTokenIds[yesIdx] : clobTokenIds[0],
      closed: Boolean(raw.closed),
      // competitive: Gamma's 0-1 "how contested" score — higher means closer to a coinflip.
      competitive: typeof raw.competitive === 'number' ? raw.competitive : null,
      commentCount: Number(raw.commentCount ?? raw.comment_count ?? 0),
      negRisk: Boolean(raw.negRisk),
      groupItemTitle: raw.groupItemTitle ?? null,
    };
  },

  // Wraps a Gamma event into a card-ready item. Single-market events pass
  // through as-is; negRisk multi-outcome events (e.g. "Who will win X") are
  // collapsed into one item carrying all outcomes, ranked by probability,
  // so the UI can render a leaderboard instead of N near-duplicate cards.
  buildItem(rawEvent) {
    const subMarkets = Array.isArray(rawEvent.markets) ? rawEvent.markets : [rawEvent];
    if (subMarkets.length <= 1) {
      return { ...this.normalizeMarket(subMarkets[0] ?? rawEvent), isGroup: false, outcomes: [] };
    }

    const outcomes = subMarkets.map((m) => this.normalizeMarket(m)).sort((a, b) => b.probability - a.probability);
    const lead = outcomes[0];
    const totalVolume = outcomes.reduce((sum, m) => sum + m.volume, 0);
    const totalLiquidity = outcomes.reduce((sum, m) => sum + m.liquidity, 0);

    return {
      ...lead,
      id: rawEvent.id ?? lead.id,
      question: rawEvent.title ?? rawEvent.question ?? lead.question,
      volume: totalVolume,
      liquidity: totalLiquidity,
      slug: rawEvent.slug ?? lead.slug,
      url: rawEvent.slug ? `https://polymarket.com/event/${rawEvent.slug}` : lead.url,
      eventDescription: rawEvent.description ?? null,
      isGroup: true,
      negRisk: true,
      outcomes,
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
      let items = [];
      try {
        const tagIds = await this.getTagIdsForSlugs(category.slugs);
        for (const tagId of tagIds) {
          const events = await this.fetchKeyset(
            `${CONFIG.ENDPOINTS.GAMMA}/events/keyset?tag_id=${tagId}&active=true&closed=false&limit=20`
          );
          items.push(...events.map((e) => this.buildItem(e)));
        }
      } catch {
        items = [];
      }

      // Fall back to keyword search over question text when no tag match exists.
      if (items.length === 0) {
        try {
          const all = await this.fetchKeyset(
            `${CONFIG.ENDPOINTS.GAMMA}/markets/keyset?active=true&closed=false&limit=100`
          );
          all.sort((a, b) => Number(b.volume ?? b.volumeNum ?? 0) - Number(a.volume ?? a.volumeNum ?? 0));
          const keywords = category.slugs.map((s) => s.replace(/-/g, ' '));
          const filtered = all.filter((m) =>
            keywords.some((kw) => (m.question ?? '').toLowerCase().includes(kw))
          );
          items = filtered.map((m) => this.buildItem(m));
        } catch {
          items = [];
        }
      }

      const deduped = Array.from(new Map(items.map((m) => [m.id, m])).values());
      return deduped
        .sort((a, b) => b.volume - a.volume)
        .slice(0, CONFIG.MARKETS_PER_CATEGORY);
    });
  },

  async fetchTrending() {
    return Cache.getOrFetch('pm_trending', CONFIG.CACHE_TTL.trending, async () => {
      const all = await this.fetchKeyset(
        `${CONFIG.ENDPOINTS.GAMMA}/markets/keyset?active=true&closed=false&limit=100`
      );
      all.sort((a, b) => Number(b.volume ?? b.volumeNum ?? 0) - Number(a.volume ?? a.volumeNum ?? 0));
      return all.slice(0, CONFIG.MARKETS_PER_CATEGORY).map((m) => this.buildItem(m));
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
          const events = await this.fetchKeyset(
            `${CONFIG.ENDPOINTS.GAMMA}/events/keyset?tag_id=${tagId}&closed=true&limit=20`
          );
          markets.push(...events.flatMap((e) => e.markets ?? []));
        }
      } catch {
        markets = [];
      }

      if (markets.length === 0) {
        try {
          const all = await this.fetchKeyset(
            `${CONFIG.ENDPOINTS.GAMMA}/markets/keyset?closed=true&limit=100`
          );
          const keywords = category.slugs.map((s) => s.replace(/-/g, ' '));
          markets = all.filter((m) =>
            keywords.some((kw) => (m.question ?? '').toLowerCase().includes(kw))
          );
        } catch {
          markets = [];
        }
      }

      markets.sort((a, b) => new Date(b.endDate ?? b.end_date_iso ?? 0) - new Date(a.endDate ?? a.end_date_iso ?? 0));
      const normalized = markets.map((m) => this.normalizeMarket(m));
      const deduped = Array.from(new Map(normalized.map((m) => [m.id, m])).values());
      return deduped.slice(0, CONFIG.CALIBRATION_LOOKBACK);
    });
  },

  async fetchResolvedTrending() {
    return Cache.getOrFetch('pm_resolved_trending', CONFIG.CACHE_TTL.resolved, async () => {
      const all = await this.fetchKeyset(
        `${CONFIG.ENDPOINTS.GAMMA}/markets/keyset?closed=true&limit=100`
      );
      all.sort((a, b) => Number(b.volume ?? b.volumeNum ?? 0) - Number(a.volume ?? a.volumeNum ?? 0));
      return all.slice(0, CONFIG.CALIBRATION_LOOKBACK).map((m) => this.normalizeMarket(m));
    });
  },
};
