const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse');

const { filePath, storeDir, keyColumns: keyColumnsOpt } = workerData;

let cancelled = false;
parentPort.on('message', (msg) => {
  if (msg?.type === 'cancel') cancelled = true;
});

/** SHA-256 of values joined with a non-printable separator (stable, order-sensitive). */
function hashValues(values) {
  const h = crypto.createHash('sha256');
  for (let i = 0; i < values.length; i++) {
    if (i > 0) h.update('\u0001');
    h.update(values[i] == null ? '' : String(values[i]));
  }
  return h.digest('hex');
}

/**
 * key_hash  = identity (which row is it?) — default: first column only
 * content_hash = full payload (did values change?) — all columns
 * Pass workerData.keyColumns: string[] to override key columns by header name.
 */
function resolveKeyIndices(columns, keyColumns) {
  if (Array.isArray(keyColumns) && keyColumns.length > 0) {
    const indices = keyColumns
      .map((name) => columns.indexOf(name))
      .filter((i) => i >= 0);
    if (indices.length) return indices;
  }
  return columns.length ? [0] : [];
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function run() {
  const started = Date.now();
  const fileSize = fs.statSync(filePath).size;

  fs.mkdirSync(storeDir, { recursive: true });
  const metaPath = path.join(storeDir, 'meta.json');
  const dataPath = path.join(storeDir, 'rows.ndjson');
  const indexPath = path.join(storeDir, 'offsets.bin');

  for (const p of [metaPath, dataPath, indexPath]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const dataFd = fs.openSync(dataPath, 'w');
  const indexFd = fs.openSync(indexPath, 'w');

  let columns = null;
  let keyIndices = [];
  let rowIndex = 0;
  let bytesRead = 0;
  let byteOffset = 0;
  let lastEmit = 0;

  // Buffer writes — flush every ~1MB or 2000 rows
  let dataChunks = [];
  let dataChunkBytes = 0;
  let indexChunks = [];
  let indexChunkBytes = 0;

  const flushBuffers = () => {
    if (dataChunks.length) {
      fs.writeSync(dataFd, Buffer.concat(dataChunks, dataChunkBytes));
      dataChunks = [];
      dataChunkBytes = 0;
    }
    if (indexChunks.length) {
      fs.writeSync(indexFd, Buffer.concat(indexChunks, indexChunkBytes));
      indexChunks = [];
      indexChunkBytes = 0;
    }
  };

  parentPort.postMessage({
    type: 'started',
    fileSize,
    fileSizeLabel: formatBytes(fileSize),
  });

  try {
    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });

      input.on('data', (chunk) => {
        bytesRead += chunk.length;
      });

      const parser = parse({
        columns: false,
        relax_column_count: true,
        skip_empty_lines: true,
        bom: true,
        cast: false,
      });

      input.pipe(parser);

      parser.on('readable', () => {
        let record;
        while ((record = parser.read()) !== null) {
          if (cancelled) {
            parser.destroy();
            input.destroy();
            return;
          }

          if (!columns) {
            columns = record.map((c, i) => (c && String(c).trim()) || `col_${i + 1}`);
            keyIndices = resolveKeyIndices(columns, keyColumnsOpt);
            continue;
          }

          const normalized = columns.map((_, i) => (record[i] == null ? '' : String(record[i])));
          const keyValues = keyIndices.map((idx) => normalized[idx]);
          const key_hash = hashValues(keyValues);
          const content_hash = hashValues(normalized);
          const line =
            JSON.stringify({ i: rowIndex, kh: key_hash, ch: content_hash, d: normalized }) + '\n';
          const lineBuf = Buffer.from(line, 'utf8');

          const offsetBuf = Buffer.allocUnsafe(8);
          offsetBuf.writeBigUInt64LE(BigInt(byteOffset));

          dataChunks.push(lineBuf);
          dataChunkBytes += lineBuf.length;
          indexChunks.push(offsetBuf);
          indexChunkBytes += 8;

          byteOffset += lineBuf.length;
          rowIndex += 1;

          if (dataChunkBytes >= 1024 * 1024 || rowIndex % 2000 === 0) {
            flushBuffers();
          }

          const now = Date.now();
          if (now - lastEmit >= 250) {
            lastEmit = now;
            const elapsed = (now - started) / 1000;
            parentPort.postMessage({
              type: 'progress',
              rows: rowIndex,
              bytesRead,
              fileSize,
              percent: Math.min(99, (bytesRead / fileSize) * 100),
              rowsPerSec: elapsed > 0 ? Math.round(rowIndex / elapsed) : 0,
              elapsedMs: now - started,
            });
          }
        }
      });

      parser.on('error', reject);
      input.on('error', reject);
      parser.on('end', () => resolve());
      parser.on('close', () => {
        if (cancelled) resolve();
      });
    });

    flushBuffers();
    fs.closeSync(dataFd);
    fs.closeSync(indexFd);

    if (cancelled) {
      parentPort.postMessage({ type: 'cancelled' });
      return;
    }

    if (!columns) {
      parentPort.postMessage({ type: 'error', message: 'CSV appears empty or has no header' });
      return;
    }

    const keyColumns = keyIndices.map((idx) => columns[idx]);

    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        columns,
        keyColumns,
        rowCount: rowIndex,
        processedAt: new Date().toISOString(),
        sourceFile: path.basename(filePath),
      })
    );

    const elapsedMs = Date.now() - started;
    parentPort.postMessage({
      type: 'done',
      rows: rowIndex,
      columns,
      storeDir,
      elapsedMs,
      rowsPerSec: elapsedMs > 0 ? Math.round(rowIndex / (elapsedMs / 1000)) : 0,
    });
  } catch (err) {
    try {
      flushBuffers();
      fs.closeSync(dataFd);
      fs.closeSync(indexFd);
    } catch (_) {}
    parentPort.postMessage({ type: 'error', message: err.message || String(err) });
  }
}

run();
