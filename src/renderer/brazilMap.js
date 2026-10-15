(() => {
  /** Allineato a config/sections.json (proposta progetto). */
  const UF_TO_SECTION = {
    AP: 'nord', PA: 'nord', RR: 'nord',
    GO: 'sud', MS: 'sud', PR: 'sud', RJ: 'sud', RS: 'sud', SC: 'sud', SP: 'sud',
    AL: 'est', BA: 'est', CE: 'est', ES: 'est', MA: 'est', MG: 'est', PB: 'est',
    PE: 'est', PI: 'est', RN: 'est', SE: 'est', TO: 'est', DF: 'est',
    AC: 'ovest', AM: 'ovest', MT: 'ovest', RO: 'ovest',
  };

  const SECTION_META = {
    nord: { label: 'Nord', color: '#0f766e', collection: 'rates_nord' },
    sud: { label: 'Sud', color: '#b45309', collection: 'rates_sud' },
    est: { label: 'Est', color: '#9f1239', collection: 'rates_est' },
    ovest: { label: 'Ovest', color: '#4d7c0f', collection: 'rates_ovest' },
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  /** Mix colore sezione con bianco: t=0 chiaro, t=1 pieno. */
  function sectionFill(section, t) {
    const meta = SECTION_META[section];
    if (!meta) return '#e2e8f0';
    const [r, g, b] = hexToRgb(meta.color);
    const k = 0.28 + 0.72 * Math.max(0, Math.min(1, t));
    const rr = Math.round(255 + (r - 255) * k);
    const gg = Math.round(255 + (g - 255) * k);
    const bb = Math.round(255 + (b - 255) * k);
    return `rgb(${rr},${gg},${bb})`;
  }

  /**
   * @param {HTMLElement} container — #brazilMap
   * @param {object} opts
   * @param {Array} opts.ufStats
   * @param {Record<string,number>} opts.bySection
   * @param {'count'|'revenueAvg'} opts.metric
   * @param {HTMLElement} [opts.legendEl]
   * @param {HTMLElement} [opts.sectionTableEl]
   * @param {(info: object) => void} [opts.onHover]
   */
  function renderBrazilHeatmap(container, opts = {}) {
    const {
      ufStats = [],
      bySection = {},
      metric = 'count',
      legendEl = null,
      sectionTableEl = null,
      onHover = null,
    } = opts;

    const states = window.BRAZIL_STATES;
    if (!states?.length) {
      container.innerHTML = '<p class="hover-detail">Mappa non caricata (brazilStatesData.js).</p>';
      return;
    }

    const byUf = Object.fromEntries(ufStats.map((s) => [s.uf, s]));
    const values = states.map((s) => {
      const row = byUf[s.uf];
      if (!row) return 0;
      return metric === 'revenueAvg' ? row.revenueAvg || 0 : row.count || 0;
    });
    const max = Math.max(0, ...values) || 1;

    const totalRows =
      (bySection.nord || 0) +
      (bySection.sud || 0) +
      (bySection.est || 0) +
      (bySection.ovest || 0);

    const paths = states
      .map((shape) => {
        const section = UF_TO_SECTION[shape.uf] || 'est';
        const row = byUf[shape.uf];
        const value = metric === 'revenueAvg' ? row?.revenueAvg || 0 : row?.count || 0;
        const t = value / max;
        const fill = row ? sectionFill(section, t) : '#e6ecea';
        const label =
          metric === 'revenueAvg'
            ? `avg ${Number(value).toFixed(2)}`
            : `${value} righe`;
        const title = `${shape.uf} · ${shape.name} · ${SECTION_META[section]?.label || section} · ${label}`;

        return `<path class="uf-path" data-uf="${shape.uf}" data-section="${section}" d="${shape.d}" fill="${fill}" stroke="#ffffff" stroke-width="0.8" stroke-linejoin="round"><title>${escapeHtml(title)}</title></path>
        <text class="uf-label" x="${shape.cx}" y="${shape.cy}" text-anchor="middle" dominant-baseline="central">${shape.uf}</text>`;
      })
      .join('\n');

    container.innerHTML = `<svg class="brazil-svg brazil-svg-detailed" viewBox="0 0 560 580" role="img" aria-label="Mappa dettagliata Brasile per sezione">${paths}</svg>`;

    container.querySelectorAll('.uf-path').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        const uf = el.getAttribute('data-uf');
        const section = el.getAttribute('data-section');
        const shape = states.find((s) => s.uf === uf);
        const row = byUf[uf] || { uf, count: 0, revenueAvg: 0, revenueSum: 0 };
        onHover?.({
          uf,
          name: shape?.name || uf,
          section,
          sectionLabel: SECTION_META[section]?.label || section,
          count: row.count || 0,
          revenueAvg: row.revenueAvg || 0,
          revenueSum: row.revenueSum || 0,
          revenueMin: row.revenueMin,
          revenueMax: row.revenueMax,
        });
      });
    });

    if (legendEl) {
      legendEl.innerHTML = ['nord', 'sud', 'est', 'ovest']
        .map((key) => {
          const m = SECTION_META[key];
          const n = bySection[key] || 0;
          const pct = totalRows ? ((n / totalRows) * 100).toFixed(1) : '0.0';
          return `<span><i class="sw" style="background:${m.color}"></i><strong>${m.label}</strong> ${n.toLocaleString('it-IT')} · ${pct}%</span>`;
        })
        .join('');
    }

    if (sectionTableEl) {
      sectionTableEl.innerHTML = `
        <table class="section-stats-table">
          <thead>
            <tr>
              <th>Sezione</th>
              <th>Collection</th>
              <th class="num">Righe</th>
              <th class="num">Quota</th>
            </tr>
          </thead>
          <tbody>
            ${['nord', 'sud', 'est', 'ovest']
              .map((key) => {
                const m = SECTION_META[key];
                const n = bySection[key] || 0;
                const pct = totalRows ? (n / totalRows) * 100 : 0;
                return `<tr>
                  <td><span class="sw" style="background:${m.color}"></span> ${m.label}</td>
                  <td class="mono">${m.collection}</td>
                  <td class="num">${n.toLocaleString('it-IT')}</td>
                  <td class="num">
                    <span class="share">
                      <i style="width:${Math.max(2, pct)}%;background:${m.color}"></i>
                      ${pct.toFixed(1)}%
                    </span>
                  </td>
                </tr>`;
              })
              .join('')}
            <tr class="total-row">
              <td colspan="2"><strong>Totale mappate</strong></td>
              <td class="num"><strong>${totalRows.toLocaleString('it-IT')}</strong></td>
              <td class="num"><strong>100%</strong></td>
            </tr>
          </tbody>
        </table>`;
    }
  }

  window.BrazilMap = {
    renderBrazilHeatmap,
    UF_TO_SECTION,
    SECTION_META,
  };
})();
