/**
 * Minimal, dependency-free ZIP writer (STORE method — no compression).
 *
 * The server has no archiver/adm-zip dependency, and JSON/CSV compress poorly
 * anyway, so a stored (uncompressed) archive is the simplest reliable option.
 * Produces a standard .zip Buffer that browsers and OS tools open natively.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// Fixed 1980-01-01 00:00:00 DOS timestamp (Date.now() is intentionally avoided).
const DOS_TIME = 0;
const DOS_DATE = 0x21;
const UTF8_FLAG = 0x0800;

/**
 * @param {Array<{name: string, data: Buffer|string}>} entries
 * @returns {Buffer}
 */
function buildZip(entries) {
  const files = entries.map((e) => {
    const nameBuf = Buffer.from(String(e.name).replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data ?? ''), 'utf8');
    return { nameBuf, data, crc: crc32(data), size: data.length };
  });

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(UTF8_FLAG, 6);    // general purpose flag (UTF-8 names)
    local.writeUInt16LE(0, 8);            // compression: store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(f.crc, 14);
    local.writeUInt32LE(f.size, 18);      // compressed size
    local.writeUInt32LE(f.size, 22);      // uncompressed size
    local.writeUInt16LE(f.nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length

    chunks.push(local, f.nameBuf, f.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // central directory signature
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(UTF8_FLAG, 8);
    cd.writeUInt16LE(0, 10);              // compression: store
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(f.crc, 16);
    cd.writeUInt32LE(f.size, 20);
    cd.writeUInt32LE(f.size, 24);
    cd.writeUInt16LE(f.nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);              // extra length
    cd.writeUInt16LE(0, 32);              // comment length
    cd.writeUInt16LE(0, 34);              // disk number start
    cd.writeUInt16LE(0, 36);              // internal attributes
    cd.writeUInt32LE(0, 38);              // external attributes
    cd.writeUInt32LE(offset, 42);         // local header offset
    central.push(Buffer.concat([cd, f.nameBuf]));

    offset += local.length + f.nameBuf.length + f.data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);      // end of central directory signature
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // disk with central dir
  eocd.writeUInt16LE(files.length, 8);    // entries this disk
  eocd.writeUInt16LE(files.length, 10);   // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);         // central dir offset
  eocd.writeUInt16LE(0, 20);              // comment length

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

module.exports = { buildZip, crc32 };
