import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import { assignRange, loadSectionsConfig } from '../cep/lookup.js';
import { computeContentHash, computeKeyHash, documentId } from '../hash.js';
import { ensureIndexes } from '../db/indexes.js';
import { registerVersion, saveValidation } from '../db/versions.js';
import type {
  DiscardedRow,
  ImportReport,
  RateDocument,
  Section,
} from '../types.js';
import { assertHeaders, parseRateRow } from './parseRow.js';
import { validateVersion } from './validateVersion.js';

const DEFAULT_BATCH = 1000;
const DISCARD_SAMPLE_LIMIT = 200;

export interface ImportOptions {
  filePath: string;
  db: Db;
  versionId?: string;
  batchSize?: number;
  reportDir?: string;
  /** Se true, esegue validateVersion a fine import (non attiva). */
  validate?: boolean;
}

export async function streamImportRates(opts: ImportOptions): Promise<ImportReport> {
  const versionId = opts.versionId ?? `v_${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const reportDir = opts.reportDir ?? resolve(process.cwd(), 'reports');
  const started_at = new Date().toISOString();

  await ensureIndexes(opts.db);

  let rows_read = 0;
  let rows_written = 0;
  const perSectionCount: Record<Section, number> = {
    nord: 0,
    sud: 0,
    est: 0,
    ovest: 0,
  };
  const discarded_by_reason: Record<string, number> = {};
  const discarded_sample: DiscardedRow[] = [];
  const cross_boundary: DiscardedRow[] = [];

  const buffers = new Map<string, AnyBulkWriteOperation<RateDocument>[]>();

  const bumpDiscard = (d: DiscardedRow) => {
    discarded_by_reason[d.reason] = (discarded_by_reason[d.reason] ?? 0) + 1;
    if (discarded_sample.length < DISCARD_SAMPLE_LIMIT) discarded_sample.push(d);
    if (d.reason === 'cross_state' || d.reason === 'cross_section') {
      cross_boundary.push(d);
    }
  };

  const flushCollection = async (collectionName: string) => {
    const ops = buffers.get(collectionName);
    if (!ops?.length) return;
    buffers.set(collectionName, []);
    await opts.db.collection<RateDocument>(collectionName).bulkWrite(ops, {
      ordered: false,
    });
  };

  const flushAll = async () => {
    for (const name of buffers.keys()) {
      await flushCollection(name);
    }
  };

  await new Promise<void>((resolvePromise, reject) => {
    const parser = parse({
      columns: true,
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    });

    let headersChecked = false;
    let chain: Promise<void> = Promise.resolve();

    const input = createReadStream(opts.filePath, { highWaterMark: 1024 * 1024 });

    parser.on('data', (record: Record<string, string>) => {
      parser.pause();
      chain = chain
        .then(async () => {
          if (!headersChecked) {
            headersChecked = true;
            const missing = assertHeaders(Object.keys(record));
            if (missing.length) {
              bumpDiscard({
                row: 1,
                reason: 'missing_columns',
                detail: `Colonne mancanti: ${missing.join(', ')}`,
              });
              throw new Error(`CSV senza colonne obbligatorie: ${missing.join(', ')}`);
            }
          }

          rows_read += 1;
          const rowNum = rows_read + 1; // 1-based inclusivo header → prima data = 2

          const parsed = parseRateRow(record);
          if (!parsed.ok) {
            bumpDiscard({
              row: rowNum,
              reason: parsed.reason,
              detail: parsed.detail,
            });
            return;
          }

          const assignment = assignRange(parsed.row.from_zip, parsed.row.to_zip);
          if (assignment.kind !== 'ok') {
            const d: DiscardedRow = {
              row: rowNum,
              reason: assignment.kind,
              detail:
                assignment.detail +
                (assignment.suggested_splits.length
                  ? ` | splits: ${JSON.stringify(assignment.suggested_splits)}`
                  : ''),
              from_zip: parsed.row.from_zip,
              to_zip: parsed.row.to_zip,
              ufs: assignment.ufs,
              sections: assignment.sections,
            };
            bumpDiscard(d);
            return;
          }

          const key_hash = computeKeyHash(parsed.row);
          const content_hash = computeContentHash(parsed.row);
          const _id = documentId(versionId, key_hash);

          const doc: RateDocument = {
            _id,
            ...parsed.row,
            key_hash,
            content_hash,
            uf: assignment.uf,
            section: assignment.section,
            version_id: versionId,
            source_row: rowNum,
            country: 'BR',
            imported_at: new Date(),
          };

          const colName = assignment.collection;
          const ops = buffers.get(colName) ?? [];
          ops.push({
            replaceOne: {
              filter: { _id },
              replacement: doc,
              upsert: true,
            },
          });
          buffers.set(colName, ops);
          perSectionCount[assignment.section] += 1;

          if (ops.length >= batchSize) {
            await flushCollection(colName);
          }
        })
        .then(() => {
          parser.resume();
        })
        .catch((err) => {
          reject(err);
        });
    });

    parser.on('error', reject);
    input.on('error', reject);
    parser.on('end', () => {
      chain
        .then(() => flushAll())
        .then(() => resolvePromise())
        .catch(reject);
    });

    input.pipe(parser);
  });

  const logicalWritten =
    perSectionCount.nord + perSectionCount.sud + perSectionCount.est + perSectionCount.ovest;
  rows_written = logicalWritten;
  const rows_discarded = rows_read - logicalWritten;

  const collMap = loadSectionsConfig()._meta.collections;

  const per_collection: ImportReport['per_collection'] = {};
  for (const section of Object.keys(perSectionCount) as Section[]) {
    const rows = perSectionCount[section];
    const name = collMap[section];
    per_collection[name] = {
      rows,
      percent_of_written: logicalWritten
        ? Number(((rows / logicalWritten) * 100).toFixed(4))
        : 0,
      percent_of_read: rows_read
        ? Number(((rows / rows_read) * 100).toFixed(4))
        : 0,
    };
  }

  let validation = null;
  if (opts.validate !== false) {
    validation = await validateVersion(opts.db, versionId);
    await saveValidation(opts.db, versionId, validation);
  }

  const finished_at = new Date().toISOString();
  const report: ImportReport = {
    version_id: versionId,
    started_at,
    finished_at,
    file: resolve(opts.filePath),
    totals: {
      rows_read,
      rows_written: logicalWritten,
      rows_discarded,
    },
    per_collection,
    discarded_by_reason,
    discarded_sample,
    cross_boundary,
    validation,
    formulas: {
      rows_read: 'conteggio record CSV (header escluso) emessi dal parser',
      rows_written:
        'somma perSectionCount[nord|sud|est|ovest] = righe con assignRange ok e upsert accodato',
      rows_discarded: 'rows_read - rows_written',
      percent_of_written: '(rows_collection / rows_written) * 100',
      percent_of_read: '(rows_collection / rows_read) * 100',
      discarded_by_reason: 'conteggio incrementale per DiscardReason su ogni bumpDiscard',
      bulkWrite_note:
        `bulkWrite ordered:false a lotti di ${batchSize}; upsert su _id=sha256(version_id,key_hash). ` +
        `Il campo Mongo matched/modified/upserted non è usato nel report percentuale.`,
    },
  };

  mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, `import_${versionId}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  // anche report solo cross-boundary
  writeFileSync(
    resolve(reportDir, `cross_boundary_${versionId}.json`),
    JSON.stringify(
      {
        version_id: versionId,
        count: cross_boundary.length,
        proposal:
          'Spezzare ogni range nei suggested_splits (un documento per sotto-range UF/sezione omogeneo) e re-importare.',
        rows: cross_boundary,
      },
      null,
      2,
    ),
    'utf8',
  );

  await registerVersion(opts.db, versionId, reportPath);

  return report;
}
