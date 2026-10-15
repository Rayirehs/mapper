(() => {
  const api = window.csvMapper;

  const els = {
    statusPill: document.getElementById('statusPill'),
    tabMapper: document.getElementById('tabMapper'),
    tabRates: document.getElementById('tabRates'),
    viewMapper: document.getElementById('viewMapper'),
    viewRates: document.getElementById('viewRates'),

    dropZone: document.getElementById('dropZone'),
    browseBtn: document.getElementById('browseBtn'),
    filePanel: document.getElementById('filePanel'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    fileRows: document.getElementById('fileRows'),
    progressPanel: document.getElementById('progressPanel'),
    progressLabel: document.getElementById('progressLabel'),
    progressBar: document.getElementById('progressBar'),
    progressDetail: document.getElementById('progressDetail'),
    processBtn: document.getElementById('processBtn'),
    exportBtn: document.getElementById('exportBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    emptyState: document.getElementById('emptyState'),
    tableWrap: document.getElementById('tableWrap'),
    tableHead: document.getElementById('tableHead'),
    tableBody: document.getElementById('tableBody'),
    tableSummary: document.getElementById('tableSummary'),
    pageSize: document.getElementById('pageSize'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    pageInfo: document.getElementById('pageInfo'),
    statRows: document.getElementById('statRows'),
    statSpeed: document.getElementById('statSpeed'),
    statElapsed: document.getElementById('statElapsed'),

    ratesDropZone: document.getElementById('ratesDropZone'),
    ratesBrowseBtn: document.getElementById('ratesBrowseBtn'),
    ratesFilePanel: document.getElementById('ratesFilePanel'),
    ratesFileName: document.getElementById('ratesFileName'),
    ratesFileSize: document.getElementById('ratesFileSize'),
    ratesProgressPanel: document.getElementById('ratesProgressPanel'),
    ratesProgressLabel: document.getElementById('ratesProgressLabel'),
    ratesProgressBar: document.getElementById('ratesProgressBar'),
    ratesProgressDetail: document.getElementById('ratesProgressDetail'),
    ratesMetricPanel: document.getElementById('ratesMetricPanel'),
    ratesSectionPanel: document.getElementById('ratesSectionPanel'),
    ratesSectionBars: document.getElementById('ratesSectionBars'),
    ratesSyncPanel: document.getElementById('ratesSyncPanel'),
    ratesSyncSummary: document.getElementById('ratesSyncSummary'),
    ratesSyncList: document.getElementById('ratesSyncList'),
    ratesImportBtn: document.getElementById('ratesImportBtn'),
    ratesCancelBtn: document.getElementById('ratesCancelBtn'),
    ratesOpenStateBtn: document.getElementById('ratesOpenStateBtn'),
    ratesEmpty: document.getElementById('ratesEmpty'),
    ratesHeatmapWrap: document.getElementById('ratesHeatmapWrap'),
    ratesSummary: document.getElementById('ratesSummary'),
    ratesLegend: document.getElementById('ratesLegend'),
    ratesSectionTable: document.getElementById('ratesSectionTable'),
    brazilMap: document.getElementById('brazilMap'),
    ratesHoverDetail: document.getElementById('ratesHoverDetail'),
    ratesDiscardList: document.getElementById('ratesDiscardList'),
    metricCount: document.getElementById('metricCount'),
    metricRevenue: document.getElementById('metricRevenue'),
  };

  const state = {
    view: 'mapper',
    file: null,
    total: 0,
    columns: [],
    page: 0,
    pageSize: 100,
    busy: false,
    ratesFile: null,
    ratesBusy: false,
    ratesMetric: 'count',
    ratesResult: null,
  };

  function formatBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  }

  function formatNumber(n) {
    return new Intl.NumberFormat().format(n || 0);
  }

  function setStatus(kind, label) {
    els.statusPill.className = `status-pill ${kind}`;
    els.statusPill.dataset.state = kind;
    els.statusPill.textContent = label;
  }

  function switchView(view) {
    state.view = view;
    els.viewMapper.hidden = view !== 'mapper';
    els.viewRates.hidden = view !== 'rates';
    els.tabMapper.classList.toggle('active', view === 'mapper');
    els.tabRates.classList.toggle('active', view === 'rates');

    if (view === 'rates' && state.ratesResult) {
      els.statRows.textContent = `${formatNumber(state.ratesResult.mapped)} mapped`;
    } else if (view === 'mapper') {
      els.statRows.textContent = `${formatNumber(state.total)} rows processed`;
    }
  }

  els.tabMapper.addEventListener('click', () => switchView('mapper'));
  els.tabRates.addEventListener('click', () => switchView('rates'));

  // —— CSV Mapper ——————————————————————————————

  function setBusy(busy) {
    state.busy = busy;
    els.processBtn.disabled = busy || !state.file;
    els.cancelBtn.disabled = !busy;
    els.exportBtn.disabled = busy || state.total === 0;
    els.browseBtn.disabled = busy;
  }

  async function pickFile() {
    if (state.busy) return;
    const result = await api.openCsv();
    if (!result) return;
    if (result.error) {
      setStatus('error', 'Error');
      alert(result.error);
      return;
    }
    state.file = result;
    state.total = 0;
    state.columns = [];
    state.page = 0;

    els.filePanel.hidden = false;
    els.fileName.textContent = result.name;
    els.fileSize.textContent = formatBytes(result.size);
    els.fileRows.textContent = '—';
    els.progressPanel.hidden = true;
    els.emptyState.hidden = false;
    els.tableWrap.hidden = true;
    els.processBtn.disabled = false;
    els.exportBtn.disabled = true;
    setStatus('ready', 'Ready');
    els.statRows.textContent = '0 rows processed';
    els.statSpeed.textContent = '—';
    els.statElapsed.textContent = '0.0s';
  }

  async function startProcess() {
    if (!state.file || state.busy) return;
    setBusy(true);
    setStatus('processing', 'Processing');
    els.progressPanel.hidden = false;
    els.progressBar.style.width = '0%';
    els.progressLabel.textContent = '0%';
    els.progressDetail.textContent = 'Starting…';
    els.emptyState.hidden = true;
    els.tableWrap.hidden = true;

    const res = await api.startProcess(state.file.path);
    if (!res.ok) {
      setBusy(false);
      setStatus('error', 'Error');
      alert(res.error || 'Failed to start');
    }
  }

  async function loadPage() {
    const offset = state.page * state.pageSize;
    const { rows, total, columns } = await api.getPage(offset, state.pageSize);
    state.total = total;
    state.columns = columns || [];

    els.fileRows.textContent = formatNumber(total);
    els.tableSummary.textContent = `${formatNumber(total)} rows`;
    els.emptyState.hidden = true;
    els.tableWrap.hidden = false;

    const allCols = ['#', 'Key hash', 'Content hash', ...state.columns];
    els.tableHead.innerHTML = `<tr>${allCols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;

    els.tableBody.innerHTML = rows
      .map((row) => {
        const cells = [
          `<td class="cell-index">${formatNumber(row.index + 1)}</td>`,
          `<td class="cell-mono" title="${escapeAttr(row.key_hash)}">${escapeHtml(shortHash(row.key_hash))}</td>`,
          `<td class="cell-mono" title="${escapeAttr(row.content_hash)}">${escapeHtml(shortHash(row.content_hash))}</td>`,
          ...state.columns.map(
            (c) => `<td title="${escapeAttr(row.data[c] ?? '')}">${escapeHtml(row.data[c] ?? '')}</td>`
          ),
        ];
        return `<tr>${cells.join('')}</tr>`;
      })
      .join('');

    const pageCount = Math.max(1, Math.ceil(total / state.pageSize) || 1);
    els.pageInfo.textContent = `Page ${state.page + 1} / ${pageCount}`;
    els.prevPage.disabled = state.page <= 0;
    els.nextPage.disabled = state.page + 1 >= pageCount;
    els.exportBtn.disabled = total === 0 || state.busy;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  api.onProcessEvent((msg) => {
    if (msg.type === 'progress') {
      const pct = Math.min(99, msg.percent || 0);
      els.progressBar.style.width = `${pct.toFixed(1)}%`;
      els.progressLabel.textContent = `${pct.toFixed(1)}%`;
      els.progressDetail.textContent = `${formatNumber(msg.rows)} rows · ${formatNumber(msg.rowsPerSec)} rows/s`;
      if (state.view === 'mapper') {
        els.statRows.textContent = `${formatNumber(msg.rows)} rows processed`;
        els.statSpeed.textContent = `${formatNumber(msg.rowsPerSec)} rows/s`;
        els.statElapsed.textContent = `${((msg.elapsedMs || 0) / 1000).toFixed(1)}s`;
      }
    }

    if (msg.type === 'done') {
      setBusy(false);
      setStatus('done', 'Done');
      els.progressBar.style.width = '100%';
      els.progressLabel.textContent = '100%';
      els.progressDetail.textContent = `${formatNumber(msg.rows)} rows in ${(msg.elapsedMs / 1000).toFixed(1)}s`;
      els.statRows.textContent = `${formatNumber(msg.rows)} rows processed`;
      els.statSpeed.textContent = `${formatNumber(msg.rowsPerSec)} rows/s`;
      els.statElapsed.textContent = `${(msg.elapsedMs / 1000).toFixed(1)}s`;
      state.page = 0;
      loadPage();
    }

    if (msg.type === 'error') {
      setBusy(false);
      setStatus('error', 'Error');
      els.progressDetail.textContent = msg.message || 'Processing failed';
      alert(msg.message || 'Processing failed');
    }

    if (msg.type === 'cancelled') {
      setBusy(false);
      setStatus('ready', 'Ready');
      els.progressDetail.textContent = 'Cancelled';
    }
  });

  els.browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pickFile();
  });
  els.dropZone.addEventListener('click', pickFile);
  els.dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickFile();
    }
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.remove('dragover');
    });
  });
  els.dropZone.addEventListener('drop', () => pickFile());

  els.processBtn.addEventListener('click', startProcess);
  els.cancelBtn.addEventListener('click', () => api.cancelProcess());
  els.exportBtn.addEventListener('click', async () => {
    els.exportBtn.disabled = true;
    const res = await api.exportCsv();
    els.exportBtn.disabled = false;
    if (res?.ok) setStatus('done', 'Exported');
    else if (res?.error) alert(res.error);
  });

  els.prevPage.addEventListener('click', () => {
    if (state.page > 0) {
      state.page -= 1;
      loadPage();
    }
  });
  els.nextPage.addEventListener('click', () => {
    const pageCount = Math.ceil(state.total / state.pageSize);
    if (state.page + 1 < pageCount) {
      state.page += 1;
      loadPage();
    }
  });
  els.pageSize.addEventListener('change', () => {
    state.pageSize = Number(els.pageSize.value) || 100;
    state.page = 0;
    if (state.total > 0) loadPage();
  });

  // —— Tariffe Brasile ——————————————————————————

  function setRatesBusy(busy) {
    state.ratesBusy = busy;
    els.ratesImportBtn.disabled = busy || !state.ratesFile;
    els.ratesCancelBtn.disabled = !busy;
    els.ratesBrowseBtn.disabled = busy;
  }

  async function pickRatesFile() {
    if (state.ratesBusy) return;
    const result = await api.openCsv();
    if (!result) return;
    if (result.error) {
      setStatus('error', 'Error');
      alert(result.error);
      return;
    }
    state.ratesFile = result;
    state.ratesResult = null;
    els.ratesFilePanel.hidden = false;
    els.ratesFileName.textContent = result.name;
    els.ratesFileSize.textContent = formatBytes(result.size);
    els.ratesProgressPanel.hidden = true;
    els.ratesMetricPanel.hidden = true;
    els.ratesSectionPanel.hidden = true;
    els.ratesSyncPanel.hidden = true;
    els.ratesEmpty.hidden = false;
    els.ratesHeatmapWrap.hidden = true;
    els.ratesImportBtn.disabled = false;
    setStatus('ready', 'Ready');
  }

  async function startRatesImport() {
    if (!state.ratesFile || state.ratesBusy) return;
    setRatesBusy(true);
    setStatus('processing', 'Sync');
    els.ratesProgressPanel.hidden = false;
    els.ratesProgressBar.style.width = '0%';
    els.ratesProgressLabel.textContent = '0%';
    els.ratesProgressDetail.textContent = 'Streaming CSV → sezioni…';
    els.ratesEmpty.hidden = true;
    els.ratesHeatmapWrap.hidden = true;
    els.ratesSyncPanel.hidden = true;

    const res = await api.startRatesHeatmap(state.ratesFile.path);
    if (!res.ok) {
      setRatesBusy(false);
      setStatus('error', 'Error');
      alert(res.error || 'Import fallito');
    }
  }

  function shortHash(h) {
    if (!h || h.length < 16) return h || '—';
    return `${h.slice(0, 10)}…${h.slice(-6)}`;
  }

  function renderSyncPanel(msg) {
    const sections = msg.sections || {};
    const summary = msg.syncSummary || {};
    const t = summary.totals || {};

    els.ratesSyncPanel.hidden = false;
    els.ratesOpenStateBtn.disabled = false;
    els.ratesSyncSummary.textContent =
      `${summary.skipped_sections || 0} sezioni skip · ${summary.updated_sections || 0} aggiornate · ` +
      `+${formatNumber(t.added)} / ~${formatNumber(t.changed)} / −${formatNumber(t.removed)}`;

    els.ratesSyncList.innerHTML = ['nord', 'sud', 'est', 'ovest']
      .map((key) => {
        const s = sections[key];
        if (!s) return '';
        const cls = s.skipped ? 'skipped' : 'updated';
        const badge = s.skipped ? 'skip' : 'update';
        const c = s.counts || {};
        return `<div class="sync-item ${cls}">
          <div class="sync-item-head"><span>${key}</span><span class="badge">${badge}</span></div>
          <div class="hash" title="${escapeAttr(s.section_hash || '')}">hash ${escapeHtml(shortHash(s.section_hash))}</div>
          <div class="counts">${
            s.skipped
              ? `${formatNumber(s.count)} righe · invariata`
              : `+${formatNumber(c.added)} · ~${formatNumber(c.changed)} · −${formatNumber(c.removed)} · =${formatNumber(c.unchanged)}`
          }</div>
        </div>`;
      })
      .join('');
  }

  function renderSectionBars(bySection, mapped) {
    const total = mapped || 1;
    const meta = {
      nord: { label: 'Nord', color: '#0f766e' },
      sud: { label: 'Sud', color: '#b45309' },
      est: { label: 'Est', color: '#9f1239' },
      ovest: { label: 'Ovest', color: '#4d7c0f' },
    };
    els.ratesSectionBars.innerHTML = Object.keys(meta)
      .map((key) => {
        const n = bySection?.[key] || 0;
        const pct = ((n / total) * 100).toFixed(1);
        const c = meta[key];
        return `<div class="section-row">
          <div class="section-row-head">
            <span><i class="sw" style="background:${c.color}"></i> ${c.label}</span>
            <strong>${formatNumber(n)} · ${pct}%</strong>
          </div>
          <div class="section-track"><div class="section-fill" style="width:${pct}%;background:${c.color}"></div></div>
        </div>`;
      })
      .join('');
  }

  const DISCARD_LABELS = {
    invalid_cep_range: 'CEP non valido',
    invalid_weight: 'Fascia peso non valida',
    invalid_revenue: 'Prezzo vuoto/negativo',
    missing_service: 'Servizio mancante',
    parse_error: 'Parsing fallito',
    cross_state: 'Range multi-stato (non spezzato)',
    cross_section: 'Range multi-sezione (non spezzato)',
    cep_unknown: 'CEP fuori tabella / gap',
    info_split_cross_state: 'ℹ Spezzate (multi-stato) → mappate',
    info_split_cross_section: 'ℹ Spezzate (multi-sezione) → mappate',
    info_split_cep_unknown: 'ℹ Spezzate (gap parziale) → mappate',
  };

  function renderDiscardList(discardedByReason) {
    const entries = Object.entries(discardedByReason || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      els.ratesDiscardList.innerHTML = '<li><span>Nessuno scarto</span><strong>0</strong></li>';
      return;
    }
    els.ratesDiscardList.innerHTML = entries
      .map(([reason, n]) => {
        const label = DISCARD_LABELS[reason] || reason;
        const info = reason.startsWith('info_') ? ' class="discard-info"' : '';
        return `<li${info}><span>${escapeHtml(label)}</span><strong>${formatNumber(n)}</strong></li>`;
      })
      .join('');
  }

  function paintHeatmap() {
    if (!state.ratesResult) return;
    window.BrazilMap.renderBrazilHeatmap(els.brazilMap, {
      ufStats: state.ratesResult.ufStats,
      bySection: state.ratesResult.bySection || {},
      metric: state.ratesMetric,
      legendEl: els.ratesLegend,
      sectionTableEl: els.ratesSectionTable,
      onHover: (info) => {
        els.ratesHoverDetail.innerHTML = `
          <strong>${escapeHtml(info.uf)}</strong> · ${escapeHtml(info.name || '')}<br/>
          <span class="muted">sezione</span> ${escapeHtml(info.sectionLabel || info.section || '—')}<br/>
          <span class="muted">righe</span> ${formatNumber(info.count)}<br/>
          <span class="muted">revenue media</span> ${Number(info.revenueAvg || 0).toFixed(2)}<br/>
          <span class="muted">min / max</span> ${info.revenueMin ?? '—'} / ${info.revenueMax ?? '—'}
        `;
      },
    });
  }

  function showRatesResult(msg) {
    state.ratesResult = msg;
    els.ratesEmpty.hidden = true;
    els.ratesHeatmapWrap.hidden = false;
    els.ratesMetricPanel.hidden = false;
    els.ratesSectionPanel.hidden = false;
    const sync = msg.syncSummary || {};
    els.ratesSummary.textContent =
      `${formatNumber(msg.rows)} lette · ${formatNumber(msg.mapped)} mappate · ` +
      `${formatNumber(msg.discarded)} scartate` +
      (msg.rowsSplit ? ` · ${formatNumber(msg.rowsSplit)} spezzate` : '') +
      ` · ${sync.skipped_sections || 0} skip / ${sync.updated_sections || 0} update · ` +
      `${(msg.elapsedMs / 1000).toFixed(1)}s`;
    renderSectionBars(msg.bySection, msg.mapped);
    renderDiscardList(msg.discardedByReason);
    renderSyncPanel(msg);
    paintHeatmap();
  }

  api.onRatesEvent((msg) => {
    if (msg.type === 'progress') {
      const pct = Math.min(99, msg.percent || 0);
      els.ratesProgressBar.style.width = `${pct.toFixed(1)}%`;
      els.ratesProgressLabel.textContent = `${pct.toFixed(1)}%`;
      if (msg.phase === 'diff') {
        els.ratesProgressDetail.textContent =
          msg.detail || `Diff sezioni${msg.section ? ` · ${msg.section}` : ''}…`;
      } else {
        els.ratesProgressDetail.textContent =
          `${formatNumber(msg.rows)} lette · ${formatNumber(msg.mapped)} mappate` +
          (msg.rowsPerSec != null ? ` · ${formatNumber(msg.rowsPerSec)}/s` : '');
      }
      if (state.view === 'rates') {
        els.statRows.textContent = `${formatNumber(msg.mapped || 0)} mapped`;
        els.statSpeed.textContent = msg.rowsPerSec != null ? `${formatNumber(msg.rowsPerSec)} rows/s` : '—';
        els.statElapsed.textContent = `${((msg.elapsedMs || 0) / 1000).toFixed(1)}s`;
      }
    }

    if (msg.type === 'done') {
      setRatesBusy(false);
      setStatus('done', 'Synced');
      els.ratesProgressBar.style.width = '100%';
      els.ratesProgressLabel.textContent = '100%';
      const t = msg.syncSummary?.totals || {};
      els.ratesProgressDetail.textContent =
        `skip ${msg.syncSummary?.skipped_sections || 0} · ` +
        `+${formatNumber(t.added)} ~${formatNumber(t.changed)} −${formatNumber(t.removed)}`;
      els.statRows.textContent = `${formatNumber(msg.mapped)} mapped`;
      els.statSpeed.textContent = `${formatNumber(msg.rowsPerSec)} rows/s`;
      els.statElapsed.textContent = `${(msg.elapsedMs / 1000).toFixed(1)}s`;
      showRatesResult(msg);
    }

    if (msg.type === 'error') {
      setRatesBusy(false);
      setStatus('error', 'Error');
      els.ratesProgressDetail.textContent = msg.message || 'Errore';
      els.ratesEmpty.hidden = false;
      alert(msg.message || 'Import fallito');
    }

    if (msg.type === 'cancelled') {
      setRatesBusy(false);
      setStatus('ready', 'Ready');
      els.ratesProgressDetail.textContent = 'Annullato';
    }
  });

  els.ratesBrowseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pickRatesFile();
  });
  els.ratesDropZone.addEventListener('click', pickRatesFile);
  els.ratesDropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickRatesFile();
    }
  });
  ['dragenter', 'dragover'].forEach((ev) => {
    els.ratesDropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.ratesDropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    els.ratesDropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.ratesDropZone.classList.remove('dragover');
    });
  });
  els.ratesDropZone.addEventListener('drop', () => pickRatesFile());

  els.ratesImportBtn.addEventListener('click', startRatesImport);
  els.ratesCancelBtn.addEventListener('click', () => api.cancelRatesHeatmap());
  els.ratesOpenStateBtn.addEventListener('click', async () => {
    const res = await api.openRatesState();
    if (res?.error) alert(res.error);
  });

  function setMetric(metric) {
    state.ratesMetric = metric;
    els.metricCount.classList.toggle('active', metric === 'count');
    els.metricRevenue.classList.toggle('active', metric === 'revenueAvg');
    paintHeatmap();
  }
  els.metricCount.addEventListener('click', () => setMetric('count'));
  els.metricRevenue.addEventListener('click', () => setMetric('revenueAvg'));
})();
