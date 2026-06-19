// Polymarket Pulse — bootstrap, scheduler, orchestration

const App = {
  state: {
    activeCategory: 'trending',
    categoryData: [], // [{ key, label, markets }]
    trendingMarkets: [],
    news: [],
    whaleTrades: [],
    stale: false,
  },

  els: {},
  _calibrationToken: 0, // guards against a stale async calibration result landing after a tab switch

  init() {
    this.els = {
      ticker: document.getElementById('ticker-track'),
      timestamp: document.getElementById('last-updated'),
      pulseBar: document.getElementById('pulse-bar'),
      marketGrid: document.getElementById('market-grid'),
      newsFeed: document.getElementById('news-feed'),
      whaleFeed: document.getElementById('whale-feed'),
      narrativeSummary: document.getElementById('narrative-summary'),
      calibrationPanel: document.getElementById('calibration-panel'),
      divergenceStrip: document.getElementById('divergence-strip'),
      staleBadge: document.getElementById('stale-badge'),
      refreshSpinner: document.getElementById('refresh-spinner'),
      tabs: document.querySelectorAll('[data-category-tab]'),
    };

    this.els.tabs.forEach((tab) => {
      tab.addEventListener('click', () => this.setActiveCategory(tab.dataset.categoryTab));
    });

    this.refreshAll();
    setInterval(() => this.refreshAll(), CONFIG.REFRESH_INTERVAL_MS);
  },

  setActiveCategory(key) {
    this.state.activeCategory = key;
    this.els.tabs.forEach((tab) => {
      const active = tab.dataset.categoryTab === key;
      tab.classList.toggle('bg-emerald-600', active);
      tab.classList.toggle('text-black', active);
      tab.classList.toggle('text-slate-400', !active);
    });
    this.renderActiveGrid();
    this.loadCalibrationForActiveCategory();
  },

  getActiveCategoryConfig() {
    return CONFIG.INTEREST_TAGS.primary.find((c) => c.key === this.state.activeCategory) ?? null;
  },

  getActiveMarkets() {
    if (this.state.activeCategory === CONFIG.INTEREST_TAGS.trendingKey) {
      return this.state.trendingMarkets;
    }
    const cat = this.state.categoryData.find((c) => c.key === this.state.activeCategory);
    return cat ? cat.markets : [];
  },

  renderActiveGrid() {
    const markets = this.getActiveMarkets();
    Renderer.renderMarketGrid(this.els.marketGrid, markets, this.allKnownMarkets());
    this.loadCardEnrichment(markets);
  },

  // Sparklines + spread badges are fetched lazily per visible card so a slow
  // history/order-book call never blocks the initial grid paint.
  async loadCardEnrichment(markets) {
    const targets = markets.slice(0, CONFIG.SPREAD_LOOKUP_LIMIT);
    await Promise.allSettled(
      targets.map(async (m) => {
        const [historyResult, spreadResult] = await Promise.allSettled([
          Polymarket.fetchPriceHistory(m.conditionId, '1d'),
          Polymarket.fetchSpread(m.yesTokenId),
        ]);
        if (historyResult.status === 'fulfilled') {
          Renderer.renderSparkline(m.id, historyResult.value.value);
        }
        if (spreadResult.status === 'fulfilled') {
          Renderer.renderSpread(m.id, spreadResult.value);
        }
      })
    );
  },

  async loadCalibrationForActiveCategory() {
    const token = ++this._calibrationToken;
    this.els.calibrationPanel.textContent = 'Checking recently resolved markets...';

    try {
      const catConfig = this.getActiveCategoryConfig();
      const resolved = catConfig
        ? (await Polymarket.fetchResolvedForCategory(catConfig)).value
        : (await Polymarket.fetchResolvedTrending()).value;

      const calibration = await Narrative.computeCalibration(resolved);
      if (token !== this._calibrationToken) return; // user switched tabs while this was in flight
      Renderer.renderCalibrationPanel(this.els.calibrationPanel, calibration);
    } catch {
      if (token !== this._calibrationToken) return;
      Renderer.renderCalibrationPanel(this.els.calibrationPanel, { sampleSize: 0, score: null, items: [] });
    }
  },

  // Top-holder lookups are lazy and per-divergence-alert, same pattern as
  // loadCardEnrichment — never blocks the initial divergence strip render.
  async loadDivergenceEnrichment(divergences) {
    const targets = divergences.slice(0, CONFIG.DIVERGENCE_HOLDER_LOOKUP_LIMIT);
    await Promise.allSettled(
      targets.map(async ({ market }) => {
        const result = await Promise.allSettled([DataAPI.fetchHolders(market.yesTokenId, 3)]);
        if (result[0].status === 'fulfilled') {
          Renderer.renderDivergenceHolderNote(market.id, result[0].value);
        }
      })
    );
  },

  allKnownMarkets() {
    const fromCategories = this.state.categoryData.flatMap((c) => c.markets);
    return [...fromCategories, ...this.state.trendingMarkets];
  },

  async refreshAll() {
    this.els.refreshSpinner?.classList.remove('hidden');
    let stale = false;

    const [categoryResults, trendingResult, newsResult, whaleResult] = await Promise.allSettled([
      Promise.allSettled(
        CONFIG.INTEREST_TAGS.primary.map(async (cat) => {
          const result = await Polymarket.fetchMarketsForCategory(cat);
          if (result.stale) stale = true;
          return { key: cat.key, label: cat.label, markets: result.value };
        })
      ),
      Polymarket.fetchTrending(),
      News.fetchAll(),
      DataAPI.fetchWhaleTrades(),
    ]);

    if (categoryResults.status === 'fulfilled') {
      this.state.categoryData = categoryResults.value.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { key: CONFIG.INTEREST_TAGS.primary[i].key, label: CONFIG.INTEREST_TAGS.primary[i].label, markets: [] }
      );
    }
    if (trendingResult.status === 'fulfilled') {
      this.state.trendingMarkets = trendingResult.value.value;
      if (trendingResult.value.stale) stale = true;
    }
    if (newsResult.status === 'fulfilled') {
      this.state.news = newsResult.value.value;
      if (newsResult.value.stale) stale = true;
    }
    if (whaleResult.status === 'fulfilled') {
      this.state.whaleTrades = whaleResult.value.value;
      if (whaleResult.value.stale) stale = true;
    } else {
      this.state.whaleTrades = [];
    }
    this.state.stale = stale;

    this.renderAll();
    this.els.refreshSpinner?.classList.add('hidden');
  },

  renderAll() {
    Renderer.renderTimestamp(this.els.timestamp);
    Renderer.renderTicker(this.els.ticker, this.state.trendingMarkets);
    Renderer.renderPulseBar(this.els.pulseBar, this.state.categoryData);
    this.renderActiveGrid();

    const allMarkets = this.allKnownMarkets();
    Renderer.renderNewsFeed(this.els.newsFeed, this.state.news, allMarkets);
    Renderer.renderWhaleFeed(this.els.whaleFeed, this.state.whaleTrades);
    Renderer.renderNarrativeSummary(this.els.narrativeSummary, this.state.categoryData);

    const divergences = Narrative.findDivergences(allMarkets, this.state.news);
    Renderer.renderDivergenceStrip(this.els.divergenceStrip, divergences);
    this.loadDivergenceEnrichment(divergences);

    Renderer.renderStaleBadge(this.els.staleBadge, this.state.stale);

    this.loadCalibrationForActiveCategory();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
