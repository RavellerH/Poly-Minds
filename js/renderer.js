// Polymarket Pulse — DOM rendering

const Renderer = {
  timeAgo(dateStr) {
    if (!dateStr) return '';
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  },

  probColorClass(prob) {
    if (prob >= 0.66) return 'text-emerald-400';
    if (prob >= 0.33) return 'text-amber-400';
    return 'text-rose-400';
  },

  changeBadge(change24h) {
    const pct = Math.round(change24h * 1000) / 10;
    if (pct > 0) return `<span class="text-emerald-400">&uarr; +${pct}%</span>`;
    if (pct < 0) return `<span class="text-rose-400">&darr; ${pct}%</span>`;
    return `<span class="text-slate-400">&rarr; 0%</span>`;
  },

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  },

  renderTimestamp(el) {
    el.textContent = `Last updated ${new Date().toLocaleTimeString()}`;
  },

  renderPulseBar(el, categoryData) {
    el.innerHTML = categoryData
      .map(({ label, markets }) => {
        const count = markets.length;
        const top = [...markets].sort((a, b) => b.volume - a.volume)[0];
        const volume = markets.reduce((sum, m) => sum + m.volume, 0);
        const upCount = markets.filter((m) => m.change24h > 0).length;
        const momentum = count === 0 ? 'flat' : upCount > count / 2 ? 'up' : upCount < count / 2 ? 'down' : 'flat';
        const arrow = { up: '&uarr;', down: '&darr;', flat: '&rarr;' }[momentum];
        const colorClass = { up: 'border-emerald-500/40 text-emerald-400', down: 'border-rose-500/40 text-rose-400', flat: 'border-slate-600 text-slate-400' }[momentum];

        return `
          <div class="rounded-lg border ${colorClass} bg-slate-900/60 p-4 flex flex-col gap-1">
            <div class="text-sm text-slate-300 font-medium">${this.escapeHTML(label)}</div>
            <div class="text-2xl font-semibold flex items-center gap-2">
              ${arrow} ${count} <span class="text-xs text-slate-500 font-normal">markets</span>
            </div>
            <div class="text-xs text-slate-500">
              Top: ${top ? `${Math.round(top.probability * 100)}% yes` : 'n/a'}
              &middot; Vol $${this.formatNumber(volume)}
            </div>
          </div>`;
      })
      .join('');
  },

  formatNumber(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return Math.round(n).toString();
  },

  renderMarketCard(market) {
    const pct = Math.round(market.probability * 100);
    const sentence = Narrative.buildMarketSentence(market);
    const tags = market.tags.slice(0, 3)
      .map((t) => `<span class="px-2 py-0.5 rounded-full bg-slate-800 text-xs text-slate-400">${this.escapeHTML(t)}</span>`)
      .join('');

    return `
      <a href="${market.url}" target="_blank" rel="noopener" class="block rounded-lg border border-slate-700 bg-slate-900/60 p-4 hover:border-slate-500 transition-colors">
        <div class="text-sm text-slate-200 font-medium line-clamp-2 mb-2">${this.escapeHTML(market.question)}</div>
        <div class="flex items-baseline gap-2 mb-2">
          <span class="text-3xl font-bold ${this.probColorClass(market.probability)}">${pct}%</span>
          ${this.changeBadge(market.change24h)}
        </div>
        <div class="text-xs text-slate-500 mb-2">
          Vol $${this.formatNumber(market.volume)}
          ${market.endDate ? `&middot; ends ${new Date(market.endDate).toLocaleDateString()}` : ''}
        </div>
        <p class="text-xs text-slate-400 mb-2">${this.escapeHTML(sentence)}</p>
        <div class="flex gap-1 flex-wrap">${tags}</div>
      </a>`;
  },

  renderMarketGrid(el, markets) {
    if (!markets.length) {
      el.innerHTML = `<div class="text-slate-500 text-sm col-span-full">No markets found for this category.</div>`;
      return;
    }
    el.innerHTML = markets.map((m) => this.renderMarketCard(m)).join('');
  },

  renderNewsItem(item, allMarkets) {
    const linked = News.findLinkedMarket(item, allMarkets);
    const sentimentColor = { bullish: 'text-emerald-400', bearish: 'text-rose-400', neutral: 'text-slate-500' }[item.sentiment];

    return `
      <li class="border-b border-slate-800 pb-2 mb-2 last:border-0">
        <a href="${item.url}" target="_blank" rel="noopener" class="text-sm text-slate-200 hover:text-white block leading-snug">
          ${this.escapeHTML(item.title)}
        </a>
        <div class="flex items-center gap-2 mt-1 text-xs text-slate-500">
          <span>${this.escapeHTML(item.source)}</span>
          <span>&middot;</span>
          <span>${this.timeAgo(item.publishedAt)}</span>
          <span class="${sentimentColor}">&middot; ${item.sentiment}</span>
        </div>
        ${linked ? `<a href="${linked.url}" target="_blank" rel="noopener" class="inline-block mt-1 px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300 text-xs">linked market &rarr;</a>` : ''}
      </li>`;
  },

  renderNewsFeed(el, news, allMarkets) {
    if (!news.length) {
      el.innerHTML = `<div class="text-slate-500 text-sm">No news available.</div>`;
      return;
    }
    el.innerHTML = `<ul>${news.map((n) => this.renderNewsItem(n, allMarkets)).join('')}</ul>`;
  },

  renderNarrativeSummary(el, categoryData) {
    el.textContent = Narrative.buildSummary(categoryData);
  },

  renderDivergenceStrip(el, divergences) {
    if (!divergences.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = divergences
      .map(({ market, changePct }) => {
        const sign = changePct > 0 ? '+' : '';
        return `<span class="mr-6">&#9889; ${this.escapeHTML(market.question)} moved ${sign}${changePct}% — no news found</span>`;
      })
      .join('');
  },

  renderStaleBadge(el, isStale) {
    el.classList.toggle('hidden', !isStale);
  },
};
