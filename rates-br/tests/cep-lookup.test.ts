import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignRange,
  ufForCep,
  resolveDestination,
  sectionForUf,
} from '../src/cep/lookup.js';
import { normalizeCep, validateDestinationCep } from '../src/cep/normalize.js';
import { computeKeyHash, computeContentHash } from '../src/hash.js';

describe('normalizeCep', () => {
  it('accetta 01000-000 come 1000000', () => {
    assert.equal(normalizeCep('01000-000'), 1000000);
    assert.equal(normalizeCep('01000000'), 1000000);
    assert.equal(normalizeCep(1000000), 1000000);
  });

  it('rifiuta input non numerico', () => {
    assert.equal(normalizeCep('abc'), null);
    assert.equal(normalizeCep(''), null);
  });
});

describe('validateDestinationCep', () => {
  it('valida CEP di input', () => {
    assert.equal(validateDestinationCep('01310-100').ok, true);
    assert.equal(validateDestinationCep('').ok, false);
    assert.equal(validateDestinationCep('12abc').ok, true); // digits only → 12
  });
});

describe('ufForCep — bordi di stato', () => {
  it('SP bordo inferiore e superiore', () => {
    assert.equal(ufForCep(1000000), 'SP');
    assert.equal(ufForCep(19999999), 'SP');
    assert.equal(ufForCep(20000000), 'RJ');
  });

  it('RJ/ES bordo', () => {
    assert.equal(ufForCep(28999999), 'RJ');
    assert.equal(ufForCep(29000000), 'ES');
    assert.equal(ufForCep(29999999), 'ES');
    assert.equal(ufForCep(30000000), 'MG');
  });
});

describe('DF e GO — due tratti intercalati', () => {
  it('DF tratto 1 e 2', () => {
    assert.equal(ufForCep(70000000), 'DF');
    assert.equal(ufForCep(72799999), 'DF');
    assert.equal(ufForCep(73000000), 'DF');
    assert.equal(ufForCep(73699999), 'DF');
  });

  it('GO tratti intercalati', () => {
    assert.equal(ufForCep(72800000), 'GO');
    assert.equal(ufForCep(72999999), 'GO');
    assert.equal(ufForCep(73700000), 'GO');
    assert.equal(ufForCep(76799999), 'GO');
  });

  it('bordo DF→GO→DF→GO', () => {
    assert.equal(ufForCep(72799999), 'DF');
    assert.equal(ufForCep(72800000), 'GO');
    assert.equal(ufForCep(72999999), 'GO');
    assert.equal(ufForCep(73000000), 'DF');
    assert.equal(ufForCep(73699999), 'DF');
    assert.equal(ufForCep(73700000), 'GO');
  });
});

describe('Roraima dentro Amazonas', () => {
  it('RR è 69300000–69399999', () => {
    assert.equal(ufForCep(69300000), 'RR');
    assert.equal(ufForCep(69399999), 'RR');
  });

  it('AM prima e dopo RR', () => {
    assert.equal(ufForCep(69000000), 'AM');
    assert.equal(ufForCep(69299999), 'AM');
    assert.equal(ufForCep(69400000), 'AM');
    assert.equal(ufForCep(69899999), 'AM');
  });

  it('range che include RR dentro AM → cross_state', () => {
    const r = assignRange(69000000, 69500000);
    assert.equal(r.kind, 'cross_state');
    if (r.kind === 'cross_state') {
      assert.ok(r.ufs.includes('AM'));
      assert.ok(r.ufs.includes('RR'));
      assert.ok(r.suggested_splits.length >= 2);
    }
  });
});

describe('CEP inesistente / gap', () => {
  it('gap MT–MS (789xxxxx) se presente nella tabella', () => {
    // 78900000–78999999 non è in nessuna UF nella nostra tabella
    assert.equal(ufForCep(78900000), null);
    const r = assignRange(78900000, 78950000);
    assert.equal(r.kind, 'cep_unknown');
  });

  it('resolveDestination su CEP sconosciuto', () => {
    assert.equal(resolveDestination(78900000), null);
  });
});

describe('sezioni di progetto', () => {
  it('mappa proposta iniziale', () => {
    assert.equal(sectionForUf('PA'), 'nord');
    assert.equal(sectionForUf('SP'), 'sud');
    assert.equal(sectionForUf('DF'), 'est');
    assert.equal(sectionForUf('AM'), 'ovest');
  });

  it('range mono-UF → collection corretta', () => {
    const r = assignRange(1000000, 1999999);
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') {
      assert.equal(r.uf, 'SP');
      assert.equal(r.section, 'sud');
      assert.equal(r.collection, 'rates_sud');
    }
  });

  it('range cross-section SP(sud)+MG(est) flaggato', () => {
    // Non contiguo nella realtà (RJ/ES in mezzo) — usa PA(nord)+AM(ovest) se contiguous... 
    // PA 66000000-68899999 e AP 68900000-68999999 sono contiguous same? AP=nord, PA=nord → same section
    // AC(ovest) 69900000 e AM second tract ends 69899999 — contiguous cross? AM ovest, AC ovest
    // Escuriamo: range che attraversa RR(nord) e AM(ovest)
    const r = assignRange(69290000, 69310000);
    assert.equal(r.kind, 'cross_state');
    if (r.kind === 'cross_state') {
      assert.ok(r.sections.includes('nord'));
      assert.ok(r.sections.includes('ovest'));
    }
  });
});

describe('hash normalizzati', () => {
  const base = {
    from_zip: 1000000,
    to_zip: 1999999,
    destination: 'Sao Paulo',
    from_weight: 0,
    to_weight: 1,
    from_vol: 0,
    to_vol: 10,
    lead_time: 3,
    revenue: 12.5,
    Transporta: 'X',
    dhl_service_code: 'EXP',
  };

  it('key_hash stabile a spazi sul servizio', () => {
    const a = computeKeyHash(base);
    const b = computeKeyHash({ ...base, dhl_service_code: '  EXP  ' });
    assert.equal(a, b);
  });

  it('content_hash cambia se cambia revenue', () => {
    const a = computeContentHash(base);
    const b = computeContentHash({ ...base, revenue: 12.51 });
    assert.notEqual(a, b);
  });
});
