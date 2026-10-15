import type { Db } from 'mongodb';
import { allRateCollectionNames } from '../db/collections.js';
import type { RateDocument, ValidationIssue, ValidationReport } from '../types.js';

/**
 * Validazione post-import sulla versione caricata (non attiva finché non si chiama activate).
 * Controlla: overlap CEP, buchi fasce peso, prezzi vuoti/negativi.
 */
export async function validateVersion(
  db: Db,
  versionId: string,
): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const checked_at = new Date().toISOString();

  for (const name of allRateCollectionNames()) {
    const col = db.collection<RateDocument>(name);
    const cursor = col.find({ version_id: versionId }).project({
      dhl_service_code: 1,
      from_zip: 1,
      to_zip: 1,
      from_weight: 1,
      to_weight: 1,
      revenue: 1,
      source_row: 1,
    });

    type Slim = Pick<
      RateDocument,
      | 'dhl_service_code'
      | 'from_zip'
      | 'to_zip'
      | 'from_weight'
      | 'to_weight'
      | 'revenue'
      | 'source_row'
    >;

    const byService = new Map<string, Slim[]>();

    for await (const doc of cursor) {
      if (doc.revenue == null || doc.revenue < 0) {
        issues.push({
          code: 'empty_or_negative_price',
          service: doc.dhl_service_code,
          detail: `revenue=${doc.revenue}`,
          row_hint: doc.source_row,
        });
      }
      const list = byService.get(doc.dhl_service_code) ?? [];
      list.push(doc as Slim);
      byService.set(doc.dhl_service_code, list);
    }

    for (const [service, rows] of byService) {
      // Overlap CEP: stesso servizio, range ZIP che si intersecano con fasce peso sovrapposte
      const sorted = [...rows].sort((a, b) => a.from_zip - b.from_zip || a.from_weight - b.from_weight);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i];
          const b = sorted[j];
          if (b.from_zip > a.to_zip) break;
          const zipOverlap = a.from_zip <= b.to_zip && b.from_zip <= a.to_zip;
          const weightOverlap = a.from_weight <= b.to_weight && b.from_weight <= a.to_weight;
          if (zipOverlap && weightOverlap) {
            issues.push({
              code: 'cep_overlap',
              service,
              detail:
                `Overlap ${name}: ZIP ${a.from_zip}-${a.to_zip} ∩ ${b.from_zip}-${b.to_zip}` +
                ` e peso ${a.from_weight}-${a.to_weight} ∩ ${b.from_weight}-${b.to_weight}` +
                ` (righe ~${a.source_row}, ~${b.source_row})`,
              row_hint: a.source_row,
            });
          }
        }
      }

      // Buchi nelle fasce di peso a parità di range ZIP esatto
      const byZip = new Map<string, Slim[]>();
      for (const r of rows) {
        const k = `${r.from_zip}:${r.to_zip}`;
        const list = byZip.get(k) ?? [];
        list.push(r);
        byZip.set(k, list);
      }
      for (const [zipKey, group] of byZip) {
        const weights = [...group].sort((a, b) => a.from_weight - b.from_weight);
        for (let i = 1; i < weights.length; i++) {
          const prev = weights[i - 1];
          const cur = weights[i];
          // Gap se cur.from_weight > prev.to_weight (non contiguo). Contiguità: cur.from == prev.to (o prev.to+epsilon).
          // Per pesi continui tipici: gap se cur.from_weight > prev.to_weight.
          if (cur.from_weight > prev.to_weight) {
            issues.push({
              code: 'weight_gap',
              service,
              detail:
                `Buco peso su ZIP ${zipKey} (${name}): dopo ${prev.from_weight}-${prev.to_weight}` +
                ` manca fino a ${cur.from_weight}-${cur.to_weight}`,
              row_hint: prev.source_row,
            });
          }
        }
      }
    }
  }

  return {
    version_id: versionId,
    ok: issues.length === 0,
    issues,
    checked_at,
  };
}
