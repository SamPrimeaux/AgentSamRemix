/**
 * Text extraction and sentence chunking utilities for Text-To-Speech (SpeechSynthesis API).
 */

/**
 * Cleanly extracts readable text content from an HTML string, preserving natural pauses
 * between headings, paragraphs, list items, and sections.
 */
export function extractTextFromHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove elements that should not be spoken
    const unwanted = doc.querySelectorAll(
      'script, style, noscript, svg, iframe, link, meta, select, textarea, [aria-hidden="true"], .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp, .material-icons'
    );
    unwanted.forEach(el => el.remove());

    // Punctuation check regex
    const endsWithPunctuation = /[.!?:;,\u2026]$/;

    // Ensure block-level elements have trailing punctuation or whitespace so sentences don't collide
    const blockSelectors = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, tr, td, th, div, section, article, header, footer, nav, aside, caption, button';
    const blockElements = doc.querySelectorAll(blockSelectors);

    blockElements.forEach(el => {
      const text = el.textContent?.trim();
      if (text) {
        if (!endsWithPunctuation.test(text)) {
          el.appendChild(doc.createTextNode('. '));
        } else {
          el.appendChild(doc.createTextNode(' '));
        }
      }
    });

    const rawText = doc.body.textContent || doc.body.innerText || '';

    // Normalize spacing, trim, and collapse redundant punctuation
    const cleanText = rawText
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?:;])/g, '$1')
      .replace(/(\. ){2,}/g, '. ')
      .replace(/([.?!])\./g, '$1')
      .trim();

    return cleanText;
  } catch (err) {
    console.warn('DOMParser text extraction failed, using regex fallback', err);
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * Splits long text into chunks of manageable lengths (ideal for SpeechSynthesisUtterance)
 * to avoid browser-specific pauses or cutoffs on long text blocks.
 */
export function splitTextIntoChunks(text: string, maxChunkLength = 160): string[] {
  if (!text) return [];

  // Match sentences ending in punctuation or end-of-string
  const sentenceRegex = /[^.!?\n]+[.!?]+|[^.!?\n]+$/g;
  const rawSentences = text.match(sentenceRegex) || [text];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of rawSentences) {
    const s = sentence.trim();
    if (!s) continue;

    if (current.length + s.length + 1 <= maxChunkLength) {
      current = current ? `${current} ${s}` : s;
    } else {
      if (current) {
        chunks.push(current);
      }
      if (s.length > maxChunkLength) {
        // Break extra-long sentence into word chunks
        const words = s.split(' ');
        let sub = '';
        for (const w of words) {
          if (sub.length + w.length + 1 <= maxChunkLength) {
            sub = sub ? `${sub} ${w}` : w;
          } else {
            if (sub) chunks.push(sub);
            sub = w;
          }
        }
        if (sub) current = sub;
        else current = '';
      } else {
        current = s;
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
