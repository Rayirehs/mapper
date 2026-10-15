import { createHash } from 'node:crypto';
import {
  normalizeNumberForHash,
  normalizeStringForHash,
} from './cep/normalize.js';
import type { RateRow } from './types.js';

function sha256(parts: string[]): string {
  const h = createHash('sha256');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) h.update('\u0001');
    h.update(parts[i]);
  }
  return h.digest('hex');
}

/**
 * key_hash = SHA-256(servizio + from_zip + to_zip + from_weight + to_weight)
 * Servizio = dhl_service_code (campo tariffa/servizio nel CSV).
 */
export function computeKeyHash(row: Pick<
  RateRow,
  'dhl_service_code' | 'from_zip' | 'to_zip' | 'from_weight' | 'to_weight'
>): string {
  return sha256([
    normalizeStringForHash(row.dhl_service_code),
    normalizeNumberForHash(row.from_zip),
    normalizeNumberForHash(row.to_zip),
    normalizeNumberForHash(row.from_weight),
    normalizeNumberForHash(row.to_weight),
  ]);
}

/** content_hash = SHA-256 di tutti i campi normalizzati (ordine stabile). */
export function computeContentHash(row: RateRow): string {
  return sha256([
    normalizeNumberForHash(row.from_zip),
    normalizeNumberForHash(row.to_zip),
    normalizeStringForHash(row.destination),
    normalizeNumberForHash(row.from_weight),
    normalizeNumberForHash(row.to_weight),
    normalizeNumberForHash(row.from_vol),
    normalizeNumberForHash(row.to_vol),
    normalizeNumberForHash(row.lead_time),
    normalizeNumberForHash(row.revenue),
    normalizeStringForHash(row.Transporta),
    normalizeStringForHash(row.dhl_service_code),
  ]);
}

/** _id stabile per upsert idempotente entro una versione. */
export function documentId(versionId: string, keyHash: string): string {
  return sha256([normalizeStringForHash(versionId), keyHash]);
}
