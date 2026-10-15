export type Section = 'nord' | 'sud' | 'est' | 'ovest';

export type Uf =
  | 'AC' | 'AL' | 'AM' | 'AP' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO' | 'MA'
  | 'MG' | 'MS' | 'MT' | 'PA' | 'PB' | 'PE' | 'PI' | 'PR' | 'RJ' | 'RN'
  | 'RO' | 'RR' | 'RS' | 'SC' | 'SE' | 'SP' | 'TO';

export interface CepRange {
  uf: Uf;
  from: number;
  to: number;
}

export interface SectionsConfig {
  _meta: {
    collections: Record<Section, string>;
    country: string;
    proposal_status?: string;
    note?: string;
  };
  uf_to_section: Record<string, Section>;
}

export interface CepRangesConfig {
  _meta: { sources: string[]; notes: string[] };
  ranges: CepRange[];
}

/** Campi obbligatori del CSV di input. */
export const REQUIRED_COLUMNS = [
  'from_zip',
  'to_zip',
  'destination',
  'from_weight',
  'to_weight',
  'from_vol',
  'to_vol',
  'lead_time',
  'revenue',
  'Transporta',
  'dhl_service_code',
] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

export interface RateRow {
  from_zip: number;
  to_zip: number;
  destination: string;
  from_weight: number;
  to_weight: number;
  from_vol: number;
  to_vol: number;
  lead_time: number;
  revenue: number;
  Transporta: string;
  dhl_service_code: string;
}

export interface RateDocument extends RateRow {
  _id: string;
  key_hash: string;
  content_hash: string;
  uf: Uf;
  section: Section;
  version_id: string;
  source_row: number;
  country: 'BR';
  imported_at: Date;
}

export type DiscardReason =
  | 'missing_columns'
  | 'invalid_cep_range'
  | 'cep_unknown'
  | 'cross_state'
  | 'cross_section'
  | 'invalid_weight'
  | 'invalid_revenue'
  | 'parse_error';

export interface DiscardedRow {
  row: number;
  reason: DiscardReason;
  detail: string;
  from_zip?: number;
  to_zip?: number;
  ufs?: string[];
  sections?: string[];
}

export interface ImportReport {
  version_id: string;
  started_at: string;
  finished_at: string;
  file: string;
  totals: {
    rows_read: number;
    rows_written: number;
    rows_discarded: number;
  };
  per_collection: Record<
    string,
    {
      rows: number;
      /** (rows / rows_written) * 100 — solo sulle righe effettivamente scritte */
      percent_of_written: number;
      /** (rows / rows_read) * 100 — sul totale CSV letto (header escluso) */
      percent_of_read: number;
    }
  >;
  discarded_by_reason: Record<string, number>;
  discarded_sample: DiscardedRow[];
  cross_boundary: DiscardedRow[];
  validation: ValidationReport | null;
  formulas: Record<string, string>;
}

export interface ValidationIssue {
  code:
    | 'cep_overlap'
    | 'weight_gap'
    | 'empty_or_negative_price'
    | 'missing_column';
  service?: string;
  detail: string;
  row_hint?: number;
}

export interface ValidationReport {
  version_id: string;
  ok: boolean;
  issues: ValidationIssue[];
  checked_at: string;
}

export interface VersionMeta {
  _id: string;
  version_id: string;
  status: 'pending' | 'active' | 'rejected' | 'superseded';
  created_at: Date;
  activated_at?: Date;
  import_report_path?: string;
  validation?: ValidationReport;
}
