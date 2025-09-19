import { DEFAULT_BASE_URL, resolveOpenAIBaseUrl } from './openai-url.js';

function normalizeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

export function getOpenAIConfig(overrides = {}) {
  const apiKey = normalizeString(overrides.apiKey ?? overrides.key ?? process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY);
  const baseCandidate = overrides.baseUrl ?? overrides.baseURL ?? process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE ?? DEFAULT_BASE_URL;
  const { baseUrl, version: detectedVersion, searchParams } = resolveOpenAIBaseUrl(baseCandidate, DEFAULT_BASE_URL);
  const queryString = searchParams?.toString() || '';
  const normalizedBase = queryString ? `${baseUrl}?${queryString}` : baseUrl;
  const organization = normalizeString(overrides.organization ?? overrides.org ?? process.env.OPENAI_ORGANIZATION ?? process.env.OPENAI_ORG_ID);
  const project = normalizeString(overrides.project ?? process.env.OPENAI_PROJECT_ID ?? process.env.OPENAI_PROJECT);
  const versionOverride = normalizeString(overrides.version ?? overrides.apiVersion ?? process.env.OPENAI_API_VERSION ?? '');
  const apiVersion = versionOverride || detectedVersion || undefined;
  return { apiKey, baseUrl: normalizedBase, organization, project, apiVersion };
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
