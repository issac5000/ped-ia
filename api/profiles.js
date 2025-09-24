import { randomBytes, randomUUID } from 'crypto';
import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
} from '../lib/anon-children.js';
import {
  buildProfileResponse,
  buildProfileUpdatePayload,
  extractAnonCode,
  sanitizeParentUpdateRow,
} from '../lib/anon-profile.js';
import { fetchProfileDetails } from '../lib/anon-parent-updates.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
const MAX_CREATE_ATTEMPTS = 5;

function generateAnonCode() {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    const alphabet = i % 2 === 0 ? CODE_LETTERS : CODE_DIGITS;
    const index = bytes[i] % alphabet.length;
    out += alphabet[index];
  }
  return out;
}

function shouldRetryDuplicate(status, detailsText) {
  if (status === 409) return true;
  if (!detailsText) return false;
  return /duplicate key value/i.test(detailsText) && /code_unique/i.test(detailsText);
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

function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(payload);
}

function isMethodWithBody(method) {
  return method !== 'GET' && method !== 'HEAD';
}

async function handleCreateAnon(body) {
  try {
    const { supaUrl, serviceKey } = getServiceConfig();
    const payload = body && typeof body === 'object' ? body : {};
    const fullNameRaw = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
    const basePayload = {};
    if (fullNameRaw) basePayload.full_name = fullNameRaw.slice(0, 120);

    let lastError = null;
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const insertPayload = {
        ...basePayload,
        id: randomUUID(),
        code_unique: generateAnonCode(),
      };
      const response = await fetch(`${supaUrl}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(insertPayload),
      });
      const text = await response.text().catch(() => '');
      let json = null;
      if (text) {
        try { json = JSON.parse(text); } catch {}
      }
      if (response.ok) {
        const row = Array.isArray(json) ? json?.[0] : json;
        const id = row?.id || insertPayload.id;
        const code = row?.code_unique || insertPayload.code_unique;
        if (!id || !code) {
          return { status: 500, body: { error: 'Invalid response from Supabase' } };
        }
        const profile = {
          id,
          code_unique: code,
          full_name: row?.full_name || basePayload.full_name || '',
          user_id: row?.user_id ?? null,
        };
        return { status: 200, body: { profile } };
      }
      const detailsText = json ? JSON.stringify(json) : text;
      if (shouldRetryDuplicate(response.status, detailsText)) {
        lastError = { status: response.status, details: detailsText };
        continue;
      }
      return {
        status: response.status || 500,
        body: { error: 'Create failed', details: detailsText || undefined },
      };
    }
    return {
      status: lastError?.status || 500,
      body: { error: 'Create failed', details: lastError?.details },
    };
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message, details: err.details } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err?.message || err) } };
  }
}

async function handleUpdateAnon(body) {
  try {
    const { supaUrl, serviceKey } = getServiceConfig();
    const payload = body && typeof body === 'object' ? body : {};
    const code = extractAnonCode(payload);
    if (!code) {
      return { status: 400, body: { error: 'code_unique is required' } };
    }
    const updatePayload = buildProfileUpdatePayload(payload.profileUpdate || payload);
    const parentUpdateRaw = payload.parentUpdate || payload.parent_update || null;

    const profileQuery = `${supaUrl}/rest/v1/profiles?select=id,user_id,code_unique,full_name,avatar_url,parent_role,show_children_count,marital_status,number_of_children,parental_employment,parental_emotion,parental_stress,parental_fatigue,context_parental&code_unique=eq.${encodeURIComponent(code)}&limit=1`;
    const profileRes = await fetch(profileQuery, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    if (!profileRes.ok) {
      const details = await profileRes.text().catch(() => '');
      return {
        status: 500,
        body: { error: 'Failed to fetch profile', details: details || undefined },
      };
    }

    const existingList = await profileRes.json().catch(() => []);
    const existing = Array.isArray(existingList) ? existingList[0] : existingList;
    if (existing) {
      if (existing.user_id) {
        return { status: 403, body: { error: 'Only anonymous profiles can update via code' } };
      }
      if (!existing.full_name && !updatePayload.full_name && !payload.fullName) {
        return { status: 400, body: { error: 'full_name is required' } };
      }
      let updatedRow = existing;
      if (Object.keys(updatePayload).length) {
        const updateUrl = `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(existing.id)}`;
        const updateRes = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(updatePayload),
        });
        const updateText = await updateRes.text().catch(() => '');
        let updateJson = null;
        if (updateText) {
          try {
            updateJson = JSON.parse(updateText);
          } catch (e) {
            console.error('updateAnon invalid JSON response', e);
          }
        }
        if (!updateRes.ok) {
          return {
            status: updateRes.status,
            body: { error: 'Update failed', details: updateText || undefined },
          };
        }
        const updated = Array.isArray(updateJson) ? updateJson[0] : updateJson;
        if (!updated) {
          return { status: 500, body: { error: 'Update succeeded but no data returned' } };
        }
        updatedRow = updated;
      }
      if (parentUpdateRaw) {
        const sanitizedRow = sanitizeParentUpdateRow(parentUpdateRaw, existing.id);
        if (sanitizedRow) {
          const insertRes = await fetch(`${supaUrl}/rest/v1/parent_updates`, {
            method: 'POST',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=representation',
            },
            body: JSON.stringify(sanitizedRow),
          });
          if (!insertRes.ok) {
            const details = await insertRes.text().catch(() => '');
            return {
              status: insertRes.status,
              body: { error: 'Parent update failed', details: details || undefined },
            };
          }
        }
      }
      const profile = buildProfileResponse({ updated: updatedRow, existing, code });
      return { status: 200, body: { profile } };
    }

    if (!Object.prototype.hasOwnProperty.call(updatePayload, 'full_name') || typeof updatePayload.full_name !== 'string' || !updatePayload.full_name.trim()) {
      return { status: 400, body: { error: 'full_name is required' } };
    }
    const insertPayload = {
      ...updatePayload,
      id: randomUUID(),
      code_unique: code,
      user_id: null,
    };
    const insertRes = await fetch(`${supaUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(insertPayload),
    });
    const insertText = await insertRes.text().catch(() => '');
    let insertJson = null;
    if (insertText) {
      try {
        insertJson = JSON.parse(insertText);
      } catch (e) {
        console.error('updateAnon invalid insert JSON response', e);
      }
    }
    if (!insertRes.ok) {
      return {
        status: insertRes.status,
        body: { error: 'Insert failed', details: insertText || undefined },
      };
    }
    const created = Array.isArray(insertJson) ? insertJson[0] : insertJson;
    if (!created) {
      return { status: 500, body: { error: 'Insert succeeded but no data returned' } };
    }
    if (parentUpdateRaw) {
      const sanitizedRow = sanitizeParentUpdateRow(parentUpdateRaw, created.id || insertPayload.id);
      if (sanitizedRow) {
        const parentInsertRes = await fetch(`${supaUrl}/rest/v1/parent_updates`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(sanitizedRow),
        });
        if (!parentInsertRes.ok) {
          const details = await parentInsertRes.text().catch(() => '');
          return {
            status: parentInsertRes.status,
            body: { error: 'Parent update failed', details: details || undefined },
          };
        }
      }
    }
    const profile = buildProfileResponse({ updated: created, existing: { code_unique: code }, code });
    return { status: 200, body: { profile } };
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message, details: err.details } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err?.message || err) } };
  }
}

async function handleByCode(body) {
  try {
    const payload = body && typeof body === 'object' ? body : {};
    const rawCode = payload.code || payload.code_unique || payload.codeUnique || '';
    const code = normalizeCode(rawCode);
    if (!code) {
      return { status: 400, body: { error: 'code required' } };
    }
    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    let profile;
    try {
      profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    } catch (err) {
      const status = err?.status || 404;
      const message = status === 403 ? 'Code not found' : err?.message || 'Code not found';
      return {
        status: status === 403 ? 404 : status,
        body: { error: message },
      };
    }
    if (!profile?.id) {
      return { status: 404, body: { error: 'Code not found' } };
    }
    const profileRow = await fetchProfileDetails(supaUrl, headers, profile.id).catch(() => null);
    const response = buildProfileResponse({ updated: profileRow || {}, existing: profile, code });
    return { status: 200, body: { profile: response } };
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message, details: err.details } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err?.message || err) } };
  }
}

const ACTION_HANDLERS = {
  'create-anon': { methods: ['POST'], handler: handleCreateAnon },
  'update-anon': { methods: ['POST', 'PATCH'], handler: handleUpdateAnon },
  'by-code': { methods: ['GET', 'POST'], handler: handleByCode },
};

export { handleCreateAnon, handleUpdateAnon, handleByCode };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const actionRaw = normalizeQueryValue(req.query?.action).trim();
  const hasBody = isMethodWithBody(req.method);
  let body;
  try {
    body = hasBody ? await readJsonBody(req) : {};
  } catch (err) {
    return json(res, 400, { error: 'Invalid JSON body' });
  }
  const mergedBody = mergeQueryIntoBody(body, req.query);
  const action = (actionRaw || normalizeQueryValue(mergedBody?.action)).trim();
  if (!action) {
    return json(res, 400, { error: 'Unknown action' });
  }
  const config = ACTION_HANDLERS[action];
  if (!config) {
    return json(res, 400, { error: 'Unknown action' });
  }
  if (!config.methods.includes(req.method)) {
    res.setHeader('Allow', config.methods.concat('OPTIONS').join(','));
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  const effectiveBody = { ...(mergedBody && typeof mergedBody === 'object' ? mergedBody : {}) };
  const result = await config.handler(effectiveBody);
  const status = Number.isInteger(result?.status) ? result.status : 500;
  const payload = result?.body && typeof result.body === 'object' ? result.body : {};
  return json(res, status, payload);
}
