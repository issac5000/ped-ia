import { processAnonChildrenRequest } from '../lib/anon-children.js';
import { processAnonParentUpdatesRequest } from '../lib/anon-parent-updates.js';
import { processAnonFamilyRequest } from '../lib/anon-family.js';

const ACTION_MAP = {
  children: processAnonChildrenRequest,
  'parent-updates': processAnonParentUpdatesRequest,
  family: processAnonFamilyRequest,
};

function normalizeQueryValue(value) {
  if (Array.isArray(value)) return value.find((entry) => typeof entry === 'string') ?? '';
  return typeof value === 'string' ? value : '';
}

async function readJsonBody(req) {
  let bodyRaw = '';
  for await (const chunk of req) bodyRaw += chunk;
  if (!bodyRaw) return {};
  try {
    const parsed = JSON.parse(bodyRaw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    throw new Error('Invalid JSON body');
  }
}

function mergeQueryIntoBody(body, query) {
  const merged = { ...(body && typeof body === 'object' ? body : {}) };
  if (!query || typeof query !== 'object') return merged;
  for (const [key, value] of Object.entries(query)) {
    if (key === 'action') continue;
    if (merged[key] != null) continue;
    merged[key] = normalizeQueryValue(value);
  }
  return merged;
}

function extractAction(req, body) {
  const fromQuery = normalizeQueryValue(req.query?.action);
  const actionRaw = (fromQuery || normalizeQueryValue(body?.action)).trim();
  if (!actionRaw) return null;
  const [namespace, ...rest] = actionRaw.split('.');
  if (!namespace || !rest.length) return null;
  const operation = rest.join('.').trim();
  if (!operation) return null;
  const handler = ACTION_MAP[namespace];
  if (!handler) return null;
  return { handler, namespace, operation };
}

function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  try {
    const body = req.method === 'GET' ? {} : await readJsonBody(req);
    const mergedBody = mergeQueryIntoBody(body, req.query);
    const actionInfo = extractAction(req, mergedBody);
    if (!actionInfo) {
      return json(res, 400, { error: 'Unknown action' });
    }
    mergedBody.action = actionInfo.operation;
    let result;
    try {
      result = await actionInfo.handler(mergedBody);
    } catch (err) {
      console.error('[api/anon] handler failed', err);
      return json(res, 500, { error: 'Server error', details: String(err?.message || err) });
    }
    const status = Number.isInteger(result?.status) ? result.status : 500;
    const payload = result?.body && typeof result.body === 'object' ? result.body : {};
    return json(res, status, payload);
  } catch (err) {
    const details = String(err?.message || err);
    if (details === 'Invalid JSON body') {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
    console.error('[api/anon] unexpected error', err);
    return json(res, 500, { error: 'Server error', details });
  }
}
