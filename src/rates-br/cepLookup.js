const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, 'config');

let ranges = null;
let sectionsCfg = null;

function loadRanges() {
  if (!ranges) {
    ranges = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'cep-ranges.json'), 'utf8')).ranges;
  }
  return ranges;
}

function loadSections() {
  if (!sectionsCfg) {
    sectionsCfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'sections.json'), 'utf8'));
  }
  return sectionsCfg;
}

function normalizeCep(input) {
  if (input == null) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || input > 99999999) return null;
    return Math.trunc(input);
  }
  const digits = String(input).replace(/\D/g, '');
  if (!digits || digits.length > 8) return null;
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 0 || n > 99999999) return null;
  return n;
}

function ufForCep(cep) {
  for (const r of loadRanges()) {
    if (cep >= r.from && cep <= r.to) return r.uf;
  }
  return null;
}

function sectionForUf(uf) {
  return loadSections().uf_to_section[uf] || null;
}

function collectionForSection(section) {
  return loadSections()._meta.collections[section];
}

function rangesOverlap(a0, a1, b0, b1) {
  return a0 <= b1 && b0 <= a1;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  const out = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.from <= last.to + 1) last.to = Math.max(last.to, cur.to);
    else out.push({ ...cur });
  }
  return out;
}

function buildSplits(fromZip, toZip, ranges, cfg) {
  const splits = [];
  for (const r of ranges) {
    const from = Math.max(fromZip, r.from);
    const to = Math.min(toZip, r.to);
    if (from <= to) {
      const section = cfg.uf_to_section[r.uf];
      if (!section) continue;
      splits.push({
        from,
        to,
        uf: r.uf,
        section,
        collection: collectionForSection(section),
      });
    }
  }
  return splits;
}

/**
 * Assegna UF/sezione a un range CEP.
 * Se attraversa più UF, kind=cross_state + suggested_splits (spezzature omogenee).
 */
function assignRange(fromZip, toZip) {
  const list = loadRanges();
  const cfg = loadSections();

  if (
    !Number.isFinite(fromZip) ||
    !Number.isFinite(toZip) ||
    fromZip < 0 ||
    toZip > 99999999 ||
    fromZip > toZip
  ) {
    return {
      kind: 'invalid_cep_range',
      ufs: [],
      sections: [],
      suggested_splits: [],
      detail: `Range non valido ${fromZip}–${toZip}`,
    };
  }

  const covering = list.filter((r) => rangesOverlap(fromZip, toZip, r.from, r.to));
  if (!covering.length) {
    return {
      kind: 'cep_unknown',
      ufs: [],
      sections: [],
      suggested_splits: [],
      detail: `Nessuna UF per ${fromZip}–${toZip}`,
    };
  }

  const splits = buildSplits(fromZip, toZip, list, cfg);
  const covered = mergeIntervals(splits.map((s) => ({ from: s.from, to: s.to })));
  const fullyCovered =
    covered.length === 1 && covered[0].from === fromZip && covered[0].to === toZip;

  const ufs = [...new Set(splits.map((s) => s.uf))];
  const sections = [...new Set(splits.map((s) => s.section))];

  if (!fullyCovered) {
    return {
      kind: 'cep_unknown',
      ufs,
      sections,
      suggested_splits: splits,
      detail: `Buchi fuori tabella in ${fromZip}–${toZip}`,
    };
  }

  if (ufs.length > 1) {
    return {
      kind: 'cross_state',
      ufs,
      sections,
      suggested_splits: splits,
      detail: `Attraversa UF: ${ufs.join(', ')}`,
    };
  }
  if (sections.length > 1) {
    return {
      kind: 'cross_section',
      ufs,
      sections,
      suggested_splits: splits,
      detail: `Attraversa sezioni: ${sections.join(', ')}`,
    };
  }

  const uf = ufs[0];
  const section = sections[0];
  return {
    kind: 'ok',
    uf,
    section,
    collection: collectionForSection(section),
    suggested_splits: [],
  };
}

/**
 * Risolve un range in uno o più pezzi mappabili (auto-split se cross_state).
 * I gap (cep_unknown) usano solo i pezzi coperti se esistono.
 */
function resolveAssignments(fromZip, toZip) {
  const a = assignRange(fromZip, toZip);
  if (a.kind === 'ok') {
    return {
      ok: true,
      split: false,
      reason: null,
      pieces: [{ from: fromZip, to: toZip, uf: a.uf, section: a.section, collection: a.collection }],
    };
  }
  if (
    (a.kind === 'cross_state' || a.kind === 'cross_section' || a.kind === 'cep_unknown') &&
    a.suggested_splits?.length
  ) {
    return {
      ok: true,
      split: true,
      reason: a.kind,
      pieces: a.suggested_splits,
    };
  }
  return { ok: false, split: false, reason: a.kind, pieces: [], detail: a.detail };
}

module.exports = {
  normalizeCep,
  ufForCep,
  sectionForUf,
  collectionForSection,
  assignRange,
  resolveAssignments,
  loadSections,
  loadRanges,
};
