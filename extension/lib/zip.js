// Minimal ZIP writer (STORE method, no compression).
// window.makeZip(files) -> Blob   where files = { "path": "string content" | Uint8Array }

(function () {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    return new TextEncoder().encode(String(data));
  }

  // DOS date/time for a fixed timestamp.
  function dosDateTime(d) {
    const date =
      (((d.getFullYear() - 1980) & 0x7f) << 9) |
      ((d.getMonth() + 1) << 5) |
      d.getDate();
    const time =
      (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    return { date, time };
  }

  function makeZip(files) {
    const now = new Date();
    const { date, time } = dosDateTime(now);
    const entries = [];
    const chunks = [];
    let offset = 0;

    for (const name of Object.keys(files)) {
      const nameBytes = new TextEncoder().encode(name);
      const dataBytes = toBytes(files[name]);
      const crc = crc32(dataBytes);

      // Local file header
      const lh = new ArrayBuffer(30);
      const lv = new DataView(lh);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0x0800, true); // flags: UTF-8 names
      lv.setUint16(8, 0, true); // method: store
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);

      chunks.push(new Uint8Array(lh), nameBytes, dataBytes);

      entries.push({
        nameBytes,
        crc,
        size: dataBytes.length,
        offset
      });

      offset += 30 + nameBytes.length + dataBytes.length;
    }

    // Central directory
    const centralChunks = [];
    let centralSize = 0;
    for (const e of entries) {
      const ch = new ArrayBuffer(46);
      const cv = new DataView(ch);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); // version made by
      cv.setUint16(6, 20, true); // version needed
      cv.setUint16(8, 0x0800, true); // flags
      cv.setUint16(10, 0, true); // method
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, e.crc, true);
      cv.setUint32(20, e.size, true);
      cv.setUint32(24, e.size, true);
      cv.setUint16(28, e.nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, e.offset, true);

      centralChunks.push(new Uint8Array(ch), e.nameBytes);
      centralSize += 46 + e.nameBytes.length;
    }

    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(
      [...chunks, ...centralChunks, new Uint8Array(eocd)],
      { type: "application/zip" }
    );
  }

  /* ------------------------------ reader ------------------------------ */

  // Minimal ZIP reader. Handles STORE (method 0) directly — which is all
  // makeZip() ever writes — and DEFLATE (method 8) when the browser exposes
  // DecompressionStream. Returns { "path": Uint8Array }.
  // An optional `want(name)` predicate skips extracting entries it rejects
  // (their value is set to null) — handy to avoid pulling large binaries.
  // window.readZip(arrayBuffer, want?) -> Promise<{ path: Uint8Array | null }>
  async function readZip(buf, want) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Locate the End Of Central Directory record (scan back from the end).
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("not a zip file");

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};

    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

      // The local header repeats name/extra with its own lengths.
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = bytes.subarray(dataStart, dataStart + compSize);

      if (typeof want === "function" && !want(name)) {
        out[name] = null;
      } else if (method === 0) {
        out[name] = comp.slice();
      } else if (method === 8 && typeof DecompressionStream === "function") {
        const ds = new DecompressionStream("deflate-raw");
        const ab = await new Response(new Blob([comp]).stream().pipeThrough(ds)).arrayBuffer();
        out[name] = new Uint8Array(ab);
      } else {
        out[name] = null; // compressed with an unsupported method
      }

      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  window.makeZip = makeZip;
  window.readZip = readZip;
})();
