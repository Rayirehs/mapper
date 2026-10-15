# CSV Mapper

App desktop Windows (Electron + Node.js) che elabora CSV fino a **2 GB** / milioni di righe: per ogni riga genera due SHA-256 — **`key_hash`** (identità) e **`content_hash`** (payload).

## Avvio (dev)

```bash
npm install
npm start
```

CSV di prova (es. 10.000 righe):

```bash
npm run sample -- 10000
```

## Build Windows (portable + installer)

```bash
npm install
npm run dist
```

Output in `dist/`:

| File | Tipo |
|------|------|
| `CSV Mapper-Setup-1.0.0.exe` | Installer (NSIS, scegli cartella) |
| `CSV Mapper-Portable-1.0.0.exe` | Portable (nessuna installazione) |

Solo installer: `npm run dist:installer`  
Solo portable: `npm run dist:portable`

## Uso

### CSV Mapper
1. **Browse** / zona drop → seleziona il CSV (prima riga = header)
2. **Process** → streaming + `key_hash` / `content_hash`
3. Tabella paginata con output formattato
4. **Export CSV** → `key_hash`, `content_hash` + colonne originali

Per default la chiave è la **prima colonna**; le altre colonne entrano solo nel content hash (utile per capire se la riga è presente, cambiata o eliminata).

### Tariffe BR (heatmap + sync incrementale)
1. Tab **Tariffe BR** nella topbar
2. Carica un CSV tariffe (anche ~1 GB / milioni di righe)
3. **Carica & sync** → streaming CEP → UF → **nord / sud / est / ovest**
4. Ogni sezione ha un `section_hash`. Al prossimo upload:
   - hash uguale → **skip** (nessun update)
   - hash diverso → diff con `key_hash` / `content_hash` → **added / changed / removed**
5. Heatmap UF + report sync; **Apri stato** apre la cartella con CSV per sezione (hash inclusi)

Sample: `rates-br/samples/rates-sample.csv`

## Architettura (file grandi)

| Pezzo | Ruolo |
|--------|--------|
| Worker stream (`csv-parse`) | Legge il file a chunk, senza caricarlo in RAM |
| Store NDJSON + `offsets.bin` | Indice a 64-bit per paginare milioni di righe |
| Renderer | UI desktop (tema Stitch: teal / Space Grotesk) |

Limite soft: **2 GB** sul file di input.

## Stitch

Progetto Google Stitch: **CSV Mapper** (`projects/6873630621822429262`) con design system *CSV Mapper Teal*. La UI in `src/renderer` segue quel brief (sidebar, tabella, status bar).

## Tariffe Brasile

- **UI Electron**: tab Tariffe BR → heatmap locale (senza Mongo obbligatorio)
- **Backend Mongo** (CLI): [`rates-br/`](./rates-br) — import → `rates_nord|sud|est|ovest`, versioning, lookup. Vedi [`rates-br/README.md`](./rates-br/README.md).
