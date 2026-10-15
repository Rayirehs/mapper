/**
 * Smoke test sync incrementale: due passate sullo stesso sample → 4 sezioni skip.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');

const sample = path.join(__dirname, '..', 'rates-br', 'samples', 'rates-sample.csv');
const stateDir = path.join(os.tmpdir(), `rates-sync-test-${Date.now()}`);

function runOnce() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'src', 'worker', 'ratesHeatmap.js'), {
      workerData: { filePath: sample, stateDir },
    });
    worker.on('message', (msg) => {
      if (msg.type === 'done') resolve(msg);
      if (msg.type === 'error') reject(new Error(msg.message));
    });
    worker.on('error', reject);
  });
}

(async () => {
  if (!fs.existsSync(sample)) {
    console.error('Sample missing:', sample);
    process.exit(1);
  }

  console.log('Pass 1 (first import)…');
  const first = await runOnce();
  console.log(
    '  updated=',
    first.syncSummary.updated_sections,
    'skipped=',
    first.syncSummary.skipped_sections,
    'mapped=',
    first.mapped
  );

  console.log('Pass 2 (same file → expect 4 skip)…');
  const second = await runOnce();
  console.log(
    '  updated=',
    second.syncSummary.updated_sections,
    'skipped=',
    second.syncSummary.skipped_sections
  );

  const ok =
    second.syncSummary.skipped_sections === 4 &&
    second.syncSummary.updated_sections === 0 &&
    second.syncSummary.totals.added === 0 &&
    second.syncSummary.totals.changed === 0 &&
    second.syncSummary.totals.removed === 0;

  console.log(ok ? 'OK' : 'FAIL');
  fs.rmSync(stateDir, { recursive: true, force: true });
  process.exit(ok ? 0 : 2);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
