// Polymarket Pulse — configuration: endpoints, categories, cache TTLs

const CONFIG = {
  REFRESH_INTERVAL_MS: 60_000,

  ENDPOINTS: {
    GAMMA: 'https://gamma-api.polymarket.com',
    CLOB: 'https://clob.polymarket.com',
    POLYMARKETSCAN: 'https://gzydspfquuaudqeztorw.supabase.co/functions/v1/public-api',
    CRYPTOPANIC: 'https://cryptopanic.com/api/v1/posts/',
    RSS2JSON: 'https://api.rss2json.com/v1/api.json',
  },

  // Optional — leave empty to fall back to RSS-only news mode.
  CRYPTOPANIC_KEY: '',

  RSS_FEEDS: [
    { name: 'Decrypt', url: 'https://decrypt.co/feed' },
    { name: 'The Block', url: 'https://www.theblock.co/rss/all' },
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  ],

  INTEREST_TAGS: {
    primary: [
      { key: 'ai', label: 'AI & Tech', slugs: ['ai', 'technology', 'artificial-intelligence'] },
      { key: 'crypto', label: 'Crypto', slugs: ['crypto', 'cryptocurrency', 'bitcoin', 'ethereum', 'defi'] },
      { key: 'hyperliquid', label: 'Hyperliquid', slugs: ['hyperliquid', 'hype', 'perp-dex'] },
      { key: 'finance', label: 'Finance', slugs: ['finance', 'economy', 'fed', 'macro', 'markets'] },
      { key: 'politics', label: 'Politics', slugs: ['politics', 'elections', 'us-politics', 'world-politics'] },
      { key: 'sports', label: 'Sports', slugs: ['sports', 'nba', 'nfl', 'soccer', 'football'] },
      { key: 'culture', label: 'Pop Culture', slugs: ['pop-culture', 'entertainment', 'movies', 'music'] },
      { key: 'science', label: 'Science', slugs: ['science', 'space', 'climate'] },
    ],
    trendingKey: 'trending',
    trendingLabel: 'Trending',
  },

  CACHE_TTL: {
    tags: 24 * 60 * 60 * 1000,
    markets: 60 * 1000,
    trending: 60 * 1000,
    news: 120 * 1000,
    history: 300 * 1000,
    book: 45 * 1000,
    resolved: 10 * 60 * 1000,
  },

  DIVERGENCE_THRESHOLD_PCT: 8,
  MARKETS_PER_CATEGORY: 12,
  SPREAD_LOOKUP_LIMIT: 6, // top-N cards per category get a live bid/ask spread badge
  CALIBRATION_LOOKBACK: 8, // resolved markets sampled per category for the track-record score
};
