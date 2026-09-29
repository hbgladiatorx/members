/**
 * The small Markdown subset used for rich text in messages and postings. Parsed into a tree the app
 * draws itself; no HTML is ever produced or rendered, so formatting can't carry script.
 *
 * Blocks: paragraphs (single newlines kept), # / ## / ### headings, - or * bullets, 1. numbered
 * lists, > quotes, ``` code blocks.
 * Inline: **bold**, *italic* or _italic_, ~~strike~~, `code`, [text](https://link), bare https:// links.
 * Links open only for http(s) and mailto; anything else stays plain text.
 * Attachments placed in the text: ![title](attachment:<ref>), where <ref> names one of the posting's
 * own attachments (a photo, file or link). On a line of its own it's shown full size; inside a
 * sentence, as a small chip.
 */

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'bold' | 'italic' | 'strike'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; href: string; children: Inline[] }
  | { t: 'att'; ref: string; title: string };

export type Block =
  | { t: 'p'; lines: Inline[][] }
  | { t: 'h'; level: 1 | 2 | 3; children: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][]; start: number }
  | { t: 'quote'; lines: Inline[][] }
  | { t: 'code'; text: string }
  | { t: 'att'; ref: string; title: string };

const ATT = /!\[([^\]\n]*)\]\(attachment:([A-Za-z0-9_-]{1,32})\)/;
const ATT_LINE = new RegExp(`^\\s*${ATT.source}\\s*$`);

/** The text that places an attachment: ![title](attachment:ref). */
export function attachmentToken(title: string, ref: string): string {
  return `![${title.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim() || 'attachment'}](attachment:${ref})`;
}

/** A new reference for an attachment placed in the text (unique within one posting). */
export function newAttachmentRef(): string {
  let r = '';
  while (r.length < 10) r += Math.random().toString(36).slice(2);
  return r.slice(0, 10);
}

/** The references of the attachments placed in `src` (and so shown in the text, not below it). */
export function placedRefs(src: string): Set<string> {
  const refs = new Set<string>();
  const walk = (ins: Inline[]) =>
    ins.forEach((n) => (n.t === 'att' ? refs.add(n.ref) : n.t === 'text' || n.t === 'code' ? null : walk(n.children)));
  for (const b of parseMarkdown(src)) {
    if (b.t === 'att') refs.add(b.ref);
    else if (b.t === 'p' || b.t === 'quote') b.lines.forEach(walk);
    else if (b.t === 'h') walk(b.children);
    else if (b.t === 'ul' || b.t === 'ol') b.items.forEach(walk);
  }
  return refs;
}

export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\/[^\s]+$/i.test(h)) return h;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return h;
  return null;
}

// Inline patterns, tried at each position; the earliest match wins.
const INLINE: { re: RegExp; make: (m: RegExpExecArray) => Inline }[] = [
  { re: ATT, make: (m) => ({ t: 'att', title: m[1]!, ref: m[2]! }) },
  { re: /`([^`\n]+)`/, make: (m) => ({ t: 'code', text: m[1]! }) },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    make: (m) => {
      const href = safeHref(m[2]!);
      return href ? { t: 'link', href, children: parseInline(m[1]!) } : { t: 'text', text: m[0] };
    },
  },
  { re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/, make: (m) => ({ t: 'link', href: m[0], children: [{ t: 'text', text: m[0] }] }) },
  { re: /\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/, make: (m) => ({ t: 'bold', children: parseInline(m[1]!) }) },
  { re: /~~(?!\s)([^\n]+?)(?<!\s)~~/, make: (m) => ({ t: 'strike', children: parseInline(m[1]!) }) },
  { re: /\*(?![\s*])([^\n*]+?)(?<!\s)\*/, make: (m) => ({ t: 'italic', children: parseInline(m[1]!) }) },
  // _italic_ only at word edges, so snake_case_names stay as they are.
  // Plain ranges (Latin, Arabic) rather than \p{L}, which Hermes on iOS/Android may not support.
  { re: /(?<![A-Za-z0-9_\u00C0-\u024F\u0600-\u06FF])_(?![\s_])([^\n_]+?)(?<!\s)_(?![A-Za-z0-9_\u00C0-\u024F\u0600-\u06FF])/, make: (m) => ({ t: 'italic', children: parseInline(m[1]!) }) },
];

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  while (rest) {
    let best: { index: number; m: RegExpExecArray; make: (m: RegExpExecArray) => Inline } | null = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.index)) best = { index: m.index, m, make: p.make };
    }
    if (!best) {
      out.push({ t: 'text', text: rest });
      break;
    }
    if (best.index > 0) out.push({ t: 'text', text: rest.slice(0, best.index) });
    out.push(best.make(best.m));
    rest = rest.slice(best.index + best.m[0].length);
  }
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.+)$/;
const QUOTE = /^>\s?(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) body.push(lines[i++]!);
      i++; // closing fence (or end)
      blocks.push({ t: 'code', text: body.join('\n') });
      continue;
    }
    const a = ATT_LINE.exec(line);
    if (a) {
      blocks.push({ t: 'att', title: a[1]!, ref: a[2]! });
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3, children: parseInline(h[2]!.trim()) });
      i++;
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const numbered = !BULLET.test(line);
      const items: Inline[][] = [];
      const start = numbered ? Number(NUMBERED.exec(line)![1]) : 1;
      while (i < lines.length) {
        const m = numbered ? NUMBERED.exec(lines[i]!) : BULLET.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline((numbered ? m[2] : m[1])!));
        i++;
      }
      blocks.push({ t: numbered ? 'ol' : 'ul', items, start });
      continue;
    }
    if (QUOTE.test(line)) {
      const q: Inline[][] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) q.push(parseInline(QUOTE.exec(lines[i++]!)![1]!));
      blocks.push({ t: 'quote', lines: q });
      continue;
    }
    const para: Inline[][] = [];
    while (i < lines.length && lines[i]!.trim() && !HEADING.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBERED.test(lines[i]!) && !QUOTE.test(lines[i]!) && !lines[i]!.trim().startsWith('```') && !ATT_LINE.test(lines[i]!)) {
      para.push(parseInline(lines[i++]!));
    }
    blocks.push({ t: 'p', lines: para });
  }
  return blocks;
}

/** Plain text for previews (chat list, question and discussion excerpts): formatting marks removed. */
export function stripMarkdown(src: string): string {
  const flat = (ins: Inline[]): string =>
    ins.map((n) => (n.t === 'text' || n.t === 'code' ? n.text : n.t === 'att' ? `📎 ${n.title}` : flat(n.children))).join('');
  return parseMarkdown(src)
    .map((b) => {
      switch (b.t) {
        case 'p':
        case 'quote':
          return b.lines.map(flat).join(' ');
        case 'h':
          return flat(b.children);
        case 'ul':
        case 'ol':
          return b.items.map(flat).join(', ');
        case 'code':
          return b.text;
        case 'att':
          return `📎 ${b.title}`;
      }
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
