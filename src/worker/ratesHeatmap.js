const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { normalizeCep, resolveAssignments } = require('../rates-br/cepLookup');
const { computeKeyHash, computeContentHash } = require('../rates-br/rowHashes');
const {
  SECTIONS,
  ensureDir,
  loadMeta,
  saveMeta,
  loadIndexMap,
  writeIndexMap,
  diffMaps,
  mapFromHashFile,
  writeSectionCsvWithHashes,
  writeDiffReport,
  sectionDir,
} = require('../rates-br/sectionStore');

const { filePath, stateDir } = workerData;

let cancelled = false;
parentPort.on('message', (msg) => {
  if (msg?.type === 'cancel') cancelled = true;
});

/** Colonne canoniche → alias accettati (case-insensitive). */
const COLUMN_ALIASES = {
  from_zip: ['from_zip', 'fromzip', 'cep_from', 'cep_inicio', 'zip_from', 'origem_cep'],
  to_zip: ['to_zip', 'tozip', 'cep_to', 'cep_fim', 'zip_to', 'destino_cep'],
  destination: ['destination', 'dest', 'destino', 'city', 'cidade'],
  from_weight: ['from_weight', 'fromweight', 'peso_de', 'weight_from', 'peso_min'],
  to_weight: ['to_weight', 'toweight', 'peso_ate', 'peso_até', 'weight_to', 'peso_max'],
  from_vol: ['from_vol', 'fromvol', 'vol_de', 'volume_from'],
  to_vol: ['to_vol', 'tovol', 'vol_ate', 'vol_até', 'volume_to'],
  lead_time: ['lead_time', 'leadtime', 'prazo', 'transit_time', 'sla'],
  revenue: ['revenue', 'price', 'preco', 'preço', 'valor', 'tarifa', 'rate'],
  Transporta: ['transporta', 'carrier', 'transportadora'],
  dhl_service_code: [
    'dhl_service_code',
    'service_code',
    'service',
    'servico',
    'serviço',
    'product',
    'produto',
  ],
};

const REQUIRED_CORE = ['from_zip', 'to_zip', 'from_weight', 'to_weight', 'revenue', 'dhl_service_code'];

function detectDelimiter(sample) {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  if (!lines.length) return ',';
  const header = lines[0];
  const semi = (header.match(/;/g) || []).length;
  const comma = (header.match(/,/g) || []).length;
  const tab = (header.match(/\t/g) || []).length;
  if (tab >= semi && tab >= comma && tab > 0) return '\t';
  if (semi > comma) return ';';
  return ',';
}

function normalizeHeaderKey(k) {
  return String(k || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildColumnMap(headers) {
  const normToOriginal = {};
  for (const h of headers) {
    normToOriginal[normalizeHeaderKey(h)] = h;
  }
  const map = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const hit = normToOriginal[normalizeHeaderKey(alias)];
      if (hit) {
        map[canonical] = hit;
        break;
      }
    }
  }
  return map;
}

function cell(record, colMap, canonical) {
  const key = colMap[canonical];
  return key != null ? record[key] : undefined;
}

function num(v, { defaultValue = null } = {}) {
  if (v == null || String(v).trim() === '') return defaultValue;
  let s = String(v).trim();
  // togli valuta / testo
  s = s.replace(/[R$\s€]/gi, '');
  // 1.234,56 → 1234.56 | 1234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d+$/.test(s)) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : defaultValue;
}

function emptyUfBucket() {
  return { count: 0, revenueSum: 0, revenueMin: null, revenueMax: null };
}

function bumpUf(map, uf, revenue) {
  let b = map[uf];
  if (!b) {
    b = emptyUfBucket();
    map[uf] = b;
  }
  b.count += 1;
  if (Number.isFinite(revenue)) {
    b.revenueSum += revenue;
    b.revenueMin = b.revenueMin == null ? revenue : Math.min(b.revenueMin, revenue);
    b.revenueMax = b.revenueMax == null ? revenue : Math.max(b.revenueMax, revenue);
  }
}

function openSectionWriters(incomingDir) {
  ensureDir(incomingDir);
  const writers = {};
  for (const s of SECTIONS) {
    writers[s] = {
      hashFd: fs.openSync(path.join(incomingDir, `${s}.hashes.tsv`), 'w'),
      rowsFd: fs.openSync(path.join(incomingDir, `${s}.rows.ndjson`), 'w'),
      hashBuf: '',
      rowsBuf: '',
      count: 0,
    };
  }
  return writers;
}

function writeSectionRow(writers, section, keyHash, contentHash, payload) {
  const w = writers[section];
  w.hashBuf += `${keyHash}\t${contentHash}\n`;
  w.rowsBuf += `${JSON.stringify(payload)}\n`;
  w.count += 1;
  if (w.hashBuf.length > 512 * 1024) {
    fs.writeSync(w.hashFd, w.hashBuf);
    w.hashBuf = '';
  }
  if (w.rowsBuf.length > 512 * 1024) {
    fs.writeSync(w.rowsFd, w.rowsBuf);
    w.rowsBuf = '';
  }
}

function closeSectionWriters(writers) {
  for (const s of SECTIONS) {
    const w = writers[s];
    if (w.hashBuf) fs.writeSync(w.hashFd, w.hashBuf);
    if (w.rowsBuf) fs.writeSync(w.rowsFd, w.rowsBuf);
    fs.closeSync(w.hashFd);
    fs.closeSync(w.rowsFd);
  }
}

async function run() {
  const started = Date.now();
  const fileSize = fs.statSync(filePath).size;
  ensureDir(stateDir);

  const incomingDir = path.join(stateDir, '_incoming');
  if (fs.existsSync(incomingDir)) fs.rmSync(incomingDir, { recursive: true, force: true });
  ensureDir(incomingDir);

  const writers = openSectionWriters(incomingDir);
  const byUf = {};
  const bySection = { nord: 0, sud: 0, est: 0, ovest: 0 };
  const discardedByReason = {};
  let rowsRead = 0;
  let rowsMapped = 0;
  let bytesRead = 0;
  let lastEmit = 0;

  parentPort.postMessage({ type: 'started', fileSize, phase: 'stream' });

  let rowsSplit = 0;
  let colMap = null;

  try {
    const probe = Buffer.alloc(Math.min(8192, fileSize));
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, probe, 0, probe.length, 0);
    fs.closeSync(fd);
    const delimiter = detectDelimiter(probe.toString('utf8'));

    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
      const parser = parse({
        columns: true,
        bom: true,
        delimiter,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });

      let headersOk = false;

      const bumpDiscard = (reason) => {
        discardedByReason[reason] = (discardedByReason[reason] || 0) + 1;
      };

      input.on('data', (chunk) => {
        bytesRead += chunk.length;
      });

      parser.on('readable', () => {
        let record;
        while ((record = parser.read()) !== null) {
          if (cancelled) {
            input.destroy();
            parser.destroy();
            parentPort.postMessage({ type: 'cancelled' });
            resolve();
            return;
          }

          if (!headersOk) {
            headersOk = true;
            colMap = buildColumnMap(Object.keys(record));
            const missing = REQUIRED_CORE.filter((c) => !colMap[c]);
            if (missing.length) {
              parentPort.postMessage({
                type: 'error',
                message:
                  `Colonne mancanti (o nomi non riconosciuti): ${missing.join(', ')}.\n` +
                  `Header trovati: ${Object.keys(record).join(', ')}\n` +
                  `Delimitatore rilevato: ${JSON.stringify(delimiter)}`,
              });
              reject(new Error(`missing columns: ${missing.join(', ')}`));
              return;
            }
          }

          rowsRead += 1;

          const from_zip = normalizeCep(cell(record, colMap, 'from_zip'));
          const to_zip = normalizeCep(cell(record, colMap, 'to_zip'));
          if (from_zip == null || to_zip == null || from_zip > to_zip) {
            bumpDiscard('invalid_cep_range');
            continue;
          }

          const from_weight = num(cell(record, colMap, 'from_weight'));
          const to_weight = num(cell(record, colMap, 'to_weight'));
          const from_vol = num(cell(record, colMap, 'from_vol'), { defaultValue: 0 });
          const to_vol = num(cell(record, colMap, 'to_vol'), { defaultValue: 0 });
          const lead_time = num(cell(record, colMap, 'lead_time'), { defaultValue: 0 });
          const revenue = num(cell(record, colMap, 'revenue'));

          if (from_weight == null || to_weight == null || from_weight < 0 || to_weight < from_weight) {
            bumpDiscard('invalid_weight');
            continue;
          }
          if (revenue == null || revenue < 0) {
            bumpDiscard('invalid_revenue');
            continue;
          }

          const resolved = resolveAssignments(from_zip, to_zip);
          if (!resolved.ok || !resolved.pieces.length) {
            bumpDiscard(resolved.reason || 'cep_unknown');
            continue;
          }

          if (resolved.split) {
            rowsSplit += 1;
            // non è uno scarto: spezziamo e mappiamo i pezzi
            discardedByReason[`info_split_${resolved.reason}`] =
              (discardedByReason[`info_split_${resolved.reason}`] || 0) + 1;
          }

          const destination = String(cell(record, colMap, 'destination') ?? '').trim();
          const Transporta = String(cell(record, colMap, 'Transporta') ?? '').trim();
          const dhl_service_code = String(cell(record, colMap, 'dhl_service_code') ?? '').trim();
          if (!dhl_service_code) {
            bumpDiscard('missing_service');
            continue;
          }

          for (const piece of resolved.pieces) {
            const row = {
              from_zip: piece.from,
              to_zip: piece.to,
              destination,
              from_weight,
              to_weight,
              from_vol,
              to_vol,
              lead_time,
              revenue,
              Transporta,
              dhl_service_code,
            };

            const key_hash = computeKeyHash(row);
            const content_hash = computeContentHash(row);

            writeSectionRow(writers, piece.section, key_hash, content_hash, {
              key_hash,
              content_hash,
              ...row,
              uf: piece.uf,
              section: piece.section,
            });

            bumpUf(byUf, piece.uf, revenue);
            bySection[piece.section] += 1;
            rowsMapped += 1;
          }

          const now = Date.now();
          if (now - lastEmit > 200) {
            lastEmit = now;
            const elapsed = (now - started) / 1000;
            parentPort.postMessage({
              type: 'progress',
              phase: 'stream',
              rows: rowsRead,
              mapped: rowsMapped,
              percent: fileSize ? Math.min(70, (bytesRead / fileSize) * 70) : 0,
              rowsPerSec: elapsed > 0 ? Math.round(rowsRead / elapsed) : 0,
              elapsedMs: now - started,
            });
          }
        }
      });

      parser.on('error', reject);
      input.on('error', reject);
      parser.on('end', () => resolve());
      input.pipe(parser);
    });
  } finally {
    closeSectionWriters(writers);
  }

  if (cancelled) return;

  // —— Fase 2: hash sezione + diff incrementale ——
  parentPort.postMessage({ type: 'progress', phase: 'diff', percent: 72, rows: rowsRead, mapped: rowsMapped });

  const meta = loadMeta(stateDir);
  const sectionResults = {};

  for (let i = 0; i < SECTIONS.length; i++) {
    if (cancelled) {
      parentPort.postMessage({ type: 'cancelled' });
      return;
    }

    const section = SECTIONS[i];
    const hashFile = path.join(incomingDir, `${section}.hashes.tsv`);
    const rowsFile = path.join(incomingDir, `${section}.rows.ndjson`);

    parentPort.postMessage({
      type: 'progress',
      phase: 'diff',
      section,
      percent: 72 + ((i + 1) / SECTIONS.length) * 26,
      rows: rowsRead,
      mapped: rowsMapped,
      detail: `Sezione ${section}: calcolo hash…`,
    });

    const { map: newMap, sectionHash, duplicates } = await mapFromHashFile(hashFile);
    const prev = meta.sections[section] || { hash: null, count: 0 };
    const prevHash = prev.hash;

    if (prevHash && prevHash === sectionHash) {
      // Nessun update: sezione invariata
      sectionResults[section] = {
        section,
        skipped: true,
        section_hash: sectionHash,
        previous_hash: prevHash,
        count: newMap.size,
        duplicates,
        counts: { added: 0, removed: 0, changed: 0, unchanged: newMap.size },
      };
      // cleanup incoming for this section
      try {
        fs.unlinkSync(hashFile);
        fs.unlinkSync(rowsFile);
      } catch {
        /* ignore */
      }
      continue;
    }

    const prevMap = await loadIndexMap(stateDir, section);
    const diff = diffMaps(prevMap, newMap);

    writeIndexMap(stateDir, section, newMap);
    const report = await writeDiffReport(stateDir, section, diff, sectionHash, prevHash);

    // CSV sezione con key_hash + content_hash (tutte le righe nuove)
    const csvPath = path.join(sectionDir(stateDir, section), `${section}_with_hashes.csv`);
    await writeSectionCsvWithHashes(rowsFile, csvPath, null);

    // CSV solo delta (added + changed) per update mirati
    const deltaKeys = new Set([...diff.added, ...diff.changed]);
    const deltaCsv = path.join(sectionDir(stateDir, section), `${section}_delta.csv`);
    await writeSectionCsvWithHashes(rowsFile, deltaCsv, deltaKeys);

    meta.sections[section] = {
      hash: sectionHash,
      count: newMap.size,
      updated_at: new Date().toISOString(),
      last_diff: diff.counts,
    };

    sectionResults[section] = {
      section,
      skipped: false,
      section_hash: sectionHash,
      previous_hash: prevHash,
      count: newMap.size,
      duplicates,
      counts: diff.counts,
      files: {
        index: path.join(sectionDir(stateDir, section), 'index.tsv'),
        csv: csvPath,
        delta: deltaCsv,
        report: path.join(sectionDir(stateDir, section), 'diff_report.json'),
      },
      sample: report.sample,
    };

    try {
      fs.unlinkSync(hashFile);
      fs.unlinkSync(rowsFile);
    } catch {
      /* ignore */
    }
  }

  meta.last_import_at = new Date().toISOString();
  meta.source_file = path.basename(filePath);
  saveMeta(stateDir, meta);

  try {
    fs.rmSync(incomingDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const ufStats = Object.entries(byUf).map(([uf, b]) => ({
    uf,
    count: b.count,
    revenueSum: b.revenueSum,
    revenueAvg: b.count ? b.revenueSum / b.count : 0,
    revenueMin: b.revenueMin,
    revenueMax: b.revenueMax,
  }));

  const discarded = Object.entries(discardedByReason)
    .filter(([k]) => !k.startsWith('info_'))
    .reduce((a, [, n]) => a + n, 0);
  const elapsedMs = Date.now() - started;

  const syncSummary = {
    skipped_sections: SECTIONS.filter((s) => sectionResults[s]?.skipped).length,
    updated_sections: SECTIONS.filter((s) => sectionResults[s] && !sectionResults[s].skipped).length,
    totals: SECTIONS.reduce(
      (acc, s) => {
        const c = sectionResults[s]?.counts || {};
        acc.added += c.added || 0;
        acc.removed += c.removed || 0;
        acc.changed += c.changed || 0;
        acc.unchanged += c.unchanged || 0;
        return acc;
      },
      { added: 0, removed: 0, changed: 0, unchanged: 0 }
    ),
  };

  parentPort.postMessage({
    type: 'done',
    rows: rowsRead,
    mapped: rowsMapped,
    discarded,
    discardedByReason,
    rowsSplit,
    bySection,
    ufStats,
    sections: sectionResults,
    syncSummary,
    stateDir,
    elapsedMs,
    rowsPerSec: elapsedMs > 0 ? Math.round(rowsRead / (elapsedMs / 1000)) : 0,
    formulas: {
      section_hash:
        'SHA-256(coppie key_hash+content_hash ordinate per key_hash). Uguale ⇒ sezione skip, nessun update.',
      key_hash: 'SHA-256(dhl_service_code, from_zip, to_zip, from_weight, to_weight)',
      content_hash: 'SHA-256(tutti i campi riga normalizzati)',
      rowsSplit:
        'CSV rows il cui range CEP attraversava più UF: spezzate automaticamente nei pezzi per stato',
      discarded: 'righe non mappabili (esclusi gli info_split_*)',
      added: 'key_hash solo nel nuovo file',
      removed: 'key_hash solo nello stato precedente',
      changed: 'stesso key_hash, content_hash diverso',
    },
  });
}

run().catch((err) => {
  parentPort.postMessage({ type: 'error', message: err.message || String(err) });
});
