/**
 * A small, tolerant HTML reader for SAVED PAGES — the Replay Board's input.
 *
 * WHY NOT `DOMParser`. It is the obvious tool in a browser, and it is not in
 * node, where this project's tests run (jsdom does not load on this machine —
 * see `tests/deviceIdentity.test.ts`). The replay reader is the part that has
 * to be right, so it must be testable, so the parsing is done here in plain
 * string work. It reads attributes and text and nothing else: no script runs,
 * no resource loads, nothing in the file is ever put into the page as HTML.
 *
 * WHAT IT HANDLES, because a saved page has all of it: comments (Chrome writes
 * `<!-- saved from url=... -->` at the top), a doctype, `<script>`/`<style>`
 * whose contents are raw text and must not be read as tags, void elements,
 * quoted / unquoted / bare attributes, and the common entities. Unclosed or
 * stray end tags are forgiven the way a browser forgives them: an end tag
 * closes back to the nearest open element of its name, and one with no open
 * match is ignored.
 *
 * AND CHROME'S SINGLE-FILE FORMAT. "Save as -> Webpage, Single File" writes
 * MHTML: a MIME envelope whose HTML part is quoted-printable, where `=` is
 * written `=3D` and long lines are cut with `=` + newline. Read raw, not one
 * attribute in it parses. `unwrapSavedPage` finds that part and decodes it.
 *
 * No imports, so it is tested on its own (`tests/replay.test.ts`).
 */

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  /** Text directly inside this element (not its children's), entities decoded. */
  text: string;
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** Elements whose contents are raw text, never markup. */
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript']);

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  middot: '·', ndash: '–', mdash: '—', hellip: '…',
  times: '×', copy: '©', laquo: '«', raquo: '»',
};

export function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED[body.toLowerCase()];
    return named ?? whole;
  });
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(src))) {
    const name = m[1].toLowerCase();
    if (name in out) continue; // the first wins, as in a browser
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    out[name] = decodeEntities(raw);
  }
  return out;
}

/* One pass over the text. A tag is `<` followed by a letter (start) or `/`
   and a letter (end); anything else after a `<` is text, as a browser reads
   it. Comments, doctypes and CDATA are skipped whole. */
const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>?|<\?[^>]*>?|<\/([a-zA-Z][\w:.-]*)[^>]*>|<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: HtmlNode[] = [root];
  let last = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;

  const addText = (from: number, to: number) => {
    if (to <= from) return;
    const top = stack[stack.length - 1];
    top.text += decodeEntities(html.slice(from, to));
  };

  while ((m = TOKEN.exec(html))) {
    addText(last, m.index);
    last = TOKEN.lastIndex;
    const endName = m[1];
    const startName = m[2];
    if (endName) {
      const name = endName.toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (!startName) continue; // comment, doctype, CDATA, processing instruction
    const tag = startName.toLowerCase();
    let attrSrc = m[3] ?? '';
    const selfClosing = /\/\s*$/.test(attrSrc);
    if (selfClosing) attrSrc = attrSrc.replace(/\/\s*$/, '');
    const node: HtmlNode = { tag, attrs: parseAttrs(attrSrc), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (VOID.has(tag) || selfClosing) continue;
    if (RAW.has(tag)) {
      // Raw text runs to the matching end tag; nothing inside is markup.
      const close = new RegExp(`</${tag}\\s*>`, 'ig');
      close.lastIndex = last;
      const end = close.exec(html);
      const stop = end ? end.index : html.length;
      if (tag === 'title' || tag === 'textarea') node.text = decodeEntities(html.slice(last, stop));
      last = end ? close.lastIndex : html.length;
      TOKEN.lastIndex = last;
      continue;
    }
    stack.push(node);
  }
  addText(last, html.length);
  return root;
}

/** Every node under (and including) `node` that passes `pred`, document order. */
export function findAll(node: HtmlNode, pred: (n: HtmlNode) => boolean): HtmlNode[] {
  const out: HtmlNode[] = [];
  const walk = (n: HtmlNode) => {
    if (pred(n)) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

export function hasClass(node: HtmlNode, cls: string): boolean {
  const c = node.attrs.class;
  if (!c) return false;
  return c.split(/\s+/).includes(cls);
}

/** All the text inside an element, whitespace collapsed. */
export function textOf(node: HtmlNode): string {
  const parts: string[] = [];
  const walk = (n: HtmlNode) => {
    parts.push(n.text);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/* ── Saved-page envelopes ─────────────────────────────────────────────────── */

function decodeQuotedPrintable(body: string): Uint8Array {
  const joined = body.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const ch = joined.charCodeAt(i);
    if (ch === 0x3d && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (ch < 0x80) {
      bytes.push(ch);
    } else {
      // Not legal in QP, but a decoded string can carry it: re-encode as UTF-8.
      for (const b of new TextEncoder().encode(joined[i])) bytes.push(b);
    }
  }
  return new Uint8Array(bytes);
}

function decodeBase64(body: string): Uint8Array {
  const clean = body.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** True when the text is an MHTML envelope rather than a page. */
export function isMhtml(text: string): boolean {
  const head = text.slice(0, 4000);
  return /^MIME-Version:/im.test(head) && /multipart\/related/i.test(head);
}

/**
 * The HTML inside whatever the browser saved. A plain `.html` comes back as it
 * is; an `.mhtml` envelope gives up its first `text/html` part, decoded.
 */
export function unwrapSavedPage(text: string): string {
  if (!isMhtml(text)) return text;
  const boundary = /boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(text.slice(0, 4000))?.[1];
  if (!boundary) return text;
  const parts = text.split(`--${boundary}`);
  for (const part of parts) {
    const split = part.search(/\r?\n\r?\n/);
    if (split < 0) continue;
    const headers = part.slice(0, split);
    if (!/content-type:\s*text\/html/i.test(headers)) continue;
    // The line break before the next boundary belongs to the boundary.
    const body = part.slice(split).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '');
    const enc = /content-transfer-encoding:\s*([\w-]+)/i.exec(headers)?.[1]?.toLowerCase();
    try {
      if (enc === 'quoted-printable') return new TextDecoder('utf-8').decode(decodeQuotedPrintable(body));
      if (enc === 'base64') return new TextDecoder('utf-8').decode(decodeBase64(body));
    } catch {
      return body;
    }
    return body;
  }
  return text;
}
