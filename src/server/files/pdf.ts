import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Just enough PDF for Jimat: find the streams, read the text out of them, and
 * write a simple one-page sample bill. The original file is never rendered or
 * executed; only its bytes are inspected.
 */

const MAX_STREAMS = 400;
const MAX_INFLATED_BYTES = 4_000_000;

/** Every stream in the file with its dictionary, inflated where it is Flate-compressed. Bounded against zip bombs. */
export function pdfStreams(bytes: Uint8Array): { dict: string; data: Buffer }[] {
  const text = Buffer.from(bytes).toString('latin1');
  const out: { dict: string; data: Buffer }[] = [];
  const re = /<<((?:(?!>>\s*stream)[\s\S]){0,4000})>>\s*stream\r?\n/g;
  let total = 0;
  for (let match = re.exec(text); match && out.length < MAX_STREAMS; match = re.exec(text)) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const raw = Buffer.from(bytes.subarray(start, end));
    const dict = match[1]!;
    let data: Buffer | null = null;
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(raw, { maxOutputLength: MAX_INFLATED_BYTES - total });
      } catch {
        data = null; // damaged, or would inflate past the limit: skipped, never trusted
      }
    } else if (!/\/Filter/.test(dict)) {
      data = raw;
    }
    if (data) {
      total += data.length;
      out.push({ dict, data });
      if (total >= MAX_INFLATED_BYTES) break;
    }
    re.lastIndex = end;
  }
  return out;
}

/** Reads one literal string "( … )" starting at `i`, with escapes and nested brackets. */
function readLiteral(s: string, i: number): [string, number] {
  let depth = 1;
  let out = '';
  let j = i + 1;
  while (j < s.length && depth > 0) {
    const c = s[j]!;
    if (c === '\\') {
      const n = s[j + 1] ?? '';
      const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' };
      if (n in simple) {
        out += simple[n];
        j += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(s.slice(j + 1))![0];
        out += String.fromCharCode(parseInt(oct, 8));
        j += 1 + oct.length;
      } else {
        j += 2;
      }
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth > 0) out += c;
    j++;
  }
  return [out, j];
}

/** The text drawn by a content stream: strings shown with Tj, TJ, ' and ", with line breaks where text moves. */
export function contentText(content: string): string {
  let out = '';
  let i = 0;
  let inText = false;
  while (i < content.length) {
    const c = content[i]!;
    if (c === '(' && inText) {
      const [str, next] = readLiteral(content, i);
      out += str;
      i = next;
      continue;
    }
    if (c === '<' && content[i + 1] !== '<' && inText) {
      const end = content.indexOf('>', i);
      if (end < 0) break;
      const hex = content.slice(i + 1, end).replace(/\s+/g, '');
      if (/^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0) {
        const decoded = Buffer.from(hex, 'hex').toString('latin1');
        // Two-byte font codes cannot be read without the font's map: keep only plain text.
        if (/^[\x20-\x7e]*$/.test(decoded)) out += decoded;
      }
      i = end + 1;
      continue;
    }
    const word = /^[A-Za-z*'"]+/.exec(content.slice(i, i + 3))?.[0];
    if (word) {
      if (word === 'BT') inText = true;
      else if (word === 'ET') {
        inText = false;
        out += '\n';
      } else if (inText && ['Td', 'TD', 'T*', "'", '"', 'Tm'].includes(word)) out += '\n';
      else if (inText && word === 'Tj') out += ' ';
      i += word.length;
      continue;
    }
    i++;
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** All readable text in a PDF, from its page content streams. Empty when the text is not stored as plain characters. */
export function pdfText(bytes: Uint8Array): string {
  return pdfStreams(bytes)
    .filter((s) => !/\/Subtype\s*\/Image/.test(s.dict) && !/\/Type\s*\/(XObject|Metadata|XRef|ObjStm)/.test(s.dict))
    .map((s) => contentText(s.data.toString('latin1')))
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000);
}

// --- Writing a sample bill -------------------------------------------------------------

const esc = (text: string) => text.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');

/** A one-page PDF with the given lines, in Helvetica, with a compressed content stream. */
export function simplePdf(lines: { text: string; x: number; y: number; size?: number; bold?: boolean }[]): Buffer {
  const content = lines.map((l) => `BT /${l.bold ? 'F2' : 'F1'} ${l.size ?? 11} Tf ${l.x} ${l.y} Td (${esc(l.text)}) Tj ET`).join('\n');
  const stream = deflateSync(Buffer.from(content, 'latin1'));
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from('\nendstream')]),
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}
