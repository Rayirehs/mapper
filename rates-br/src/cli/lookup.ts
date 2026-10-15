#!/usr/bin/env node
import { closeDb, getDb } from '../db/client.js';
import { findRate } from '../lookup/findRate.js';

function usage(): never {
  console.error(`Uso:
  npm run lookup -- --cep <CEP> --service <code> --weight <n> [--version <id>]
`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  let cep: string | undefined;
  let service: string | undefined;
  let weight: number | undefined;
  let versionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--cep') cep = args[++i];
    else if (a === '--service') service = args[++i];
    else if (a === '--weight') weight = Number(args[++i]);
    else if (a === '--version') versionId = args[++i];
    else if (a === '--help') usage();
  }

  if (!cep || !service || weight == null) usage();

  const db = await getDb();
  try {
    const result = await findRate(db, {
      cep: cep!,
      service: service!,
      weight: weight!,
      versionId,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
