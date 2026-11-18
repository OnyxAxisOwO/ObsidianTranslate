const markers = /<(\/?)(ot-(?:link|fmt)-\d+)>/gi;

export const hasMarkup = text => /<ot-(?:link|fmt)-\d+>/i.test(text);
export const stripMarkup = text => text.replace(markers, '');
export const markupMatches = text => text.matchAll(markers);

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const escapeMarkup = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function decodeEntities(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity, value) => {
    if (value[0] !== '#') return entities[value.toLowerCase()];
    const point = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

export function providerMarkup(text) {
  return escapeMarkup(text).replace(/&lt;(\/?)(ot-(link|fmt)-\d+)&gt;/gi, (_, close, name, kind) => {
    if (kind.toLowerCase() === 'link') return close ? '</a>' : '<a href="#' + name + '">';
    return close ? '</span>' : '<span id="' + name + '">';
  });
}

export function restoreProviderMarkup(text) {
  const stack = [];
  const decoded = text.replace(/<(\/?)(a|span)\b([^>]*)>/gi, (tag, close, type, attrs) => {
    type = type.toLowerCase();
    if (close) {
      if (stack.at(-1)?.type !== type) return tag;
      const { name } = stack.pop();
      return name ? '</' + name + '>' : tag;
    }
    const name = (type === 'a' ? attrs.match(/\bhref\s*=\s*["']#(ot-link-\d+)["']/i) :
      attrs.match(/\bid\s*=\s*["'](ot-fmt-\d+)["']/i))?.[1];
    stack.push({ type, name });
    return name ? '<' + name + '>' : tag;
  });
  return decodeEntities(decoded);
}
