// Polymarket Pulse — RSS + CryptoPanic news aggregation

const News = {
  async fetchRSSFeed(feed) {
    try {
      const url = `${CONFIG.ENDPOINTS.RSS2JSON}?rss_url=${encodeURIComponent(feed.url)}&count=10`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items ?? []).map((item) => ({
        title: item.title,
        url: item.link,
        source: feed.name,
        publishedAt: item.pubDate,
        sentiment: 'neutral',
      }));
    } catch {
      return [];
    }
  },

  async fetchCryptoPanic() {
    if (!CONFIG.CRYPTOPANIC_KEY) return [];
    try {
      const url = `${CONFIG.ENDPOINTS.CRYPTOPANIC}?auth_token=${CONFIG.CRYPTOPANIC_KEY}&filter=important&currencies=BTC,ETH,HYPE`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results ?? []).map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source?.title ?? 'CryptoPanic',
        publishedAt: item.published_at,
        sentiment: this._sentimentFromVotes(item.votes),
      }));
    } catch {
      return [];
    }
  },

  _sentimentFromVotes(votes) {
    if (!votes) return 'neutral';
    if (votes.positive > votes.negative) return 'bullish';
    if (votes.negative > votes.positive) return 'bearish';
    return 'neutral';
  },

  async fetchAll() {
    return Cache.getOrFetch('pm_news', CONFIG.CACHE_TTL.news, async () => {
      const results = await Promise.allSettled([
        ...CONFIG.RSS_FEEDS.map((f) => this.fetchRSSFeed(f)),
        this.fetchCryptoPanic(),
      ]);
      const items = results
        .filter((r) => r.status === 'fulfilled')
        .flatMap((r) => r.value);
      return items
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, 15);
    });
  },

  // Naive keyword overlap between a headline and a market question — used
  // both for the "linked market" chip on news items and divergence alerts.
  matchesMarket(newsItem, market) {
    const stopwords = new Set(['the', 'a', 'an', 'will', 'to', 'of', 'in', 'on', 'for', 'by', 'and', 'is', 'be']);
    const words = (str) =>
      str
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopwords.has(w));

    const newsWords = new Set(words(newsItem.title));
    const marketWords = words(market.question);
    const overlap = marketWords.filter((w) => newsWords.has(w));
    return overlap.length >= 2;
  },

  findLinkedMarket(newsItem, markets) {
    return markets.find((m) => this.matchesMarket(newsItem, m)) ?? null;
  },
};
