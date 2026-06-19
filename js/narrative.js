// Polymarket Pulse — rule-based narrative synthesis (no LLM required)

const Narrative = {
  buildMarketSentence(market) {
    const pct = Math.round(market.probability * 100);
    const trend = market.change24h > 0 ? 'rising to' : market.change24h < 0 ? 'falling to' : 'holding at';
    return `Markets give ${pct}% odds: "${market.question}" — probability ${trend} ${pct}% in the last 24h.`;
  },

  buildCategoryPulse(label, markets) {
    if (!markets.length) return `${label}: no active markets found.`;
    const avgProb = markets.reduce((sum, m) => sum + m.probability, 0) / markets.length;
    const top = [...markets].sort((a, b) => b.volume - a.volume)[0];
    const upCount = markets.filter((m) => m.change24h > 0).length;
    const momentum = upCount > markets.length / 2 ? 'bullish lean' : 'bearish lean';
    return `${label}: ${markets.length} active markets, ${momentum} ` +
      `(avg ${Math.round(avgProb * 100)}% yes), top signal: ` +
      `"${top.question}" at ${Math.round(top.probability * 100)}%.`;
  },

  buildSummary(categoryData) {
    const sentences = categoryData
      .filter((c) => c.markets.length)
      .map((c) => this.buildCategoryPulse(c.label, c.markets));
    return sentences.join(' ');
  },

  // Markets whose 24h move exceeds the threshold with no matching recent
  // news item — a candidate "the market knows something" signal.
  findDivergences(markets, news) {
    return markets
      .filter((m) => Math.abs(m.change24h * 100) > CONFIG.DIVERGENCE_THRESHOLD_PCT)
      .filter((m) => !news.some((n) => News.matchesMarket(n, m)))
      .map((m) => ({
        market: m,
        changePct: Math.round(m.change24h * 1000) / 10,
      }));
  },
};
