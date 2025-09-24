import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  supabaseRequest,
} from './anon-children.js';
import { processAnonParentUpdatesRequest } from './anon-parent-updates.js';

export async function processAnonFamilyRequest(body) {
  try {
    const action = String(body?.action || body?.type || 'overview').trim() || 'overview';
    const code = normalizeCode(body?.code || body?.code_unique);
    if (!code) throw new HttpError(400, 'code required');

    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = profile?.id;
    if (!profileId) throw new HttpError(404, 'Code non reconnu');

    if (action === 'overview') {
      let childrenRows = [];
      try {
        const data = await supabaseRequest(
          `${supaUrl}/rest/v1/children?select=id,first_name,sex,dob,is_primary&user_id=eq.${encodeURIComponent(profileId)}&order=created_at.asc`,
          { headers }
        );
        childrenRows = Array.isArray(data) ? data : [];
      } catch (err) {
        childrenRows = [];
      }

      const parentResult = await processAnonParentUpdatesRequest({ action: 'list', code, limit: body?.limit });
      const parentBody = parentResult?.body || {};

      return {
        status: 200,
        body: {
          children: childrenRows,
          profile: parentBody.profile || null,
          parentUpdates: parentBody.parentUpdates || [],
          familyContext: parentBody.familyContext || null,
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
