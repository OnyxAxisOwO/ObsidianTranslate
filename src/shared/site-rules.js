export function parseSitePattern(input) {
  if (typeof input !== 'string') throw new Error('请输入域名或网址路径。');
  const value = input.trim();
  if (value.includes('://') && !/^https?:\/\//i.test(value)) throw new Error('网址规则仅支持 HTTP 和 HTTPS。');
  const match = value.match(/^(?:(https?):\/\/)?(\*\.)?([^/*?#\s]+)([^?#\s]*)$/i);
  if (!match || input.length > 600) throw new Error('请输入有效规则，例如 *.example.com/news/*。');
  const [, scheme = '', wildcard = '', authority, rawPath] = match;
  if (/[\\@]/.test(authority) || rawPath.includes('\\') || rawPath.slice(0, -1).includes('*')) {
    throw new Error('通配符可用于子域名开头或路径末尾。');
  }
  const url = new URL((scheme || 'https') + '://' + authority + rawPath);
  if (!url.hostname || (wildcard && !url.hostname.includes('.'))) throw new Error('请输入有效的站点域名。');
  const protocol = scheme.toLowerCase();
  const path = rawPath ? url.pathname : '';
  const prefix = path.endsWith('*');
  return {
    pattern: (protocol ? protocol + '://' : '') + wildcard + url.host + path,
    protocol, hostname: url.hostname, port: url.port, wildcard: !!wildcard, prefix,
    path: prefix ? path.slice(0, -1) : path,
  };
}

export function pageAddress(value) {
  try {
    const url = new URL(value.includes('://') ? value : 'https://' + value);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function matchingSiteProfiles(profiles, url) {
  if (!url) return [];
  return profiles.flatMap(profile => {
    const pattern = parseSitePattern(profile.pattern);
    const hostMatches = pattern.wildcard ? url.hostname.endsWith('.' + pattern.hostname) : url.hostname === pattern.hostname;
    if (!hostMatches || (pattern.protocol && url.protocol !== pattern.protocol + ':') ||
        (pattern.port && pattern.port !== url.port)) return [];
    if (pattern.path && (pattern.prefix ? !url.pathname.startsWith(pattern.path) : url.pathname !== pattern.path)) return [];
    return [{ profile, pattern }];
  }).sort((a, b) => a.pattern.hostname.length - b.pattern.hostname.length ||
    Number(b.pattern.wildcard) - Number(a.pattern.wildcard) ||
    a.pattern.path.length - b.pattern.path.length || Number(b.pattern.prefix) - Number(a.pattern.prefix) ||
    Number(!!a.pattern.protocol) - Number(!!b.pattern.protocol) || Number(!!a.pattern.port) - Number(!!b.pattern.port))
    .map(item => item.profile);
}
