const crypto = require('crypto');

function normalizeNumberForHash(n) {
  if (!Number.isFinite(n)) return '';
  const s = String(n);
  if (s.includes('e') || s.includes('E')) {
    return n.toFixed(12).replace(/\.?0+$/, '');
  }
  return s.trim();
}

function normalizeStringForHash(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function sha256(parts) {
  const h = crypto.createHash('sha256');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) h.update('\u0001');
    h.update(parts[i]);
  }
  return h.digest('hex');
}

/**
 * Identità riga tariffa:
 * servizio + from_zip + to_zip + from_weight + to_weight
 */
function computeKeyHash(row) {
  return sha256([
    normalizeStringForHash(row.dhl_service_code),
    normalizeNumberForHash(row.from_zip),
    normalizeNumberForHash(row.to_zip),
    normalizeNumberForHash(row.from_weight),
    normalizeNumberForHash(row.to_weight),
  ]);
}

/** Payload completo normalizzato. */
function computeContentHash(row) {
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

/**
 * Hash di sezione order-independent:
 * SHA-256 di tutte le coppie (key_hash, content_hash) ordinate per key_hash.
 * Stesso multiset di righe → stesso section_hash indipendentemente dall'ordine CSV.
 */
function computeSectionHash(keyToContentMap) {
  const keys = [...keyToContentMap.keys()].sort();
  const h = crypto.createHash('sha256');
  for (const kh of keys) {
    h.update(kh);
    h.update('\u0001');
    h.update(keyToContentMap.get(kh) || '');
    h.update('\n');
  }
  h.update(`\u0002count=${keys.length}`);
  return h.digest('hex');
}

module.exports = {
  computeKeyHash,
  computeContentHash,
  computeSectionHash,
  normalizeNumberForHash,
  normalizeStringForHash,
};
