const DEFAULT_BASE_URL = 'https://api.openai.com';
const VERSION_PATH_REGEX = /\/v\d+(?:\/|$)/i;
const VERSION_PREFIX_REGEX = /^\/v\d+/i;

function normalizeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

function normalizeBaseUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return DEFAULT_BASE_URL;

  const trimmed = raw.replace(/\/+$/, '');
  const lower = trimmed.toLowerCase();
  const versionMatch = lower.match(/\/v\d+$/);
  if (versionMatch) {
    const withoutVersion = trimmed.slice(0, -versionMatch[0].length).replace(/\/+$/, '');
    return withoutVersion || DEFAULT_BASE_URL;
  }

  return trimmed || DEFAULT_BASE_URL;
}

function baseHasExplicitVersion(baseUrl) {
  if (!baseUrl) return false;
  try {
    const parsed = new URL(baseUrl);
    return VERSION_PATH_REGEX.test(parsed.pathname.toLowerCase());
  } catch {
    return VERSION_PATH_REGEX.test(String(baseUrl).toLowerCase());
  }
}

export function getOpenAIConfig(overrides = {}) {
  const apiKey = normalizeString(
    overrides.apiKey ?? overrides.key ?? process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY
  );
  const baseCandidate =
    overrides.baseUrl ??
    overrides.baseURL ??
    process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE ??
    DEFAULT_BASE_URL;
  const baseUrl = normalizeBaseUrl(baseCandidate);
  const organization = normalizeString(
    overrides.organization ?? overrides.org ?? process.env.OPENAI_ORGANIZATION ?? process.env.OPENAI_ORG_ID
  );
  const project = normalizeString(overrides.project ?? process.env.OPENAI_PROJECT_ID ?? process.env.OPENAI_PROJECT);
  return { apiKey, baseUrl, organization, project };
}

export function buildOpenAIHeaders(config, extraHeaders = {}) {
  if (!config || !config.apiKey) {
    throw new Error('Missing OpenAI API key');
  }
  const headers = { ...extraHeaders, Authorization: `Bearer ${config.apiKey}` };
  const lowerKeys = Object.keys(headers).map((k) => k.toLowerCase());
  if (!lowerKeys.includes('content-type')) headers['Content-Type'] = 'application/json';
  if (config.organization) headers['OpenAI-Organization'] = config.organization;
  if (config.project) headers['OpenAI-Project'] = config.project;
  return headers;
}

export function buildOpenAIUrl(configOrBase, path) {
  if (path == null) {
    throw new Error('Path is required to build OpenAI URL');
  }

  const baseCandidate = typeof configOrBase === 'string'
    ? configOrBase
    : configOrBase?.baseUrl ?? configOrBase?.baseURL;
  const baseUrl = normalizeBaseUrl(baseCandidate);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (baseHasExplicitVersion(baseUrl)) {
    const stripped = normalizedPath.replace(VERSION_PREFIX_REGEX, '') || '/';
    return `${baseUrl}${stripped.startsWith('/') ? stripped : `/${stripped}`}`;
  }

  return `${baseUrl}${normalizedPath}`;
}

export { normalizeBaseUrl };
