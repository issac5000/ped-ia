const DEFAULT_BASE_URL = 'https://api.openai.com';
const VERSION_SUFFIX_REGEX = /\/v\d+[a-z0-9-]*$/i;
const VERSION_PREFIX_REGEX = /^v\d+[a-z0-9-]*/i;

function normalizeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

export function resolveOpenAIBaseUrl(value, defaultBase = DEFAULT_BASE_URL) {
  const raw = normalizeString(value);
  if (!raw) {
    return { baseUrl: defaultBase, version: undefined };
  }

  let trimmed = raw.replace(/\/+$/, '');
  if (!trimmed) {
    return { baseUrl: defaultBase, version: undefined };
  }

  let version;
  while (VERSION_SUFFIX_REGEX.test(trimmed)) {
    const match = trimmed.match(VERSION_SUFFIX_REGEX);
    if (!match) break;
    version = match[0].slice(1);
    trimmed = trimmed.slice(0, -match[0].length).replace(/\/+$/, '');
  }

  const baseUrl = trimmed || defaultBase;
  return { baseUrl, version };
}

export function normalizeOpenAIBaseUrl(value, defaultBase = DEFAULT_BASE_URL) {
  return resolveOpenAIBaseUrl(value, defaultBase).baseUrl;
}

function normalizeVersion(defaultVersion) {
  const raw = normalizeString(defaultVersion);
  if (!raw) return 'v1';
  const cleaned = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  return cleaned || 'v1';
}

export function normalizeOpenAIPath(path, defaultVersion = 'v1') {
  const version = normalizeVersion(defaultVersion);
  const defaultSegment = `/${version}`;
  const raw = normalizeString(path);
  if (!raw) return defaultSegment;

  let withoutLeading = raw.replace(/^[\/]+/, '');
  if (!withoutLeading) return defaultSegment;

  withoutLeading = withoutLeading.replace(/\/{2,}/g, '/');

  const versionMatch = withoutLeading.match(VERSION_PREFIX_REGEX);
  if (versionMatch) {
    const matched = versionMatch[0];
    const rest = withoutLeading.slice(matched.length).replace(/^\/+/, '');
    return rest ? `/${matched}/${rest}` : `/${matched}`;
  }

  const rest = withoutLeading.replace(/^\/+/, '');
  const combined = rest ? `${defaultSegment}/${rest}` : defaultSegment;
  return combined.replace(/\/{2,}/g, '/');
}

export function buildOpenAIUrl(baseUrl, path, defaultVersion = 'v1') {
  const { baseUrl: cleanBase, version } = resolveOpenAIBaseUrl(baseUrl);
  const normalizedPath = isVersionedOpenAIPath(path)
    ? normalizeOpenAIPath(path)
    : normalizeOpenAIPath(path, version || defaultVersion);
  return `${cleanBase}${normalizedPath}`;
}

export function isVersionedOpenAIPath(path) {
  const raw = normalizeString(path).replace(/^[\/]+/, '');
  if (!raw) return false;
  return VERSION_PREFIX_REGEX.test(raw);
}

export { DEFAULT_BASE_URL };
