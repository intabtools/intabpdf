// Lightweight, pure TypeScript zero-dependency ZIP archive creator (PKZIP Stored / Method 0).

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

// Pre-computed CRC32 lookup table using IEEE 802.3 standard polynomial 0xEDB88320
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

/**
 * Calculates the standard 32-bit CRC checksum for a byte array.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Packages multiple byte buffers into a valid, universally compatible ZIP archive.
 * Uses storage method 0 (uncompressed), requiring zero third-party dependencies.
 */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const fileRecords: {
    nameBytes: Uint8Array;
    bytes: Uint8Array;
    crc: number;
    offset: number;
  }[] = [];

  let totalSize = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    fileRecords.push({
      nameBytes,
      bytes: entry.bytes,
      crc: crc32(entry.bytes),
      offset: 0,
    });
    totalSize += 30 + nameBytes.length + entry.bytes.length;
  }

  const centralDirStartOffset = totalSize;
  let centralDirSize = 0;
  for (const record of fileRecords) {
    centralDirSize += 46 + record.nameBytes.length;
  }
  totalSize += centralDirSize + 22;

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let pos = 0;

  // 1. Write Local File Headers and Data
  for (const record of fileRecords) {
    record.offset = pos;

    view.setUint32(pos, 0x04034b50, true); pos += 4; // local header signature
    view.setUint16(pos, 20, true); pos += 2;         // version needed: 2.0
    view.setUint16(pos, 0x0800, true); pos += 2;     // flag: UTF-8 filename
    view.setUint16(pos, 0, true); pos += 2;          // method: 0 (store)
    view.setUint16(pos, 0, true); pos += 2;          // mod time
    view.setUint16(pos, 0, true); pos += 2;          // mod date
    view.setUint32(pos, record.crc, true); pos += 4; // crc-32
    view.setUint32(pos, record.bytes.length, true); pos += 4; // compressed size
    view.setUint32(pos, record.bytes.length, true); pos += 4; // uncompressed size
    view.setUint16(pos, record.nameBytes.length, true); pos += 2; // name length
    view.setUint16(pos, 0, true); pos += 2;          // extra length
    out.set(record.nameBytes, pos); pos += record.nameBytes.length;
    out.set(record.bytes, pos); pos += record.bytes.length;
  }

  // 2. Write Central Directory Headers
  for (const record of fileRecords) {
    view.setUint32(pos, 0x02014b50, true); pos += 4; // central header signature
    view.setUint16(pos, 20, true); pos += 2;         // version made by
    view.setUint16(pos, 20, true); pos += 2;         // version needed
    view.setUint16(pos, 0x0800, true); pos += 2;     // flag: UTF-8
    view.setUint16(pos, 0, true); pos += 2;          // method: 0 (store)
    view.setUint16(pos, 0, true); pos += 2;          // mod time
    view.setUint16(pos, 0, true); pos += 2;          // mod date
    view.setUint32(pos, record.crc, true); pos += 4; // crc-32
    view.setUint32(pos, record.bytes.length, true); pos += 4; // compressed size
    view.setUint32(pos, record.bytes.length, true); pos += 4; // uncompressed size
    view.setUint16(pos, record.nameBytes.length, true); pos += 2; // name length
    view.setUint16(pos, 0, true); pos += 2;          // extra length
    view.setUint16(pos, 0, true); pos += 2;          // comment length
    view.setUint16(pos, 0, true); pos += 2;          // disk number start
    view.setUint16(pos, 0, true); pos += 2;          // internal file attributes
    view.setUint32(pos, 0, true); pos += 4;          // external file attributes
    view.setUint32(pos, record.offset, true); pos += 4; // relative offset of local header
    out.set(record.nameBytes, pos); pos += record.nameBytes.length;
  }

  // 3. Write End of Central Directory Record
  view.setUint32(pos, 0x06054b50, true); pos += 4; // end of central dir signature
  view.setUint16(pos, 0, true); pos += 2;          // disk number
  view.setUint16(pos, 0, true); pos += 2;          // disk with central dir
  view.setUint16(pos, entries.length, true); pos += 2; // entries on this disk
  view.setUint16(pos, entries.length, true); pos += 2; // total entries
  view.setUint32(pos, centralDirSize, true); pos += 4; // size of central dir
  view.setUint32(pos, centralDirStartOffset, true); pos += 4; // offset of central dir
  view.setUint16(pos, 0, true); // zip comment length

  return out;
}
