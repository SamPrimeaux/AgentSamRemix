function descriptorRank(descriptor) {
  const value = String(descriptor || '').trim().toLowerCase();
  if (!value) return 1;
  if (value.endsWith('w')) return Number(value.slice(0, -1)) || 1;
  if (value.endsWith('x')) return (Number(value.slice(0, -1)) || 1) * 100000;
  return 1;
}

/**
 * Parse common srcset forms without splitting commas embedded inside CDN transform URLs.
 *
 * The Legendary proof exposed the bug in a naive `value.split(',')`: Wix and GoDaddy
 * transform paths themselves contain commas. This parser tokenizes each URL up to its
 * whitespace descriptor, then consumes the candidate delimiter separately.
 */
export function parseSrcsetCandidates(value) {
  const text = String(value || '').trim();
  if (!text) return [];

  const out = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /[\s,]/.test(text[cursor])) cursor += 1;
    if (cursor >= text.length) break;

    const urlStart = cursor;
    while (cursor < text.length && !/\s/.test(text[cursor])) cursor += 1;
    let url = text.slice(urlStart, cursor).trim();

    // Descriptor-less candidates commonly attach the delimiter to the URL token:
    // `a.jpg, b.jpg`. Strip only *trailing* commas; embedded CDN commas survive.
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      if (url) out.push({ url, descriptor: null });
      continue;
    }

    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    const descriptorStart = cursor;
    while (cursor < text.length && text[cursor] !== ',') cursor += 1;
    let descriptor = text.slice(descriptorStart, cursor).trim();

    if (descriptor.includes(' ')) descriptor = descriptor.split(/\s+/)[0];
    if (url) out.push({ url, descriptor: descriptor || null });

    if (text[cursor] === ',') cursor += 1;
  }
  return out;
}

export function bestSrcsetCandidate(value) {
  const candidates = parseSrcsetCandidates(value);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => descriptorRank(b.descriptor) - descriptorRank(a.descriptor))[0];
}
