/**
 * Generate a sample CSV for local testing.
 * Usage: node scripts/generate-sample.js [rows] [outPath]
 * Example: node scripts/generate-sample.js 10000 sample.csv
 */
const fs = require('fs');
const path = require('path');

const rows = Number(process.argv[2] || 1000);
const outPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'sample.csv'));

const header = 'name,email,city,amount,status\n';
const stream = fs.createWriteStream(outPath);
stream.write(header);

const cities = ['Milan', 'Rome', 'Turin', 'Naples', 'Bologna', 'Florence'];
const statuses = ['open', 'closed', 'pending'];

for (let i = 0; i < rows; i++) {
  const name = `User_${i}`;
  const email = `user${i}@example.com`;
  const city = cities[i % cities.length];
  const amount = ((i * 17) % 10000) / 100;
  const status = statuses[i % statuses.length];
  stream.write(`${name},${email},${city},${amount.toFixed(2)},${status}\n`);
}

stream.end(() => {
  const size = fs.statSync(outPath).size;
  console.log(`Wrote ${rows} rows → ${outPath} (${(size / 1024).toFixed(1)} KB)`);
});
