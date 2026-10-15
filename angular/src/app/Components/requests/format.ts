// The three marks a ticket's text can carry. The stored text stays plain, a mark is only the characters around the words,
// the editor turns them into the real effect while someone writes and back into the characters when it hands the text on.
export type Mark = 'bold' | 'italic' | 'code';

export interface Piece {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}

// An underscore only counts at the edge of a word, so a name like some_field_name is left alone.
const TOKEN = /`([^`\n]+)`|\*\*(?!\s)(.+?)(?<!\s)\*\*|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g;

// Splits text into pieces to show. The pieces are rendered as text nodes, so nothing typed can become markup.
export function parseMarks(text: string, bold = false, italic = false): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), bold, italic, code: false });
    if (m[1] !== undefined) out.push({ text: m[1], bold, italic, code: true });
    else if (m[2] !== undefined) out.push(...parseMarks(m[2], true, italic));
    else out.push(...parseMarks(m[3], bold, true));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), bold, italic, code: false });
  return out;
}

// Fills the editor from stored text, so the marks show as bold, italic and code instead of as characters.
export function renderInto(root: HTMLElement, text: string) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  for (const piece of parseMarks(text)) {
    piece.text.split('\n').forEach((line, at) => {
      if (at > 0) root.append(doc.createElement('br'));
      if (!line) return;
      let node: Node = doc.createTextNode(line);
      const wrap = (tag: string) => {
        const el = doc.createElement(tag);
        el.append(node);
        node = el;
      };
      if (piece.code) wrap('code');
      else {
        if (piece.italic) wrap('i');
        if (piece.bold) wrap('b');
      }
      root.append(node);
    });
  }
}

// Reads the editor back into stored text. Whatever the browser made of the typing (b, strong, i, em, styled spans,
// divs for new lines) ends up as the same few marks, with spaces kept outside them so they still read back.
export function serialize(root: Node): string {
  const runs: Piece[] = [];
  const push = (text: string, bold: boolean, italic: boolean, code: boolean) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic && last.code === code) last.text += text;
    else runs.push({ text, bold, italic, code });
  };
  const walk = (parent: Node, bold: boolean, italic: boolean, code: boolean) => {
    parent.childNodes.forEach(child => {
      if (child.nodeType === 3) {
        push((child.nodeValue ?? '').replace(/ /g, ' ').replace(/​/g, ''), bold, italic, code);
        return;
      }
      if (child.nodeType !== 1) return;
      const el = child as HTMLElement;
      const tag = el.tagName;
      if (tag === 'BR') {
        push('\n', false, false, false);
        return;
      }
      const weight = el.style?.fontWeight ?? '';
      const nb = bold || tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600;
      const ni = italic || tag === 'I' || tag === 'EM' || el.style?.fontStyle === 'italic';
      const nc = code || tag === 'CODE';
      const block = tag === 'DIV' || tag === 'P';
      const before = runs.length ? runs[runs.length - 1].text : '';
      if (block && before && !before.endsWith('\n')) push('\n', false, false, false);
      // A block that holds only a break is an empty line the block start already made
      if (block && el.childNodes.length === 1 && (el.firstChild as HTMLElement).tagName === 'BR') return;
      walk(el, nb, ni, nc);
    });
  };
  walk(root, false, false, false);

  let out = '';
  for (const run of runs) {
    for (const part of run.text.split(/(\n)/)) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(part)!;
      if (!part || part === '\n' || !m[2]) {
        out += part;
        continue;
      }
      let core = m[2];
      if (run.code) core = '`' + core + '`';
      else {
        if (run.bold) core = '**' + core + '**';
        if (run.italic) core = '_' + core + '_';
      }
      out += m[1] + core + m[3];
    }
  }
  return out;
}
