# rates-br — Tariffe spedizione Brasile (4 collection MongoDB)

Modulo TypeScript/Node.js che importa in **streaming** un CSV di tariffe, assegna ogni riga a **stato (UF)** tramite fasce CEP, mappa l’UF a una **sezione di progetto** (`nord|sud|est|ovest`) e scrive su:

| Sezione | Collection |
|---------|------------|
| nord | `rates_nord` |
| sud | `rates_sud` |
| est | `rates_est` |
| ovest | `rates_ovest` |

Paese fisso: **BR**.

> La divisione in quattro sezioni **non** è quella IBGE (5 regioni): è una regola di progetto. La mappa è in `config/sections.json` e va **confermata dal tech lead** (`proposal_status: PENDING_TECH_LEAD_CONFIRMATION`).

---

## Prerequisiti

- Node.js ≥ 20
- MongoDB raggiungibile (`MONGODB_URI`, default `mongodb://127.0.0.1:27017`)
- Database default: `rates_br`

```bash
cd rates-br
npm install
```

---

## Configurazione

### `config/sections.json`

Mappa `UF → sezione` e nomi collection. Modificabile senza ricompilare la logica di business.

### `config/cep-ranges.json`

Fasce CEP numeriche (8 cifre, `01000-000` = `1000000`) per le 27 UF.

**Casi particolari modellati:**

- **DF**: `70000000–72799999` e `73000000–73699999`
- **GO**: `72800000–72999999` e `73700000–76799999`
- **AM**: `69000000–69299999` e `69400000–69899999` (**RR escluso**)
- **RR**: `69300000–69399999` (interno all’intervallo storico di AM)

### Fonti fasce CEP

1. Correios — [Busca Faixa CEP por UF/Localidade](https://buscacepinter.correios.com.br/app/faixa_cep_uf_localidade/index.php) (fonte ufficiale; richiede captcha, non scaricata live in questa sessione)
2. [Rua CEP — Faixa de CEP por estado](https://www.ruacep.com.br/guias/postais/faixa-de-cep-por-estado/) (DF/GO a due tratti, AM/RR)
3. [Bring — Faixas de CEP por estado e região](https://bring.com.br/suporte/?knowledgebase=faixas-de-cep-por-estado-e-regiao)
4. [OSINT Brazuca — regex CEP per UF](https://fellipematos.github.io/osint-brazuca-mkdocs/Regex/tab/)

---

## CSV di input

Colonne obbligatorie:

`from_zip,to_zip,destination,from_weight,to_weight,from_vol,to_vol,lead_time,revenue,Transporta,dhl_service_code`

- `from_zip` / `to_zip`: limiti inclusivi del range CEP (numerici; confermato come range).
- Servizio usato in `key_hash` e nella ricerca: **`dhl_service_code`**.

Sample: `samples/rates-sample.csv` (include una riga cross AM+RR e un gap 789xxxxx).

---

## Comandi

```bash
# Indici
npm run ensure-indexes

# Import streaming (bulkWrite unordered, batch 1000)
npm run import -- --file ./samples/rates-sample.csv

# Attiva versione SOLO dopo validazione ok
npm run activate -- --version <version_id>

# Ricerca: CEP → UF → sezione → collection → tariffa
npm run lookup -- --cep 01310100 --service EXP --weight 0.5

# Test (senza Mongo)
npm test
```

Env opzionali: `MONGODB_URI`, `MONGODB_DB`.

---

## Flusso importazione

1. Stream CSV (`csv-parse`, niente carico intero in RAM).
2. Per ogni riga: parse → `assignRange(from_zip,to_zip)` → UF + sezione.
3. Se il range attraversa **più UF o più sezioni** → **scartata**, finisce in `reports/cross_boundary_<version>.json` con **suggested_splits** (proposta: spezzare il range).
4. Documenti: `_id = sha256(version_id, key_hash)`, `key_hash`, `content_hash`, `uf`, `section`, `version_id`.
5. Upsert su `_id` → re-import dello stesso file/versione idempotente.
6. Validazione: overlap CEP+peso, buchi peso a parità di ZIP, revenue &lt; 0.
7. Versione resta `pending` finché non si esegue `activate`.

### Hash

- `key_hash` = SHA-256 di `dhl_service_code + from_zip + to_zip + from_weight + to_weight` (normalizzati)
- `content_hash` = SHA-256 di tutti i campi riga normalizzati
- Separatore interno: `\u0001`

### Indici (ogni `rates_*`)

- `(dhl_service_code, from_zip, to_zip, from_weight)`
- `(version_id)`
- compound lookup `(version_id, dhl_service_code, from_zip, to_zip, from_weight, to_weight)`

---

## Come sono calcolati i numeri del report

File: `reports/import_<version_id>.json`

| Campo | Formula |
|-------|---------|
| `totals.rows_read` | record CSV emessi dal parser (header escluso) |
| `totals.rows_written` | `nord+sud+est+ovest` (righe con `assignRange` ok) |
| `totals.rows_discarded` | `rows_read − rows_written` |
| `per_collection[X].percent_of_written` | `(rows_X / rows_written) × 100` |
| `per_collection[X].percent_of_read` | `(rows_X / rows_read) × 100` |
| `discarded_by_reason[R]` | conteggio incrementale per motivo di scarto |

Le stesse formule sono duplicate nel campo `formulas` del report JSON.

---

## Ricerca runtime

`findRate({ cep, service, weight })`:

1. Valida CEP (`validateDestinationCep`)
2. `ufForCep` → `sectionForUf` → nome collection
3. Query sulla **versione attiva**:  
   `from_zip ≤ cep ≤ to_zip` ∧ `from_weight ≤ weight ≤ to_weight` ∧ `dhl_service_code = service`

---

## Cosa non ho potuto verificare

1. **Fasce CEP live dai Correios** — il tool ufficiale richiede captcha; i range usati derivano da fonti secondarie allineate tra loro (Rua CEP / Bring / OSINT). **Riconfermare** sul sito Correios prima della produzione.
2. **Valuta di `revenue`** — non presente nel CSV; non inventata (BRL?). Confermare.
3. **Unità di `from_weight` / `to_weight` / volumi** — kg? g? non specificate.
4. **Significato di `Transporta` vs `dhl_service_code`** — per key/lookup uso `dhl_service_code`; se il servizio “vero” è un altro campo, dirlo.
5. **Gap 78900000–78999999** (tra MT e MS) e altri eventuali buchi — trattati come `cep_unknown`; verificare se esistono CEP assegnati lì.
6. **Contiguità fasce peso** — la validazione segnala gap se `cur.from_weight > prev.to_weight` a parità di ZIP esatto; non è noto se i range peso siano half-open `[from,to)` o closed `[from,to]`.
7. **Divisione sezioni** — proposta iniziale nel brief, in attesa conferma tech lead.
8. **Colonna `destination`** — salvata ma non usata per l’assegnazione geografica (solo CEP).

---

## Domande aperte (serve input)

- Confermi valuta e unità di misura?
- La mappa in `sections.json` è quella definitiva?
- In caso di cross-state: preferisci solo report, o uno script di auto-split + re-import?
