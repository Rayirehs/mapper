import type { Db } from 'mongodb';
import { resolveDestination } from '../cep/lookup.js';
import { validateDestinationCep } from '../cep/normalize.js';
import { getActiveVersionId } from '../db/versions.js';
import type { RateDocument } from '../types.js';

export interface FindRateQuery {
  /** CEP destinazione (stringa o numero) */
  cep: string | number;
  /** Codice servizio (dhl_service_code) */
  service: string;
  /** Peso della spedizione */
  weight: number;
  /** Se omesso, usa la versione attiva */
  versionId?: string;
}

export type FindRateResult =
  | {
      ok: true;
      uf: string;
      section: string;
      collection: string;
      version_id: string;
      rate: RateDocument;
    }
  | { ok: false; error: string };

/**
 * Dato CEP destinazione + servizio + peso:
 * valida CEP → UF → sezione → collection → tariffa nella versione attiva.
 */
export async function findRate(db: Db, query: FindRateQuery): Promise<FindRateResult> {
  const cepCheck = validateDestinationCep(query.cep);
  if (!cepCheck.ok) {
    return { ok: false, error: cepCheck.error };
  }

  if (!query.service || !String(query.service).trim()) {
    return { ok: false, error: 'service mancante' };
  }
  if (!Number.isFinite(query.weight) || query.weight < 0) {
    return { ok: false, error: 'weight non valido' };
  }

  const resolved = resolveDestination(cepCheck.cep);
  if (!resolved) {
    return {
      ok: false,
      error: `CEP ${cepCheck.cep} non mappato ad alcuna UF (inesistente o gap nella tabella)`,
    };
  }

  const version_id = query.versionId ?? (await getActiveVersionId(db));
  if (!version_id) {
    return { ok: false, error: 'Nessuna versione attiva — eseguire activate dopo validazione' };
  }

  const rate = await db.collection<RateDocument>(resolved.collection).findOne({
    version_id,
    dhl_service_code: String(query.service).trim(),
    from_zip: { $lte: cepCheck.cep },
    to_zip: { $gte: cepCheck.cep },
    from_weight: { $lte: query.weight },
    to_weight: { $gte: query.weight },
  });

  if (!rate) {
    return {
      ok: false,
      error:
        `Nessuna tariffa in ${resolved.collection} per CEP=${cepCheck.cep}, ` +
        `service=${query.service}, weight=${query.weight}, version=${version_id}`,
    };
  }

  return {
    ok: true,
    uf: resolved.uf,
    section: resolved.section,
    collection: resolved.collection,
    version_id,
    rate,
  };
}
