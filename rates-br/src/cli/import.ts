#!/usr/bin/env node
import { resolve } from 'node:path';
import { closeDb, getDb } from '../db/client.js';
import { streamImportRates } from '../import/streamImport.js';

function usage(): never {
  console.error(`Uso:
  npm run import -- --file <path.csv> [--version <id>] [--batch 1000] [--no-validate]

Env:
  MONGODB_URI   (default mongodb://127.0.0.1:27017)
  MONGODB_DB    (default rates_br)
`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  let file: string | undefined;
  let versionId: string | undefined;
  let batchSize = 1000;
  let validate = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--file') file = args[++i];
    else if (a === '--version') versionId = args[++i];
    else if (a === '--batch') batchSize = Number(args[++i]);
    else if (a === '--no-validate') validate = false;
    else if (a === '--help') usage();
  }

  if (!file) usage();

  const db = await getDb();
  try {
    const report = await streamImportRates({
      filePath: resolve(file!),
      db,
      versionId,
      batchSize,
      validate,
    });
    console.log(JSON.stringify({
      version_id: report.version_id,
      totals: report.totals,
      per_collection: report.per_collection,
      discarded_by_reason: report.discarded_by_reason,
      cross_boundary_count: report.cross_boundary.length,
      validation_ok: report.validation?.ok ?? null,
      validation_issues: report.validation?.issues.length ?? 0,
    }, null, 2));
    console.error(`Report completo in reports/import_${report.version_id}.json`);
    if (report.validation && !report.validation.ok) {
      console.error('Validazione FALLITA — versione NON attivata. Correggere e rieseguire o activate solo se ok.');
      process.exitCode = 2;
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
