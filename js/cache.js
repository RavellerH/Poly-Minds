// Polymarket Pulse — localStorage cache with TTL

const Cache = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { value, savedAt, ttl } = JSON.parse(raw);
      return { value, savedAt, ttl, age: Date.now() - savedAt, isStale: Date.now() - savedAt > ttl };
    } catch {
      return null;
    }
  },

  set(key, value, ttl) {
    try {
      localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now(), ttl }));
    } catch {
      // localStorage full or unavailable — fail silently, cache is best-effort
    }
  },

  // Returns cached value immediately (even if stale) and refreshes in the
  // background via fetcher(), calling onFresh(value) once new data arrives.
  async getOrFetch(key, ttl, fetcher, onFresh) {
    const cached = this.get(key);
    if (cached && !cached.isStale) {
      return { value: cached.value, fromCache: true, stale: false };
    }
    try {
      const fresh = await fetcher();
      this.set(key, fresh, ttl);
      if (onFresh) onFresh(fresh);
      return { value: fresh, fromCache: false, stale: false };
    } catch (err) {
      if (cached) {
        return { value: cached.value, fromCache: true, stale: true, error: err };
      }
      throw err;
    }
  },
};
