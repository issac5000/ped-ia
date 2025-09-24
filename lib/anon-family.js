import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  getActionPayload,
  normalizeCode,
  normalizeChildId,
  parseInteger,
  supabaseRequest,
  buildHttpErrorResponse,
} from './anon-children.js';
import { buildProfileResponse } from './anon-profile.js';
import {
  fetchFamilyContextRow,
  fetchParentUpdates,
  fetchProfileDetails,
} from './anon-parent-updates.js';

async function fetchChildrenForProfile(supaUrl, headers, profileId) {
  const rows = await supabaseRequest(
    `${supaUrl}/rest/v1/children?select=id,first_name,sex,dob,birthdate,is_primary,created_at,updated_at&user_id=eq.${encodeURIComponent(profileId)}&order=created_at.asc`,
    { headers }
  );
  return Array.isArray(rows) ? rows : [];
}

async function fetchChildForProfile(supaUrl, headers, profileId, childId) {
  const safeChildId = normalizeChildId(childId);
  const rows = await supabaseRequest(
    `${supaUrl}/rest/v1/children?select=*&id=eq.${encodeURIComponent(safeChildId)}&user_id=eq.${encodeURIComponent(profileId)}&limit=1`,
    { headers }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new HttpError(404, 'Child not found');
  if (String(row.user_id) !== String(profileId)) throw new HttpError(403, 'Forbidden');
  return row;
}

export async function processAnonFamilyRequest(body) {
  try {
    const action = String(body?.action || '').trim();
    if (!action) throw new HttpError(400, 'Paramètre manquant: action');
    const code = normalizeCode(body?.code || body?.code_unique);
    if (!code) throw new HttpError(400, 'Code non reconnu');
    const payload = getActionPayload(body);

    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = profile?.id;
    if (!profileId) throw new HttpError(400, 'Code non reconnu');

    if (action === 'overview') {
      const includeChildren = payload?.includeChildren !== false;
      const includeParentUpdates = payload?.includeParentUpdates !== false;
      const includeFamilyContext = payload?.includeFamilyContext !== false;
      const updatesLimitCandidate = parseInteger(payload?.updatesLimit ?? payload?.limit);
      const updatesLimit = updatesLimitCandidate == null
        ? 12
        : Math.max(1, Math.min(50, updatesLimitCandidate));

      const tasks = [];
      tasks.push(fetchProfileDetails(supaUrl, headers, profileId).catch(() => null));
      tasks.push(
        includeChildren
          ? fetchChildrenForProfile(supaUrl, headers, profileId).catch(() => [])
          : Promise.resolve([])
      );
      tasks.push(
        includeParentUpdates
          ? fetchParentUpdates(supaUrl, headers, profileId, updatesLimit).catch(() => [])
          : Promise.resolve([])
      );
      tasks.push(
        includeFamilyContext
          ? fetchFamilyContextRow(supaUrl, headers, profileId).catch(() => null)
          : Promise.resolve(null)
      );

      const [profileRow, childrenRows, parentUpdates, familyContext] = await Promise.all(tasks);
      return {
        status: 200,
        body: {
          profile: buildProfileResponse({ updated: profileRow || {}, existing: profile, code }),
          children: includeChildren && Array.isArray(childrenRows) ? childrenRows : [],
          parentUpdates: includeParentUpdates && Array.isArray(parentUpdates) ? parentUpdates : [],
          familyContext: includeFamilyContext ? familyContext || null : null,
        },
      };
    }

    if (action === 'growth-status') {
      const childId = normalizeChildId(payload?.childId ?? payload?.child_id ?? payload?.id);
      await fetchChildForProfile(supaUrl, headers, profileId, childId);
      const limitCandidate = parseInteger(payload?.limit);
      const safeLimit = limitCandidate == null
        ? 20
        : Math.max(1, Math.min(50, limitCandidate));
      const baseUrl = `${supaUrl}/rest/v1/child_growth_with_status?select=*&child_id=eq.${encodeURIComponent(childId)}&limit=${safeLimit}`;
      const attempts = [
        '&order=measured_at.desc.nullslast',
        '&order=recorded_at.desc.nullslast',
        '&order=created_at.desc',
        '',
      ];
      let rows = [];
      let lastError = null;
      for (const suffix of attempts) {
        try {
          const data = await supabaseRequest(`${baseUrl}${suffix}`, { headers });
          rows = Array.isArray(data) ? data : [];
          if (rows.length || suffix === '') break;
        } catch (err) {
          lastError = err;
          if (suffix === '') throw err;
        }
      }
      const bodyPayload = { rows };
      if ((!rows || rows.length === 0) && lastError instanceof HttpError && [401, 403].includes(lastError.status)) {
        bodyPayload.notice = {
          status: 'unavailable',
          message: 'Impossible de récupérer les repères OMS pour le moment. Réessayez plus tard ou contactez le support.'
        };
      }
      return { status: 200, body: bodyPayload };
    }

    throw new HttpError(400, 'Action inconnue');
  } catch (err) {
    if (!(err instanceof HttpError) || (err.status && err.status >= 500)) {
      console.error('[anon-family] request error', err);
    }
    return buildHttpErrorResponse(err);
  }
}
