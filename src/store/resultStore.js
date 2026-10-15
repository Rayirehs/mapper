const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Indexed NDJSON store for millions of rows without loading them into RAM.
 * offsets.bin: little-endian uint64 byte offsets into rows.ndjson
 */
class ResultStore {
  constructor(storeDir) {
    this.storeDir = storeDir;
    this.metaPath = path.join(storeDir, 'meta.json');
    this.dataPath = path.join(storeDir, 'rows.ndjson');
    this.indexPath = path.join(storeDir, 'offsets.bin');
    this.meta = null;
    this.indexFd = null;
  }

  open() {
    if (!fs.existsSync(this.metaPath)) {
      throw new Error('No result store found');
    }
    this.meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf8'));
    this.indexFd = fs.openSync(this.indexPath, 'r');
    return this;
  }

  close() {
    if (this.indexFd != null) {
      fs.closeSync(this.indexFd);
      this.indexFd = null;
    }
  }

  get columns() {
    return this.meta?.columns || [];
  }

  get total() {
    return this.meta?.rowCount || 0;
  }

  getOffset(rowIndex) {
    const buf = Buffer.allocUnsafe(8);
    fs.readSync(this.indexFd, buf, 0, 8, rowIndex * 8);
    return Number(buf.readBigUInt64LE(0));
  }

  getPage(offset = 0, limit = 100) {
    const total = this.total;
    if (total === 0 || offset >= total) {
      return { rows: [], total, columns: this.columns };
    }

    const end = Math.min(offset + limit, total);
    const startByte = this.getOffset(offset);
    let endByte;
    if (end < total) {
      endByte = this.getOffset(end);
    } else {
      endByte = fs.statSync(this.dataPath).size;
    }

    const length = endByte - startByte;
    const buf = Buffer.allocUnsafe(length);
    const fd = fs.openSync(this.dataPath, 'r');
    try {
      fs.readSync(fd, buf, 0, length, startByte);
    } finally {
      fs.closeSync(fd);
    }

    const text = buf.toString('utf8');
    const lines = text.split('\n').filter(Boolean);
    const rows = lines.map((line) => {
      const obj = JSON.parse(line);
      const data = {};
      const cols = this.columns;
      for (let i = 0; i < cols.length; i++) {
        data[cols[i]] = obj.d[i] ?? '';
      }
      return {
        index: obj.i,
        key_hash: obj.kh,
        content_hash: obj.ch,
        data,
      };
    });

    return { rows, total, columns: this.columns };
  }

  async exportCsv(outPath, onProgress) {
    const columns = this.columns;
    const total = this.total;
    const out = fs.createWriteStream(outPath, { encoding: 'utf8' });

    const escape = (value) => {
      const s = value == null ? '' : String(value);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    out.write(['key_hash', 'content_hash', ...columns].map(escape).join(',') + '\n');

    const input = fs.createReadStream(this.dataPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    let written = 0;
    let lastEmit = 0;

    for await (const line of rl) {
      if (!line) continue;
      const obj = JSON.parse(line);
      const cells = [obj.kh, obj.ch, ...(obj.d || [])];
      // Ensure column count
      while (cells.length < 2 + columns.length) cells.push('');
      out.write(cells.slice(0, 2 + columns.length).map(escape).join(',') + '\n');
      written += 1;

      const now = Date.now();
      if (onProgress && now - lastEmit >= 300) {
        lastEmit = now;
        onProgress({ rows: written, total, percent: total ? (written / total) * 100 : 0 });
      }
    }

    await new Promise((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()));
    });

    return { rows: written, path: outPath };
  }
}

module.exports = { ResultStore };
