import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CepRange,
  CepRangesConfig,
  Section,
  SectionsConfig,
  Uf,
} from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '../../config');

let rangesCache: CepRange[] | null = null;
let sectionsCache: SectionsConfig | null = null;

export function loadCepRanges(configPath = join(CONFIG_DIR, 'cep-ranges.json')): CepRange[] {
  if (rangesCache && configPath.endsWith('cep-ranges.json')) return rangesCache;
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as CepRangesConfig;
  const ranges = raw.ranges.map((r) => ({
    uf: r.uf as Uf,
    from: r.from,
    to: r.to,
  }));
  if (configPath.endsWith('cep-ranges.json')) rangesCache = ranges;
  return ranges;
}

export function loadSectionsConfig(
  configPath = join(CONFIG_DIR, 'sections.json'),
): SectionsConfig {
  if (sectionsCache && configPath.endsWith('sections.json')) return sectionsCache;
  const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as SectionsConfig;
  if (configPath.endsWith('sections.json')) sectionsCache = cfg;
  return cfg;
}

/** Reset cache (test). */
export function resetConfigCache(): void {
  rangesCache = null;
  sectionsCache = null;
}

export function ufForCep(cep: number, ranges = loadCepRanges()): Uf | null {
  for (const r of ranges) {
    if (cep >= r.from && cep <= r.to) return r.uf;
  }
  return null;
}

export function sectionForUf(uf: Uf, cfg = loadSectionsConfig()): Section {
  const s = cfg.uf_to_section[uf];
  if (!s) {
    throw new Error(`UF ${uf} assente in sections.json — aggiornare la mappa`);
  }
  return s;
}

export function collectionForSection(
  section: Section,
  cfg = loadSectionsConfig(),
): string {
  return cfg._meta.collections[section];
}

export interface RangeAssignment {
  kind: 'ok';
  uf: Uf;
  section: Section;
  collection: string;
}

export interface RangeConflict {
  kind: 'cross_state' | 'cross_section' | 'cep_unknown' | 'invalid_cep_range';
  ufs: Uf[];
  sections: Section[];
  detail: string;
  /** Spezzature proposte (sotto-range omogenei) per gestire il conflitto. */
  suggested_splits: Array<{ from: number; to: number; uf: Uf; section: Section }>;
}

/**
 * Assegna UF/sezione a un range [fromZip, toZip] inclusivo.
 * Se il range tocca più UF o più sezioni → conflitto (non inserire in silenzio).
 */
export function assignRange(
  fromZip: number,
  toZip: number,
  ranges = loadCepRanges(),
  cfg = loadSectionsConfig(),
): RangeAssignment | RangeConflict {
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
      detail: `Range CEP non valido: ${fromZip}–${toZip}`,
      suggested_splits: [],
    };
  }

  const covering = ranges.filter((r) => rangesOverlap(fromZip, toZip, r.from, r.to));
  if (covering.length === 0) {
    return {
      kind: 'cep_unknown',
      ufs: [],
      sections: [],
      detail: `Nessuna UF per CEP ${fromZip}–${toZip} (gap o fuori tabella)`,
      suggested_splits: [],
    };
  }

  // Verifica copertura continua: ogni punto del range deve appartenere a una UF nota.
  // Approccio: unisci i pezzi coperti e confronta con [from,to].
  const covered = mergeIntervals(
    covering.map((r) => ({
      from: Math.max(fromZip, r.from),
      to: Math.min(toZip, r.to),
    })),
  );
  const fullyCovered =
    covered.length === 1 && covered[0].from === fromZip && covered[0].to === toZip;

  if (!fullyCovered) {
    return {
      kind: 'cep_unknown',
      ufs: [...new Set(covering.map((c) => c.uf))],
      sections: [],
      detail: `Range ${fromZip}–${toZip} contiene buchi fuori tabella CEP`,
      suggested_splits: buildSplits(fromZip, toZip, ranges, cfg),
    };
  }

  const ufs = [...new Set(covering.map((c) => c.uf))];
  const sections = [...new Set(ufs.map((u) => sectionForUf(u, cfg)))];

  if (ufs.length > 1) {
    return {
      kind: 'cross_state',
      ufs,
      sections,
      detail: `Range ${fromZip}–${toZip} attraversa UF: ${ufs.join(', ')}. Proposta: spezzare nei sotto-range sotto.`,
      suggested_splits: buildSplits(fromZip, toZip, ranges, cfg),
    };
  }

  if (sections.length > 1) {
    return {
      kind: 'cross_section',
      ufs,
      sections,
      detail: `Range ${fromZip}–${toZip} attraversa sezioni: ${sections.join(', ')}`,
      suggested_splits: buildSplits(fromZip, toZip, ranges, cfg),
    };
  }

  const uf = ufs[0];
  const section = sections[0];
  return {
    kind: 'ok',
    uf,
    section,
    collection: collectionForSection(section, cfg),
  };
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 <= b1 && b0 <= a1;
}

function mergeIntervals(
  intervals: Array<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  const out: Array<{ from: number; to: number }> = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.from <= last.to + 1) {
      last.to = Math.max(last.to, cur.to);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function buildSplits(
  fromZip: number,
  toZip: number,
  ranges: CepRange[],
  cfg: SectionsConfig,
): Array<{ from: number; to: number; uf: Uf; section: Section }> {
  const splits: Array<{ from: number; to: number; uf: Uf; section: Section }> = [];
  for (const r of ranges) {
    const from = Math.max(fromZip, r.from);
    const to = Math.min(toZip, r.to);
    if (from <= to) {
      splits.push({
        from,
        to,
        uf: r.uf,
        section: sectionForUf(r.uf, cfg),
      });
    }
  }
  return splits;
}

/**
 * Risolve destinazione singola (lookup runtime): CEP → UF → sezione → collection.
 */
export function resolveDestination(cep: number): {
  uf: Uf;
  section: Section;
  collection: string;
} | null {
  const uf = ufForCep(cep);
  if (!uf) return null;
  const section = sectionForUf(uf);
  return { uf, section, collection: collectionForSection(section) };
}
