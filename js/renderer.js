// Polymarket Pulse — DOM rendering

const Renderer = {
  _charts: new Map(), // marketId -> Chart.js instance, so refreshes don't leak canvases

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
    return `<span class="text-slate-500">&rarr; 0%</span>`;
  },

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  },

  formatNumber(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return Math.round(n).toString();
  },

  renderTimestamp(el) {
    el.textContent = `last updated ${new Date().toLocaleTimeString()}`;
  },

  renderTicker(el, markets) {
    if (!markets.length) {
      el.innerHTML = '<span>No market data available.</span>';
      return;
    }
    const items = markets
      .map((m) => {
        const pct = Math.round(m.probability * 100);
        const color = m.change24h > 0 ? 'text-emerald-400' : m.change24h < 0 ? 'text-rose-400' : 'text-slate-400';
        const arrow = m.change24h > 0 ? '&uarr;' : m.change24h < 0 ? '&darr;' : '&rarr;';
        return `<span class="${color}">${this.escapeHTML(m.question.slice(0, 40))} ${pct}% ${arrow}</span>`;
      })
      .join('<span class="text-slate-700">&middot;</span>');
    // Duplicate content so the CSS marquee (-50% translateX) loops seamlessly.
    el.innerHTML = items + '<span class="text-slate-700 mx-8">&middot;</span>' + items;
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
        const colorClass = { up: 'border-emerald-800/60 text-emerald-400', down: 'border-rose-800/60 text-rose-400', flat: 'border-[#1a1f2b] text-slate-500' }[momentum];

        return `
          <div class="rounded border ${colorClass} bg-[#0a0d14] p-2.5 flex flex-col gap-0.5">
            <div class="text-[11px] text-slate-500 font-mono uppercase tracking-wide">${this.escapeHTML(label)}</div>
            <div class="text-xl font-mono font-semibold flex items-center gap-1.5">
              ${arrow} ${count}
            </div>
            <div class="text-[11px] text-slate-600 font-mono">
              ${top ? `${Math.round(top.probability * 100)}%` : '--'} &middot; $${this.formatNumber(volume)}
            </div>
          </div>`;
      })
      .join('');
  },

  renderCalibrationPanel(el, calibration) {
    if (calibration.sampleSize === 0) {
      el.innerHTML = '<span class="text-slate-500">No recently resolved markets to score.</span>';
      return;
    }
    const scoreColor = calibration.score >= 70 ? 'text-emerald-400' : calibration.score >= 50 ? 'text-amber-400' : 'text-rose-400';
    const rows = calibration.items
      .slice(0, 5)
      .map((i) => {
        const icon = i.correct ? '<span class="text-emerald-400">&check;</span>' : '<span class="text-rose-400">&cross;</span>';
        return `<li class="flex items-center gap-2 text-xs text-slate-500 truncate">${icon} <span class="truncate">${this.escapeHTML(i.market.question)}</span></li>`;
      })
      .join('');
    el.innerHTML = `
      <div class="flex items-baseline gap-2 mb-2">
        <span class="text-2xl font-mono font-bold ${scoreColor}">${calibration.score}%</span>
        <span class="text-xs text-slate-500">called it right on last ${calibration.sampleSize} resolved markets</span>
      </div>
      <ul class="flex flex-col gap-1">${rows}</ul>`;
  },

  renderMarketCard(market, allMarkets) {
    const pct = Math.round(market.probability * 100);
    const sentence = Narrative.buildMarketSentence(market);
    const tags = market.tags.slice(0, 3)
      .map((t) => `<span class="px-1.5 py-0.5 rounded bg-[#141925] text-[10px] text-slate-500 font-mono uppercase">${this.escapeHTML(t)}</span>`)
      .join('');

    const related = Narrative.findRelated(market, allMarkets);
    const relatedChips = related
      .map((r) => `<a href="${r.url}" target="_blank" rel="noopener" class="px-1.5 py-0.5 rounded bg-indigo-950/50 text-[10px] text-indigo-300 hover:text-indigo-200 truncate max-w-[120px]" title="${this.escapeHTML(r.question)}">${this.escapeHTML(r.question.slice(0, 24))}&hellip;</a>`)
      .join('');

    return `
      <div data-market-id="${market.id}" class="market-card block rounded border border-[#1a1f2b] bg-[#0a0d14] p-2.5">
        <a href="${market.url}" target="_blank" rel="noopener" class="block">
          <div class="text-[13px] text-slate-200 font-medium line-clamp-2 mb-1.5">${this.escapeHTML(market.question)}</div>
          <div class="flex items-baseline gap-2 mb-1">
            <span class="text-2xl font-mono font-bold ${this.probColorClass(market.probability)}">${pct}%</span>
            <span class="font-mono text-xs">${this.changeBadge(market.change24h)}</span>
            <span data-spread-id="${market.id}" class="font-mono text-[10px] text-slate-600 ml-auto"></span>
          </div>
        </a>
        <canvas data-spark-id="${market.id}" class="sparkline-canvas mb-1.5"></canvas>
        <div class="flex items-center gap-2 text-[11px] text-slate-600 font-mono mb-1.5">
          <span>VOL $${this.formatNumber(market.volume)}</span>
          <span>LIQ $${this.formatNumber(market.liquidity)}</span>
          ${market.endDate ? `<span class="ml-auto">${new Date(market.endDate).toLocaleDateString()}</span>` : ''}
        </div>
        <p class="text-[11px] text-slate-500 mb-1.5 leading-snug">${this.escapeHTML(sentence)}</p>
        <div class="flex gap-1 flex-wrap mb-1">${tags}</div>
        ${relatedChips ? `<div class="flex gap-1 flex-wrap pt-1 border-t border-[#1a1f2b]">${relatedChips}</div>` : ''}
      </div>`;
  },

  renderMarketGrid(el, markets, allMarkets) {
    // Destroy charts belonging to cards we're about to replace.
    this._charts.forEach((chart) => chart.destroy());
    this._charts.clear();

    if (!markets.length) {
      el.innerHTML = `<div class="text-slate-500 text-sm col-span-full font-mono">NO MARKETS FOUND FOR THIS CATEGORY.</div>`;
      return;
    }
    el.innerHTML = markets.map((m) => this.renderMarketCard(m, allMarkets)).join('');
  },

  renderSparkline(marketId, history) {
    const canvas = document.querySelector(`[data-spark-id="${marketId}"]`);
    if (!canvas || typeof Chart === 'undefined' || !history?.length) return;

    const prices = history.map((p) => Number(p.p ?? p.price ?? 0));
    const isUp = prices[prices.length - 1] >= prices[0];
    const color = isUp ? '#34d399' : '#fb7185';

    this._charts.get(marketId)?.destroy();
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: prices.map((_, i) => i),
        datasets: [{
          data: prices,
          borderColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2,
          fill: false,
        }],
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { borderJoinStyle: 'round' } },
      },
    });
    this._charts.set(marketId, chart);
  },

  renderSpread(marketId, spread) {
    const el = document.querySelector(`[data-spread-id="${marketId}"]`);
    if (!el) return;
    el.textContent = spread != null ? `SPREAD ${Math.round(spread * 100)}¢` : '';
  },

  renderNewsItem(item, allMarkets) {
    const linked = News.findLinkedMarket(item, allMarkets);
    const sentimentColor = { bullish: 'text-emerald-400', bearish: 'text-rose-400', neutral: 'text-slate-500' }[item.sentiment];

    return `
      <li class="border-b border-[#141925] pb-2 mb-2 last:border-0">
        <a href="${item.url}" target="_blank" rel="noopener" class="text-[13px] text-slate-300 hover:text-white block leading-snug">
          ${this.escapeHTML(item.title)}
        </a>
        <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-600 font-mono">
          <span>${this.escapeHTML(item.source)}</span>
          <span>&middot;</span>
          <span>${this.timeAgo(item.publishedAt)}</span>
          <span class="${sentimentColor}">&middot; ${item.sentiment.toUpperCase()}</span>
        </div>
        ${linked ? `<a href="${linked.url}" target="_blank" rel="noopener" class="inline-block mt-1 px-1.5 py-0.5 rounded bg-indigo-950/50 text-indigo-300 text-[10px] font-mono">LINKED MARKET &rarr;</a>` : ''}
      </li>`;
  },

  renderNewsFeed(el, news, allMarkets) {
    if (!news.length) {
      el.innerHTML = `<div class="text-slate-500 text-sm font-mono">NO NEWS AVAILABLE.</div>`;
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
