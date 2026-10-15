import type { Db } from 'mongodb';
import { allRateCollectionNames, VERSIONS_COLLECTION } from './collections.js';

/**
 * Indici richiesti su ogni collection tariffe:
 * - (dhl_service_code, from_zip, to_zip, from_weight) — lookup
 * - (version_id)
 */
export async function ensureIndexes(db: Db): Promise<void> {
  for (const name of allRateCollectionNames()) {
    const col = db.collection(name);
    await col.createIndex(
      {
        dhl_service_code: 1,
        from_zip: 1,
        to_zip: 1,
        from_weight: 1,
      },
      { name: 'svc_zip_weight' },
    );
    await col.createIndex({ version_id: 1 }, { name: 'version_id' });
    // Supporto query peso inclusivo + CEP
    await col.createIndex(
      {
        version_id: 1,
        dhl_service_code: 1,
        from_zip: 1,
        to_zip: 1,
        from_weight: 1,
        to_weight: 1,
      },
      { name: 'lookup_active' },
    );
  }

  await db.collection(VERSIONS_COLLECTION).createIndex(
    { version_id: 1 },
    { unique: true, name: 'version_id_unique' },
  );
}
