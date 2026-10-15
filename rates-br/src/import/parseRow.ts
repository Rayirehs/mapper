import { normalizeCep } from '../cep/normalize.js';
import { REQUIRED_COLUMNS, type RateRow } from '../types.js';

export function assertHeaders(headers: string[]): string[] {
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  return missing;
}

function num(v: unknown): number | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export type ParseResult =
  | { ok: true; row: RateRow }
  | { ok: false; reason: 'parse_error' | 'invalid_cep_range' | 'invalid_weight' | 'invalid_revenue'; detail: string };

export function parseRateRow(record: Record<string, string>): ParseResult {
  const from_zip = normalizeCep(record.from_zip);
  const to_zip = normalizeCep(record.to_zip);
  if (from_zip == null || to_zip == null || from_zip > to_zip) {
    return {
      ok: false,
      reason: 'invalid_cep_range',
      detail: `from_zip/to_zip non validi: "${record.from_zip}"–"${record.to_zip}"`,
    };
  }

  const from_weight = num(record.from_weight);
  const to_weight = num(record.to_weight);
  if (from_weight == null || to_weight == null || from_weight < 0 || to_weight < from_weight) {
    return {
      ok: false,
      reason: 'invalid_weight',
      detail: `fascia peso non valida: ${record.from_weight}–${record.to_weight}`,
    };
  }

  const from_vol = num(record.from_vol);
  const to_vol = num(record.to_vol);
  const lead_time = num(record.lead_time);
  const revenue = num(record.revenue);

  if (revenue == null || revenue < 0) {
    return {
      ok: false,
      reason: 'invalid_revenue',
      detail: `revenue vuoto o negativo: "${record.revenue}"`,
    };
  }

  if (from_vol == null || to_vol == null || lead_time == null) {
    return {
      ok: false,
      reason: 'parse_error',
      detail: 'from_vol / to_vol / lead_time non numerici',
    };
  }

  return {
    ok: true,
    row: {
      from_zip,
      to_zip,
      destination: String(record.destination ?? '').trim(),
      from_weight,
      to_weight,
      from_vol,
      to_vol,
      lead_time,
      revenue,
      Transporta: String(record.Transporta ?? '').trim(),
      dhl_service_code: String(record.dhl_service_code ?? '').trim(),
    },
  };
}
