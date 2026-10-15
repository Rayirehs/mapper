#!/usr/bin/env node
import { closeDb, getDb } from '../db/client.js';
import { activateVersion, getActiveVersionId } from '../db/versions.js';
import { validateVersion } from '../import/validateVersion.js';
import { saveValidation } from '../db/versions.js';

function usage(): never {
  console.error(`Uso:
  npm run activate -- --version <version_id> [--revalidate]
`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  let versionId: string | undefined;
  let revalidate = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version') versionId = args[++i];
    else if (args[i] === '--revalidate') revalidate = true;
    else if (args[i] === '--help') usage();
  }
  if (!versionId) usage();

  const db = await getDb();
  try {
    if (revalidate) {
      const v = await validateVersion(db, versionId!);
      await saveValidation(db, versionId!, v);
      if (!v.ok) {
        console.error('Re-validazione fallita:', v.issues.slice(0, 20));
        process.exit(2);
      }
    }
    await activateVersion(db, versionId!);
    const active = await getActiveVersionId(db);
    console.log(JSON.stringify({ activated: versionId, active }, null, 2));
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
