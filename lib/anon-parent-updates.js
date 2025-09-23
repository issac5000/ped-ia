import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  getActionPayload,
  normalizeCode,
  supabaseRequest,
} from './anon-children.js';
import {
  buildProfileResponse,
  buildProfileUpdatePayload,
  sanitizeParentUpdateRow,
} from './anon-profile.js';

export const PROFILE_SELECT = [
  'id',
  'code_unique',
  'full_name',
  'avatar_url',
  'parent_role',
  'show_children_count',
  'marital_status',
  'number_of_children',
  'parental_employment',
  'parental_emotion',
  'parental_stress',
  'parental_fatigue',
  'context_parental',
  'user_id',
].join(',');

export async function fetchProfileDetails(supaUrl, headers, profileId) {
  const rows = await supabaseRequest(
    `${supaUrl}/rest/v1/profiles?select=${PROFILE_SELECT}&id=eq.${encodeURIComponent(profileId)}&limit=1`,
    { headers }
  );
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function fetchParentUpdates(supaUrl, headers, profileId, limit = 12) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const rows = await supabaseRequest(
    `${supaUrl}/rest/v1/parent_updates?select=id,update_type,update_content,parent_comment,ai_commentaire,created_at&profile_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=${safeLimit}`,
    { headers }
  );
  return Array.isArray(rows) ? rows : [];
}

export async function fetchFamilyContextRow(supaUrl, headers, profileId) {
  const rows = await supabaseRequest(
    `${supaUrl}/rest/v1/family_context?select=ai_bilan,last_generated_at,children_ids&profile_id=eq.${encodeURIComponent(profileId)}&order=last_generated_at.desc&limit=1`,
    { headers }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  return {
    ai_bilan: typeof row.ai_bilan === 'string' ? row.ai_bilan : '',
    last_generated_at: row.last_generated_at || row.lastGeneratedAt || null,
    children_ids: Array.isArray(row.children_ids)
      ? row.children_ids
      : Array.isArray(row.childrenIds)
        ? row.childrenIds
        : null,
  };
}

export async function processAnonParentUpdatesRequest(body) {
  try {
    const action = String(body?.action || '').trim();
    if (!action) throw new HttpError(400, 'action required');
    const code = normalizeCode(body?.code || body?.code_unique);
    if (!code) throw new HttpError(400, 'code required');

    const payload = getActionPayload(body);
    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = profile?.id;
    if (!profileId) throw new HttpError(404, 'Profile not found');

    if (action === 'profile') {
      const profileRow = await fetchProfileDetails(supaUrl, headers, profileId);
      return { status: 200, body: { profile: buildProfileResponse({ updated: profileRow, existing: profile, code }) } };
    }

    if (action === 'list') {
      const limit = payload?.limit ?? payload?.updatesLimit;
      const [profileRow, updates, familyContext] = await Promise.all([
        fetchProfileDetails(supaUrl, headers, profileId).catch(() => null),
        fetchParentUpdates(supaUrl, headers, profileId, limit).catch(() => []),
        fetchFamilyContextRow(supaUrl, headers, profileId).catch(() => null),
      ]);
      return {
        status: 200,
        body: {
          profile: buildProfileResponse({ updated: profileRow || {}, existing: profile, code }),
          parentUpdates: Array.isArray(updates) ? updates : [],
          familyContext: familyContext || null,
        },
      };
    }

    if (action === 'update-profile') {
      const updateSource = payload?.profileUpdate || payload?.profile_update || payload || {};
      const updatePayload = buildProfileUpdatePayload(updateSource);
      const parentUpdateRaw = payload?.parentUpdate || payload?.parent_update || null;
      const jsonHeaders = {
        ...headers,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      };
      let updatedRow = null;
      if (Object.keys(updatePayload).length) {
        const rows = await supabaseRequest(
          `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}`,
          {
            method: 'PATCH',
            headers: jsonHeaders,
            body: JSON.stringify(updatePayload),
          }
        );
        updatedRow = Array.isArray(rows) ? rows[0] : rows;
      } else {
        updatedRow = await fetchProfileDetails(supaUrl, headers, profileId).catch(() => profile);
      }

      if (!updatedRow) {
        updatedRow = { id: profileId, ...updatePayload };
      }

      if (!updatedRow.full_name && !updatePayload.full_name && !profile.full_name) {
        throw new HttpError(400, 'full_name required');
      }

      if (parentUpdateRaw) {
        const sanitizedRow = sanitizeParentUpdateRow(parentUpdateRaw, profileId);
        if (sanitizedRow) {
          await supabaseRequest(`${supaUrl}/rest/v1/parent_updates`, {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify(sanitizedRow),
          });
        }
      }

      return {
        status: 200,
        body: {
          profile: buildProfileResponse({ updated: updatedRow, existing: profile, code }),
        },
      };
    }

    throw new HttpError(400, 'Unknown action');
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message, details: err.details } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err?.message || err) } };
  }
}
