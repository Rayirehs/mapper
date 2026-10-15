import type { Db, Collection } from 'mongodb';
import { loadSectionsConfig } from '../cep/lookup.js';
import type { RateDocument, Section, VersionMeta } from '../types.js';

export const VERSIONS_COLLECTION = 'rates_versions';
export const ACTIVE_META_COLLECTION = 'rates_active';

export function rateCollectionName(section: Section): string {
  return loadSectionsConfig()._meta.collections[section];
}

export function allRateCollectionNames(): string[] {
  return Object.values(loadSectionsConfig()._meta.collections);
}

export function ratesCollection(db: Db, section: Section): Collection<RateDocument> {
  return db.collection<RateDocument>(rateCollectionName(section));
}

export function versionsCollection(db: Db): Collection<VersionMeta> {
  return db.collection<VersionMeta>(VERSIONS_COLLECTION);
}

export interface ActivePointer {
  _id: 'current';
  version_id: string;
  activated_at: Date;
}

export function activeCollection(db: Db): Collection<ActivePointer> {
  return db.collection<ActivePointer>(ACTIVE_META_COLLECTION);
}
