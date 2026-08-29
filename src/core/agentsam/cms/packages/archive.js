/**
 * Shopify theme archive extraction (tar.gz / zip) — Workers-native, no npm deps.
 */

/**
 * @param {ArrayBuffer} buf
 * @returns {Promise<ArrayBuffer>}
 */
export async function gunzipArrayBuffer(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  const out = await new Response(stream).arrayBuffer();
  return out;
}

/**
 * @param {Uint8Array} data
 * @returns {Array<{ path: string, content: Uint8Array }>}
 */
export function extractTarEntries(data) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const nameRaw = textFromBytes(header.subarray(0, 100)).replace(/\0+$/, '');
    const prefix = textFromBytes(header.subarray(345, 500)).replace(/\0+$/, '');
    const path = prefix ? `${prefix}/${nameRaw}` : nameRaw;
    const sizeOct = textFromBytes(header.subarray(124, 136)).replace(/\0+$/, '').trim();
    const typeFlag = String.fromCharCode(header[156] || 0);
    const size = parseInt(sizeOct, 8) || 0;
    offset += 512;
    if (!path || path === './' || path === '.') {
      offset += Math.ceil(size / 512) * 512;
      continue;
    }
    if (typeFlag === '5' || typeFlag === 'g') {
      offset += Math.ceil(size / 512) * 512;
      continue;
    }
    const content = data.subarray(offset, offset + size);
    entries.push({ path: path.replace(/^\.\//, ''), content });
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

/**
 * Minimal ZIP reader (Shopify theme .zip exports — store + deflate).
 * @param {Uint8Array} data
 * @returns {Promise<Array<{ path: string, content: Uint8Array }>>}
 */
export async function extractZipEntries(data) {
  const entries = [];
  let i = 0;
  while (i + 30 < data.length) {
    if (data[i] !== 0x50 || data[i + 1] !== 0x4b) break;
    const method = data[i + 8] | (data[i + 9] << 8);
    const compSize =
      (data[i + 18] | (data[i + 19] << 8) | (data[i + 20] << 16) | (data[i + 21] << 24)) >>> 0;
    const nameLen = data[i + 26] | (data[i + 27] << 8);
    const extraLen = data[i + 28] | (data[i + 29] << 8);
    const nameStart = i + 30;
    const name = textFromBytes(data.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    if (!name || name.endsWith('/')) {
      i = dataStart + compSize;
      continue;
    }
    const compressed = data.subarray(dataStart, dataStart + compSize);
    let content = compressed;
    if (method === 0) {
      content = compressed;
    } else if (method === 8) {
      try {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        content = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        i = dataStart + compSize;
        continue;
      }
    } else {
      i = dataStart + compSize;
      continue;
    }
    entries.push({ path: name, content });
    i = dataStart + compSize;
  }
  return entries;
}

/**
 * @param {ArrayBuffer} buf
 * @param {string} filename
 * @returns {Promise<Array<{ path: string, content: Uint8Array }>>}
 */
export async function extractThemeArchive(buf, filename) {
  const lower = String(filename || '').toLowerCase();
  let raw = new Uint8Array(buf);
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const decompressed = await gunzipArrayBuffer(buf);
    raw = new Uint8Array(decompressed);
    return extractTarEntries(raw);
  }
  if (lower.endsWith('.tar')) {
    return extractTarEntries(raw);
  }
  if (lower.endsWith('.zip')) {
    return extractZipEntries(raw);
  }
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    const decompressed = await gunzipArrayBuffer(buf);
    return extractTarEntries(new Uint8Array(decompressed));
  }
  if (raw[0] === 0x50 && raw[1] === 0x4b) {
    return extractZipEntries(raw);
  }
  throw new Error('unsupported_archive_format');
}

/**
 * @param {Array<{ path: string, content: Uint8Array }>} entries
 */
export function findShopifyLiquidSections(entries) {
  const sections = [];
  for (const e of entries) {
    const p = String(e.path || '').replace(/\\/g, '/');
    if (!/sections\/[^/]+\.liquid$/i.test(p)) continue;
    const key = p.split('/').pop()?.replace(/\.liquid$/i, '') || p;
    const text = textFromBytes(e.content);
    sections.push({ path: p, section_key: key, section_name: key, liquid_source: text });
  }
  return sections;
}

/** @param {Uint8Array} bytes */
function textFromBytes(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
