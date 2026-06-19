// Polymarket Pulse — rule-based narrative synthesis (no LLM required)

const Narrative = {
  buildMarketSentence(market) {
    const pct = Math.round(market.probability * 100);
    const moveDesc = market.change24h > 0 ? 'up' : market.change24h < 0 ? 'down' : 'unchanged';
    const movePct = Math.abs(Math.round(market.change24h * 1000) / 10);
    const moveNote = moveDesc === 'unchanged' ? '' : ` That's ${moveDesc} ${movePct} points over the last day.`;
    const liquidityNote = market.liquidity > 0
      ? ` There's $${Renderer.formatNumber(market.liquidity)} ready to trade on this market, so it's easy to get in or out.`
      : '';
    const momentumNote = market.volume1wk > 0 && market.volume1wk > market.volume24h * 3
      ? ` More people have been trading this lately — interest is building.`
      : '';
    const contestedNote = market.competitive != null && market.competitive >= 0.7
      ? ' Traders are about evenly split here — it could go either way.'
      : '';
    return `Traders think there's about a ${pct}% chance: "${market.question}".${moveNote}${liquidityNote}${momentumNote}${contestedNote}`;
  },

  // Related markets: same category, excluding the one being shown.
  findRelated(market, allMarkets, limit = 3) {
    return allMarkets
      .filter((m) => m.id !== market.id && m.tags.some((t) => market.tags.includes(t)))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);
  },

  // Did the market's own last live price (just before close) call the
  // eventual outcome correctly? No backend, no stored history — this is
  // computed fresh each load from CLOB's price-history endpoint.
  async computeCalibration(resolvedMarkets) {
    if (!resolvedMarkets.length) return { score: null, sampleSize: 0, items: [] };

    const items = await Promise.all(
      resolvedMarkets.map(async (m) => {
        try {
          const { value: history } = await Polymarket.fetchPriceHistory(m.conditionId, 'max');
          if (!history.length) return null;
          const lastCallIdx = Math.max(0, history.length - 2);
          const point = history[lastCallIdx];
          const lastCallPrice = Number(point.p ?? point.price ?? m.probability);
          const outcomeYes = m.probability >= 0.5;
          const calledYes = lastCallPrice >= 0.5;
          return { market: m, lastCallPrice, correct: calledYes === outcomeYes };
        } catch {
          return null;
        }
      })
    );

    const valid = items.filter(Boolean);
    const correctCount = valid.filter((i) => i.correct).length;
    return {
      score: valid.length ? Math.round((correctCount / valid.length) * 100) : null,
      sampleSize: valid.length,
      items: valid,
    };
  },

  buildCategoryPulse(label, markets) {
    if (!markets.length) return `${label}: no active markets found.`;
    const avgProb = markets.reduce((sum, m) => sum + m.probability, 0) / markets.length;
    const top = [...markets].sort((a, b) => b.volume - a.volume)[0];
    const upCount = markets.filter((m) => m.change24h > 0).length;
    const momentum = upCount > markets.length / 2 ? 'leaning more "yes" than usual' : 'leaning more "no" than usual';
    return `${label}: ${markets.length} active markets, ${momentum} ` +
      `(averaging ${Math.round(avgProb * 100)}% chance of "yes"), the most-traded one is: ` +
      `"${top.question}" at ${Math.round(top.probability * 100)}% chance.`;
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
