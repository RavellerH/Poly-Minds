// Polymarket Pulse — bootstrap, scheduler, orchestration

const App = {
  state: {
    activeCategory: 'trending',
    categoryData: [], // [{ key, label, markets }]
    trendingMarkets: [],
    news: [],
    stale: false,
  },

  els: {},

  init() {
    this.els = {
      timestamp: document.getElementById('last-updated'),
      pulseBar: document.getElementById('pulse-bar'),
      marketGrid: document.getElementById('market-grid'),
      newsFeed: document.getElementById('news-feed'),
      narrativeSummary: document.getElementById('narrative-summary'),
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
      tab.classList.toggle('bg-indigo-600', tab.dataset.categoryTab === key);
      tab.classList.toggle('text-white', tab.dataset.categoryTab === key);
      tab.classList.toggle('text-slate-400', tab.dataset.categoryTab !== key);
    });
    this.renderActiveGrid();
  },

  getActiveMarkets() {
    if (this.state.activeCategory === CONFIG.INTEREST_TAGS.trendingKey) {
      return this.state.trendingMarkets;
    }
    const cat = this.state.categoryData.find((c) => c.key === this.state.activeCategory);
    return cat ? cat.markets : [];
  },

  renderActiveGrid() {
    Renderer.renderMarketGrid(this.els.marketGrid, this.getActiveMarkets());
  },

  allKnownMarkets() {
    const fromCategories = this.state.categoryData.flatMap((c) => c.markets);
    return [...fromCategories, ...this.state.trendingMarkets];
  },

  async refreshAll() {
    this.els.refreshSpinner?.classList.remove('hidden');
    let stale = false;

    const [categoryResults, trendingResult, newsResult] = await Promise.allSettled([
      Promise.allSettled(
        CONFIG.INTEREST_TAGS.primary.map(async (cat) => {
          const result = await Polymarket.fetchMarketsForCategory(cat);
          if (result.stale) stale = true;
          return { key: cat.key, label: cat.label, markets: result.value };
        })
      ),
      Polymarket.fetchTrending(),
      News.fetchAll(),
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
    this.state.stale = stale;

    this.renderAll();
    this.els.refreshSpinner?.classList.add('hidden');
  },

  renderAll() {
    Renderer.renderTimestamp(this.els.timestamp);
    Renderer.renderPulseBar(this.els.pulseBar, this.state.categoryData);
    this.renderActiveGrid();

    const allMarkets = this.allKnownMarkets();
    Renderer.renderNewsFeed(this.els.newsFeed, this.state.news, allMarkets);
    Renderer.renderNarrativeSummary(this.els.narrativeSummary, this.state.categoryData);

    const divergences = Narrative.findDivergences(allMarkets, this.state.news);
    Renderer.renderDivergenceStrip(this.els.divergenceStrip, divergences);

    Renderer.renderStaleBadge(this.els.staleBadge, this.state.stale);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
