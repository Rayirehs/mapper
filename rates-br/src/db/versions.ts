import type { Db } from 'mongodb';
import type { ValidationReport, VersionMeta } from '../types.js';
import { activeCollection, versionsCollection } from './collections.js';

export async function registerVersion(
  db: Db,
  versionId: string,
  importReportPath?: string,
): Promise<void> {
  const doc: VersionMeta = {
    _id: versionId,
    version_id: versionId,
    status: 'pending',
    created_at: new Date(),
    import_report_path: importReportPath,
  };
  await versionsCollection(db).replaceOne({ _id: versionId }, doc, { upsert: true });
}

export async function saveValidation(
  db: Db,
  versionId: string,
  validation: ValidationReport,
): Promise<void> {
  await versionsCollection(db).updateOne(
    { version_id: versionId },
    {
      $set: {
        validation,
        status: validation.ok ? 'pending' : 'rejected',
      },
    },
  );
}

/**
 * Attiva una versione solo se la validazione è ok.
 * La versione precedente attiva diventa superseded.
 */
export async function activateVersion(db: Db, versionId: string): Promise<void> {
  const meta = await versionsCollection(db).findOne({ version_id: versionId });
  if (!meta) throw new Error(`Versione non trovata: ${versionId}`);
  if (meta.validation && !meta.validation.ok) {
    throw new Error(`Versione ${versionId} ha fallito la validazione — non attivabile`);
  }
  if (meta.status === 'rejected') {
    throw new Error(`Versione ${versionId} è rejected`);
  }

  const prev = await activeCollection(db).findOne({ _id: 'current' });
  if (prev?.version_id && prev.version_id !== versionId) {
    await versionsCollection(db).updateOne(
      { version_id: prev.version_id },
      { $set: { status: 'superseded' } },
    );
  }

  const now = new Date();
  await versionsCollection(db).updateOne(
    { version_id: versionId },
    { $set: { status: 'active', activated_at: now } },
  );
  await activeCollection(db).replaceOne(
    { _id: 'current' },
    { _id: 'current', version_id: versionId, activated_at: now },
    { upsert: true },
  );
}

export async function getActiveVersionId(db: Db): Promise<string | null> {
  const cur = await activeCollection(db).findOne({ _id: 'current' });
  return cur?.version_id ?? null;
}
