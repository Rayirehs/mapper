/**
 * Normalizza un CEP brasiliano a intero 0..99999999 (8 cifre senza zero iniziale nel numero JS).
 * Accetta: 1000000, "1000000", "01000-000", "01000000", "01000 000".
 */
export function normalizeCep(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || input > 99999999) return null;
    return Math.trunc(input);
  }
  const digits = String(input).replace(/\D/g, '');
  if (!digits) return null;
  // Se arrivano meno di 8 cifre, sono già senza zero iniziale (es. 1000000).
  // Se arrivano 8 cifre, parseInt toglie lo zero iniziale numericamente.
  if (digits.length > 8) return null;
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 0 || n > 99999999) return null;
  return n;
}

/** Valida CEP di destinazione per la ricerca (deve rientrare in 0..99999999 e 1–8 cifre). */
export function validateDestinationCep(input: unknown): {
  ok: true;
  cep: number;
} | {
  ok: false;
  error: string;
} {
  if (input == null || String(input).trim() === '') {
    return { ok: false, error: 'CEP mancante' };
  }
  const raw = String(input).trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 8) {
    return { ok: false, error: `CEP non valido (attese 1–8 cifre numeriche): "${raw}"` };
  }
  const cep = normalizeCep(raw);
  if (cep == null) {
    return { ok: false, error: `CEP fuori range: "${raw}"` };
  }
  return { ok: true, cep };
}

/** Formato stabile per hash: intero senza padding, senza spazi. */
export function normalizeNumberForHash(n: number): string {
  if (!Number.isFinite(n)) return '';
  // Evita notazione scientifica; trim trailing zeros su decimali.
  const s = String(n);
  if (s.includes('e') || s.includes('E')) {
    return n.toFixed(12).replace(/\.?0+$/, '');
  }
  return s.trim();
}

export function normalizeStringForHash(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}
