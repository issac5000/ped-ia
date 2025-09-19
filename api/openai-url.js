const DEFAULT_BASE_URL = 'https://api.openai.com';
const VERSION_SUFFIX_REGEX = /\/v\d+[a-z0-9-]*$/i;
const VERSION_PREFIX_REGEX = /^v\d+[a-z0-9-]*/i;
const AZURE_HOST_REGEX = /\.openai\.azure\.com$/i;
const AZURE_DEPLOYMENT_SEGMENT_REGEX = /\/openai\/deployments\//i;

function normalizeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

export function resolveOpenAIBaseUrl(value, defaultBase = DEFAULT_BASE_URL) {
  const raw = normalizeString(value);
  if (!raw) {
    return { baseUrl: defaultBase, version: undefined, searchParams: undefined };
  }

  const { urlPart, searchParams } = splitUrlAndQuery(raw);

  let trimmed = urlPart.replace(/\/+$/, '');
  if (!trimmed) {
    return { baseUrl: defaultBase, version: undefined, searchParams };
  }

  let version;
  while (VERSION_SUFFIX_REGEX.test(trimmed)) {
    const match = trimmed.match(VERSION_SUFFIX_REGEX);
    if (!match) break;
    version = match[0].slice(1);
    trimmed = trimmed.slice(0, -match[0].length).replace(/\/+$/, '');
  }

  if (!version && searchParams?.has('api-version')) {
    const paramVersion = normalizeString(searchParams.get('api-version'));
    if (paramVersion) version = paramVersion;
  }

  const baseUrl = trimmed || defaultBase;
  return { baseUrl, version, searchParams };
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
  const { baseUrl: cleanBase, version, searchParams } = resolveOpenAIBaseUrl(baseUrl);

  if (isAzureOpenAIBaseUrl(cleanBase)) {
    return buildAzureOpenAIUrl({
      baseUrl: cleanBase,
      path,
      version: version || undefined,
      defaultVersion,
      searchParams,
    });
  }

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

function splitUrlAndQuery(raw) {
  let urlPart = raw;
  let searchParams;

  const queryIndex = urlPart.indexOf('?');
  if (queryIndex >= 0) {
    const query = urlPart.slice(queryIndex + 1);
    urlPart = urlPart.slice(0, queryIndex);
    try {
      searchParams = new URLSearchParams(query);
    } catch {
      searchParams = undefined;
    }
  }

  const hashIndex = urlPart.indexOf('#');
  if (hashIndex >= 0) {
    urlPart = urlPart.slice(0, hashIndex);
  }

  return { urlPart, searchParams };
}

function isAzureOpenAIBaseUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return false;

  try {
    const parsed = new URL(raw);
    if (AZURE_HOST_REGEX.test(parsed.hostname)) return true;
    if (AZURE_DEPLOYMENT_SEGMENT_REGEX.test(parsed.pathname)) return true;
  } catch {}

  return AZURE_HOST_REGEX.test(raw) || AZURE_DEPLOYMENT_SEGMENT_REGEX.test(raw);
}

function buildAzureOpenAIUrl({ baseUrl, path, version, defaultVersion, searchParams }) {
  const normalizedBase = normalizeString(baseUrl).replace(/\/+$/, '');
  const normalizedPath = normalizeAzurePath(path);
  const params = new URLSearchParams(searchParams ? searchParams.toString() : '');

  const detectedVersion = normalizeString(version);
  const overrideCandidate = normalizeString(defaultVersion);
  const apiVersion = detectedVersion || (overrideCandidate && overrideCandidate.toLowerCase() !== 'v1' ? overrideCandidate : '');
  if (apiVersion) {
    params.set('api-version', apiVersion);
  }

  const queryString = params.toString();
  const joined = normalizedPath ? `${normalizedBase}/${normalizedPath}` : normalizedBase;
  return queryString ? `${joined}?${queryString}` : joined;
}

function normalizeAzurePath(path) {
  const raw = normalizeString(path);
  if (!raw) return '';
  return raw.replace(/^[\/]+/, '').replace(/\/{2,}/g, '/');
}
