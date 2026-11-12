// Minimal XML -> DOM-like tree for node tests (node has no DOMParser). Implements only what lib.js feed parsing uses:
// documentElement, nodeType, nodeName, localName, childNodes, textContent, getAttribute.
// Malformed input yields a document whose root is <parsererror>, as DOMParser does.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, n) => {
  if (n[0] === '#') return String.fromCodePoint(n[1].toLowerCase() === 'x' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10));
  if (!(n in ENT)) throw new Error(`undefined entity ${n}`);
  return ENT[n];
});

class El {
  constructor(nodeName, attrs) {
    this.nodeType = 1; this.nodeName = nodeName; this.localName = nodeName.split(':').pop(); this.attrs = attrs; this.childNodes = [];
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
}

function build(xml) {
  const stack = [];
  let root = null;
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s>/!?]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, cdata, close, open, attrStr, selfClose, text, stray] = m;
    if (stray) throw new Error('stray <');
    if (cdata !== undefined) { stack.at(-1)?.childNodes.push({ nodeType: 3, data: cdata }); continue; }
    if (text !== undefined) {
      if (stack.length) stack.at(-1).childNodes.push({ nodeType: 3, data: unescapeXml(text) });
      else if (text.trim()) throw new Error('text outside root');
      continue;
    }
    if (close !== undefined) {
      const el = stack.pop();
      if (!el || el.nodeName !== close) throw new Error('mismatched end tag');
      if (!stack.length) root = el;
      continue;
    }
    if (open !== undefined) {
      const attrs = {};
      for (const a of attrStr.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescapeXml(a[2] ?? a[3]);
      const el = new El(open, attrs);
      if (stack.length) stack.at(-1).childNodes.push(el);
      else if (root) throw new Error('multiple roots');
      if (selfClose) { if (!stack.length) root = el; } else stack.push(el);
    }
  }
  if (stack.length || !root) throw new Error('unclosed element');
  return root;
}

export function parseXml(xml) {
  try { return { documentElement: build(String(xml).replace(/^\uFEFF/, '')) }; } catch (e) {
    const err = new El('parsererror', {});
    err.childNodes.push({ nodeType: 3, data: e.message });
    return { documentElement: err };
  }
}
