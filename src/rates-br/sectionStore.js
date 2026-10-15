const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { computeSectionHash } = require('./rowHashes');

const SECTIONS = ['nord', 'sud', 'est', 'ovest'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function metaPath(root) {
  return path.join(root, 'meta.json');
}

function sectionDir(root, section) {
  return path.join(root, section);
}

function indexPath(root, section) {
  return path.join(sectionDir(root, section), 'index.tsv');
}

function loadMeta(root) {
  const p = metaPath(root);
  if (!fs.existsSync(p)) {
    return {
      version: 1,
      country: 'BR',
      sections: Object.fromEntries(
        SECTIONS.map((s) => [s, { hash: null, count: 0, updated_at: null }])
      ),
      last_import_at: null,
    };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveMeta(root, meta) {
  ensureDir(root);
  fs.writeFileSync(metaPath(root), JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * Carica index.tsv → Map(key_hash → content_hash).
 * Formato riga: key_hash<TAB>content_hash
 */
async function loadIndexMap(root, section) {
  const p = indexPath(root, section);
  const map = new Map();
  if (!fs.existsSync(p)) return map;

  const rl = readline.createInterface({
    input: fs.createReadStream(p, { highWaterMark: 1024 * 1024 }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return map;
}

/** Scrive index ordinato per key_hash. */
function writeIndexMap(root, section, map) {
  const dir = sectionDir(root, section);
  ensureDir(dir);
  const p = indexPath(root, section);
  const keys = [...map.keys()].sort();
  const fd = fs.openSync(p, 'w');
  try {
    let buf = '';
    for (const kh of keys) {
      buf += `${kh}\t${map.get(kh)}\n`;
      if (buf.length > 1024 * 1024) {
        fs.writeSync(fd, buf);
        buf = '';
      }
    }
    if (buf) fs.writeSync(fd, buf);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Diff tra index precedente e nuovo.
 * - added: key solo in new
 * - removed: key solo in prev
 * - changed: stessa key, content_hash diverso
 * - unchanged: stessa key, stesso content_hash
 */
function diffMaps(prevMap, newMap) {
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const [kh, ch] of newMap) {
    if (!prevMap.has(kh)) added.push(kh);
    else if (prevMap.get(kh) !== ch) changed.push(kh);
    else unchanged += 1;
  }
  for (const kh of prevMap.keys()) {
    if (!newMap.has(kh)) removed.push(kh);
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    counts: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged,
    },
  };
}

/**
 * Carica file temporaneo key\\tcontent (eventuali duplicati: last wins)
 * e restituisce Map + section_hash.
 */
async function mapFromHashFile(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return { map, sectionHash: computeSectionHash(map), duplicates: 0 };

  let duplicates = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const kh = line.slice(0, tab);
    const ch = line.slice(tab + 1);
    if (map.has(kh)) duplicates += 1;
    map.set(kh, ch);
  }

  return { map, sectionHash: computeSectionHash(map), duplicates };
}

/**
 * Scrive report JSON + CSV sezione con key_hash, content_hash (solo righe new).
 * rowsNdjsonPath: NDJSON con { key_hash, content_hash, ...fields }
 * filterKeys: Set di key_hash da includere (added ∪ changed); se null include tutte.
 */
async function writeSectionCsvWithHashes(rowsNdjsonPath, outCsvPath, filterKeys = null) {
  if (!fs.existsSync(rowsNdjsonPath)) return 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(rowsNdjsonPath, { highWaterMark: 1024 * 1024 }),
    crlfDelay: Infinity,
  });

  let headerWritten = false;
  let columns = null;
  let written = 0;
  const out = fs.createWriteStream(outCsvPath);

  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (filterKeys && !filterKeys.has(obj.key_hash)) continue;

    if (!headerWritten) {
      columns = ['key_hash', 'content_hash', ...Object.keys(obj).filter((k) => k !== 'key_hash' && k !== 'content_hash' && k !== 'uf' && k !== 'section')];
      // keep uf/section if present
      if ('uf' in obj) columns.push('uf');
      if ('section' in obj) columns.push('section');
      out.write(columns.map(escape).join(',') + '\n');
      headerWritten = true;
    }

    out.write(columns.map((c) => escape(obj[c])).join(',') + '\n');
    written += 1;
  }

  await new Promise((resolve, reject) => {
    out.end(resolve);
    out.on('error', reject);
  });

  return written;
}

async function writeDiffReport(root, section, diff, sectionHash, prevHash) {
  const dir = sectionDir(root, section);
  ensureDir(dir);
  const report = {
    section,
    section_hash: sectionHash,
    previous_hash: prevHash,
    skipped: false,
    counts: diff.counts,
    formulas: {
      section_hash:
        'SHA-256 di (key_hash + content_hash) ordinati per key_hash; stesso multiset → stesso hash',
      added: 'key_hash presenti solo nel nuovo CSV',
      removed: 'key_hash presenti solo nello stato precedente',
      changed: 'stesso key_hash, content_hash diverso',
      unchanged: 'stesso key_hash e stesso content_hash',
    },
    // sample keys (cap) — full lists su file dedicati se grandi
    sample: {
      added: diff.added.slice(0, 50),
      removed: diff.removed.slice(0, 50),
      changed: diff.changed.slice(0, 50),
    },
  };
  fs.writeFileSync(path.join(dir, 'diff_report.json'), JSON.stringify(report, null, 2));

  const writeList = (name, arr) => {
    fs.writeFileSync(path.join(dir, name), arr.join('\n') + (arr.length ? '\n' : ''), 'utf8');
  };
  writeList('added_keys.txt', diff.added);
  writeList('removed_keys.txt', diff.removed);
  writeList('changed_keys.txt', diff.changed);

  return report;
}

module.exports = {
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
  indexPath,
  sectionDir,
  computeSectionHash,
};
