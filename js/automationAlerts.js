// Polymarket Pulse — reads the hourly GitHub Actions alert log (data/alerts.json)
// so the same moves sent to Telegram are also visible on the page. This is a
// historical record updated once an hour, not a live feed — the page's
// genuinely realtime alerting is the 60s client-side divergence strip.

const AutomationAlerts = {
  async fetchLog() {
    try {
      const res = await fetch(`data/alerts.json?t=${Date.now()}`);
      if (!res.ok) return [];
      const log = await res.json();
      return Array.isArray(log) ? log : [];
    } catch {
      return [];
    }
  },
};
