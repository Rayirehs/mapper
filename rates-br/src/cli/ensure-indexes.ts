#!/usr/bin/env node
import { closeDb, getDb } from '../db/client.js';
import { ensureIndexes } from '../db/indexes.js';

async function main() {
  const db = await getDb();
  try {
    await ensureIndexes(db);
    console.log('Indici creati/verificati su rates_nord|sud|est|ovest e rates_versions');
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
