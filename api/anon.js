import {
  processAnonChildrenRequest,
  HttpError,
  getServiceConfig,
  supabaseRequest,
  fetchGrowthDataForAnonPrompt,
  formatGrowthSectionForAnonPrompt,
  formatDateForPrompt,
  normalizeCode,
} from '../lib/anon-children.js';
import { processAnonParentUpdatesRequest } from '../lib/anon-parent-updates.js';
import { processAnonFamilyRequest } from '../lib/anon-family.js';

const ACTION_MAP = {
  children: processAnonChildrenRequest,
  'parent-updates': processAnonParentUpdatesRequest,
  family: processAnonFamilyRequest,
};

const CHILD_MUTATION_ACTIONS = new Set(['create', 'update', 'delete']);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const PROMPT_SKIP_KEYS = new Set(['userComment', 'summary', 'ai_summary']);

async function resolveProfileIdByCode(code, { supaUrl, headers }) {
  if (!code) {
    throw new HttpError(400, 'Missing code');
  }
  const query = `${supaUrl}/rest/v1/profiles?select=id&code_unique=eq.${encodeURIComponent(code)}&limit=1`;
  const rows = await supabaseRequest(query, { headers });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || row.id == null) {
    throw new HttpError(404, 'Code not found');
  }
  return String(row.id);
}

function extractSupabaseMessage(err) {
  if (!(err instanceof HttpError)) {
    return 'Supabase error';
  }
  const details = err.details;
  if (typeof details === 'string' && details.trim()) {
    return details.trim();
  }
  if (details && typeof details === 'object') {
    if (typeof details.message === 'string' && details.message.trim()) return details.message.trim();
    if (typeof details.error_description === 'string' && details.error_description.trim()) {
      return details.error_description.trim();
    }
    if (typeof details.error === 'string' && details.error.trim()) {
      return details.error.trim();
    }
  }
  return err.message || 'Supabase error';
}

function normalizeChildMutationResult(result) {
  const status = Number.isInteger(result?.status) ? result.status : 500;
  const body = result?.body && typeof result.body === 'object' ? { ...result.body } : {};
  if (typeof body.error === 'string') {
    if (status === 400 && body.error === 'code required') {
      body.error = 'Missing code';
    } else if (status === 400 && body.error === 'Supabase error') {
      body.error = extractSupabaseMessage(new HttpError(status, body.error, body.details));
      delete body.details;
    }
  }
  return { status, body };
}

function parseUpdateContentForPrompt(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') {
    try {
      return JSON.parse(JSON.stringify(raw));
    } catch {
      return { ...raw };
    }
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
    return { summary: trimmed };
  }
  return {};
}

function sanitizeUpdatePayload(value, depth = 0) {
  if (depth > 3) return '[...]';
  if (typeof value === 'string') return value.slice(0, 400);
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => sanitizeUpdatePayload(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return value ?? {};
  const out = {};
  const entries = Object.entries(value).slice(0, 20);
  for (const [key, val] of entries) {
    out[key] = sanitizeUpdatePayload(val, depth + 1);
  }
  return out;
}

function formatUpdateDataForPrompt(value, depth = 0) {
  if (depth > 3 || value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.slice(0, 400);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 6)
      .map((entry) => formatUpdateDataForPrompt(entry, depth + 1))
      .filter(Boolean);
    return items.join(' | ');
  }
  if (typeof value === 'object') {
    const parts = [];
    const entries = Object.entries(value).slice(0, 15);
    for (const [key, val] of entries) {
      if (PROMPT_SKIP_KEYS.has(key)) continue;
      const text = formatUpdateDataForPrompt(val, depth + 1);
      if (text) parts.push(`${key}: ${text}`);
    }
    return parts.join(' ; ');
  }
  return '';
}

function buildChildUpdateEntries(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row) return null;
      const aiSummary = typeof row.ai_summary === 'string' ? row.ai_summary.trim().slice(0, 600) : '';
      const parsed = parseUpdateContentForPrompt(row.update_content);
      const parentSummary = typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 600) : '';
      const userComment = typeof parsed?.userComment === 'string' ? parsed.userComment.trim().slice(0, 600) : '';
      const snapshotSource = parsed && typeof parsed === 'object'
        ? (parsed.next && typeof parsed.next === 'object' ? parsed.next : parsed)
        : {};
      const sanitized = sanitizeUpdatePayload(snapshotSource);
      const detailText = formatUpdateDataForPrompt(sanitized).slice(0, 1200);
      return {
        type: typeof row.update_type === 'string' ? row.update_type.trim().slice(0, 64) : '',
        date: typeof row.created_at === 'string' ? row.created_at : '',
        aiSummary,
        parentSummary,
        userComment,
        detailText,
        id: row.id,
      };
    })
    .filter(Boolean);
}

function buildUpdatesPrompt(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return '';
  return entries
    .map((item, idx) => {
      const lines = [];
      const headerParts = [`Mise à jour ${idx + 1}`];
      const dateText = formatDateForPrompt(item.date);
      if (dateText) headerParts.push(`date: ${dateText}`);
      if (item.type) headerParts.push(`type: ${item.type}`);
      lines.push(headerParts.join(' – '));
      if (item.aiSummary) lines.push(`Résumé IA: ${item.aiSummary}`);
      if (item.parentSummary && item.parentSummary !== item.aiSummary) {
        lines.push(`Résumé parent: ${item.parentSummary}`);
      }
      if (item.detailText) lines.push(`Données: ${item.detailText}`);
      if (item.userComment) lines.push(`Commentaire parent: ${item.userComment}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

async function generateChildBilan({ code, childId }) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) {
    return { status: 400, body: { error: 'Missing code' } };
  }
  const safeChildId = typeof childId === 'string' ? childId.trim() : '';
  if (!safeChildId) {
    return { status: 400, body: { error: 'Missing childId' } };
  }
  if (!OPENAI_API_KEY) {
    return { status: 503, body: { error: 'AI unavailable' } };
  }
  try {
    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    let profileId;
    try {
      profileId = await resolveProfileIdByCode(normalizedCode, { supaUrl, headers });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        return { status: 404, body: { error: 'Code not found' } };
      }
      if (err instanceof HttpError && err.status === 400) {
        return { status: 400, body: { error: 'Missing code' } };
      }
      throw err;
    }

    let childRow;
    try {
      const childRows = await supabaseRequest(
        `${supaUrl}/rest/v1/children?select=id&user_id=eq.${encodeURIComponent(profileId)}&id=eq.${encodeURIComponent(safeChildId)}&limit=1`,
        { headers }
      );
      childRow = Array.isArray(childRows) ? childRows[0] : childRows;
    } catch (err) {
      return { status: 400, body: { error: extractSupabaseMessage(err) } };
    }
    if (!childRow || !childRow.id) {
      return { status: 404, body: { error: 'Child not found' } };
    }

    let updateRows = [];
    try {
      const data = await supabaseRequest(
        `${supaUrl}/rest/v1/child_updates?select=id,update_type,update_content,ai_summary,created_at&child_id=eq.${encodeURIComponent(safeChildId)}&order=created_at.asc`,
        { headers }
      );
      updateRows = Array.isArray(data) ? data : [];
    } catch (err) {
      return { status: 400, body: { error: extractSupabaseMessage(err) } };
    }
    const entries = buildChildUpdateEntries(updateRows);
    if (!entries.length) {
      return { status: 404, body: { error: 'No updates found' } };
    }
    const updatesPrompt = buildUpdatesPrompt(entries);
    if (!updatesPrompt) {
      return { status: 404, body: { error: 'No updates found' } };
    }

    let growthSection = 'Pas de données disponibles';
    try {
      const growthData = await fetchGrowthDataForAnonPrompt(supaUrl, headers, safeChildId, { measurementLimit: 3, teethLimit: 3 });
      const formatted = formatGrowthSectionForAnonPrompt(growthData);
      if (formatted) growthSection = formatted;
    } catch (err) {
      console.warn('[api/anon] unable to fetch growth data for bilan', err);
    }

    const system = "Tu es Ped’IA, assistant parental. À partir des observations fournies, rédige un bilan complet en français (maximum 500 mots). Structure ta réponse avec exactement les sections suivantes : Croissance (taille, poids, dents), Sommeil, Alimentation, Jalons de développement, Remarques parentales, Recommandations pratiques. Utilise uniquement les données réelles transmises. Pour chaque section sans information fiable, écris « Pas de données disponibles ». Valorise les données de croissance fournies pour analyser taille, poids et dents par rapport à l’âge de l’enfant. Sois synthétique, factuel et accessible.";
    const userPrompt = [
      `Nombre de mises à jour: ${entries.length}.`,
      `Section Croissance:\n${growthSection || 'Pas de données disponibles'}`,
      `Données réelles des mises à jour (ordre chronologique, de la plus ancienne à la plus récente):\n\n${updatesPrompt}`,
    ].join('\n\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      console.warn('[api/anon] OpenAI child bilan error', response.status, details);
      return { status: 502, body: { error: 'AI unavailable' } };
    }
    const json = await response.json().catch(() => null);
    const summary = json?.choices?.[0]?.message?.content?.trim();
    if (!summary) {
      return { status: 502, body: { error: 'AI unavailable' } };
    }

    const latestEntry = entries[entries.length - 1];
    if (latestEntry?.id) {
      try {
        await supabaseRequest(
          `${supaUrl}/rest/v1/child_updates?id=eq.${encodeURIComponent(latestEntry.id)}`,
          {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({ ai_summary: summary.slice(0, 1200) }),
          }
        );
      } catch (err) {
        console.warn('[api/anon] unable to persist child bilan summary', err);
        return { status: 400, body: { error: extractSupabaseMessage(err) } };
      }
    }

    return { status: 200, body: { childId: safeChildId, summary: summary.slice(0, 1200) } };
  } catch (err) {
    console.error('[api/anon] child bilan failure', err);
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message || 'Server error' } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err?.message || err) } };
  }
}

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
      if (actionInfo.namespace === 'child' && actionInfo.operation === 'bilan') {
        result = await generateChildBilan(mergedBody);
      } else if (actionInfo.namespace === 'children' && CHILD_MUTATION_ACTIONS.has(actionInfo.operation)) {
        const raw = await actionInfo.handler(mergedBody);
        result = normalizeChildMutationResult(raw);
      } else {
        result = await actionInfo.handler(mergedBody);
      }
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
