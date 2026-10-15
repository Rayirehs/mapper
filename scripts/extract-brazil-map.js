const fs = require('fs');
const path = require('path');

const src = process.argv[2] || 'c:/Users/user1/Downloads/Sezioni Tariffe Brasile.html';
const html = fs.readFileSync(src, 'utf8');
const i = html.indexOf('const STATES = ');
const j = html.indexOf('const DATA = ');
if (i < 0 || j < 0) {
  console.error('STATES/DATA not found');
  process.exit(1);
}
let slice = html.slice(i + 'const STATES = '.length, j).trim();
if (slice.endsWith(';')) slice = slice.slice(0, -1);
const states = JSON.parse(slice);
const out = path.join(__dirname, '..', 'src', 'renderer', 'brazil-states.json');
fs.writeFileSync(out, JSON.stringify(states));
console.log(`Wrote ${states.length} states → ${out} (${fs.statSync(out).size} bytes)`);
