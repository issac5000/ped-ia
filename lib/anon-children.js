const CHILD_TEXT_FIELDS = [
  'context_allergies',
  'context_history',
  'context_care',
  'context_languages',
  'sleep_falling',
  'sleep_night_wakings',
  'sleep_wake_duration',
];

class HttpError extends Error {
  constructor(status, message, details) {
    super(message || 'Error');
    this.status = status;
    this.details = details;
  }
}

function getServiceConfig() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!supaUrl || !serviceKey) {
    throw new HttpError(500, 'Server misconfigured');
  }
  return { supaUrl, serviceKey };
}

function normalizeCode(raw) {
  if (!raw) return '';
  const code = String(raw).trim().toUpperCase();
  return code;
}

async function supabaseRequest(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text().catch(() => '');
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch {}
  }
  if (!res.ok) {
    throw new HttpError(res.status, 'Supabase error', json ?? text);
  }
  return json;
}

function normalizeString(raw, max = 500, { allowNull = false } = {}) {
  if (raw == null) return allowNull ? null : '';
  const str = String(raw).trim();
  if (!str && allowNull) return null;
  return str.slice(0, max);
}

function normalizeBoolean(raw) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'oui'].includes(v)) return true;
    if (['0', 'false', 'no', 'non'].includes(v)) return false;
  }
  return false;
}

function normalizeMilestones(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 120).map(v => !!v);
}

function sanitizeChildInsert(raw, profileId) {
  if (!raw || typeof raw !== 'object') raw = {};
  const payload = {
    user_id: profileId,
    first_name: normalizeString(raw.first_name ?? raw.firstName ?? '', 120),
    sex: normalizeString(raw.sex ?? '', 20),
    dob: normalizeString(raw.dob ?? '', 32),
    photo_url: normalizeString(raw.photo_url ?? raw.photoUrl ?? raw.photo ?? '', 2048, { allowNull: true }),
    feeding_type: normalizeString(raw.feeding_type ?? raw.feedingType ?? '', 120),
    eating_style: normalizeString(raw.eating_style ?? raw.eatingStyle ?? '', 120),
    sleep_sleeps_through: normalizeBoolean(raw.sleep_sleeps_through ?? raw.sleepSleepsThrough),
    sleep_bedtime: normalizeString(raw.sleep_bedtime ?? raw.sleepBedtime ?? '', 16, { allowNull: true }),
    milestones: normalizeMilestones(raw.milestones),
    is_primary: !!raw.is_primary,
  };
  CHILD_TEXT_FIELDS.forEach(key => {
    const altKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    payload[key] = normalizeString(raw[key] ?? raw[altKey] ?? '', 500);
  });
  return payload;
}

function sanitizeChildUpdate(raw) {
  const payload = {};
  if (!raw || typeof raw !== 'object') return payload;
  if (Object.prototype.hasOwnProperty.call(raw, 'first_name') || Object.prototype.hasOwnProperty.call(raw, 'firstName')) {
    payload.first_name = normalizeString(raw.first_name ?? raw.firstName ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sex')) {
    payload.sex = normalizeString(raw.sex ?? '', 20);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'dob')) {
    payload.dob = normalizeString(raw.dob ?? '', 32);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'photo_url') || Object.prototype.hasOwnProperty.call(raw, 'photoUrl') || Object.prototype.hasOwnProperty.call(raw, 'photo')) {
    payload.photo_url = normalizeString(raw.photo_url ?? raw.photoUrl ?? raw.photo ?? '', 2048, { allowNull: true });
  }
  CHILD_TEXT_FIELDS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      payload[key] = normalizeString(raw[key], 500);
    } else {
      const altKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (Object.prototype.hasOwnProperty.call(raw, altKey)) {
        payload[key] = normalizeString(raw[altKey], 500);
      }
    }
  });
  if (Object.prototype.hasOwnProperty.call(raw, 'feeding_type') || Object.prototype.hasOwnProperty.call(raw, 'feedingType')) {
    payload.feeding_type = normalizeString(raw.feeding_type ?? raw.feedingType ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'eating_style') || Object.prototype.hasOwnProperty.call(raw, 'eatingStyle')) {
    payload.eating_style = normalizeString(raw.eating_style ?? raw.eatingStyle ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sleep_sleeps_through') || Object.prototype.hasOwnProperty.call(raw, 'sleepSleepsThrough')) {
    payload.sleep_sleeps_through = normalizeBoolean(raw.sleep_sleeps_through ?? raw.sleepSleepsThrough);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sleep_bedtime') || Object.prototype.hasOwnProperty.call(raw, 'sleepBedtime')) {
    payload.sleep_bedtime = normalizeString(raw.sleep_bedtime ?? raw.sleepBedtime ?? '', 16, { allowNull: true });
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'milestones')) {
    payload.milestones = normalizeMilestones(raw.milestones);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'is_primary')) {
    payload.is_primary = !!raw.is_primary;
  }
  return payload;
}

function normalizeMonth(value) {
  const month = Number(value);
  if (!Number.isInteger(month)) return null;
  return month;
}

function buildMeasurementRecords(input) {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const byMonth = new Map();
  arr.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const month = normalizeMonth(item.month);
    if (month == null) return;
    const current = byMonth.get(month) || { month };
    const hRaw = item.height_cm ?? item.height;
    const wRaw = item.weight_kg ?? item.weight;
    if (hRaw != null) {
      const h = Number(hRaw);
      if (Number.isFinite(h)) current.height_cm = h;
    }
    if (wRaw != null) {
      const w = Number(wRaw);
      if (Number.isFinite(w)) current.weight_kg = w;
    }
    byMonth.set(month, current);
  });
  const out = [];
  byMonth.forEach(entry => {
    const record = { month: entry.month };
    let valid = false;
    if (Number.isFinite(entry.height_cm)) { record.height_cm = entry.height_cm; valid = true; }
    if (Number.isFinite(entry.weight_kg)) { record.weight_kg = entry.weight_kg; valid = true; }
    if (valid) out.push(record);
  });
  return out;
}

function buildTeethRecords(input) {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const out = [];
  arr.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const month = normalizeMonth(item.month);
    if (month == null) return;
    const countRaw = item.count ?? item.teeth ?? item.value;
    const count = Number(countRaw);
    if (!Number.isFinite(count)) return;
    out.push({ month, count: Math.max(0, Math.round(count)) });
  });
  return out;
}

function buildSleepRecords(input) {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const out = [];
  arr.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const month = normalizeMonth(item.month);
    if (month == null) return;
    const hoursRaw = item.hours ?? item.value;
    const hours = Number(hoursRaw);
    if (!Number.isFinite(hours)) return;
    out.push({ month, hours });
  });
  return out;
}

async function fetchAnonProfile(supaUrl, serviceKey, code) {
  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const data = await supabaseRequest(
    `${supaUrl}/rest/v1/profiles?select=id,code_unique,user_id,full_name&code_unique=eq.${encodeURIComponent(code)}&limit=1`,
    { headers }
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new HttpError(404, 'Code not found');
  if (row.user_id) throw new HttpError(403, 'Not an anonymous profile');
  return row;
}

async function fetchChild(supaUrl, serviceKey, childId) {
  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const data = await supabaseRequest(
    `${supaUrl}/rest/v1/children?select=*&id=eq.${encodeURIComponent(childId)}&limit=1`,
    { headers }
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new HttpError(404, 'Child not found');
  return row;
}

function withChildId(records, childId) {
  if (!Array.isArray(records) || !records.length) return [];
  return records.map(r => ({ ...r, child_id: childId }));
}

export async function processAnonChildrenRequest(body) {
  try {
    const action = String(body?.action || '').trim();
    if (!action) throw new HttpError(400, 'action required');
    const code = normalizeCode(body.code || body.code_unique);
    if (!code) throw new HttpError(400, 'code required');
    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = profile.id;

    if (action === 'list') {
      const data = await supabaseRequest(
        `${supaUrl}/rest/v1/children?select=*&user_id=eq.${encodeURIComponent(profileId)}&order=created_at.asc`,
        { headers }
      );
      return { status: 200, body: { children: Array.isArray(data) ? data : [] } };
    }

    if (action === 'get') {
      const childId = normalizeString(body.childId ?? body.child_id ?? body.id ?? '', 128);
      if (!childId) throw new HttpError(400, 'child_id required');
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Forbidden');
      const [ms, sleep, teeth] = await Promise.all([
        supabaseRequest(
          `${supaUrl}/rest/v1/growth_measurements?select=month,height_cm,weight_kg,created_at&child_id=eq.${encodeURIComponent(childId)}&order=month.asc`,
          { headers }
        ),
        supabaseRequest(
          `${supaUrl}/rest/v1/growth_sleep?select=month,hours&child_id=eq.${encodeURIComponent(childId)}&order=month.asc`,
          { headers }
        ),
        supabaseRequest(
          `${supaUrl}/rest/v1/growth_teeth?select=month,count&child_id=eq.${encodeURIComponent(childId)}&order=month.asc`,
          { headers }
        ),
      ]);
      return {
        status: 200,
        body: {
          child,
          growth: {
            measurements: Array.isArray(ms) ? ms : [],
            sleep: Array.isArray(sleep) ? sleep : [],
            teeth: Array.isArray(teeth) ? teeth : [],
          }
        }
      };
    }

    if (action === 'create') {
      const childPayload = sanitizeChildInsert(body.child, profileId);
      if (!childPayload.first_name || !childPayload.dob || !childPayload.sex) {
        throw new HttpError(400, 'Invalid child payload');
      }
      const inserted = await supabaseRequest(
        `${supaUrl}/rest/v1/children`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify([childPayload])
        }
      );
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      if (!row?.id) throw new HttpError(500, 'Create failed');
      const childId = row.id;
      const measurements = withChildId(buildMeasurementRecords(body.growthMeasurements), childId);
      if (measurements.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_measurements?on_conflict=child_id,month`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify(measurements)
          }
        );
      }
      const teeth = withChildId(buildTeethRecords(body.growthTeeth), childId);
      if (teeth.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_teeth`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(teeth)
          }
        );
      }
      const sleep = withChildId(buildSleepRecords(body.growthSleep), childId);
      if (sleep.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_sleep`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(sleep)
          }
        );
      }
      return { status: 200, body: { child: row } };
    }

    if (action === 'update') {
      const childId = normalizeString(body.childId ?? body.child_id ?? body.id ?? (body.child?.id ?? ''), 128);
      if (!childId) throw new HttpError(400, 'child_id required');
      const existing = await fetchChild(supaUrl, serviceKey, childId);
      if (existing.user_id !== profileId) throw new HttpError(403, 'Forbidden');
      const updatePayload = sanitizeChildUpdate(body.child);
      let updatedRow = existing;
      if (Object.keys(updatePayload).length) {
        const updated = await supabaseRequest(
          `${supaUrl}/rest/v1/children?id=eq.${encodeURIComponent(childId)}`,
          {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(updatePayload)
          }
        );
        updatedRow = Array.isArray(updated) && updated[0] ? updated[0] : existing;
      }
      const measurements = withChildId(buildMeasurementRecords(body.growthMeasurements), childId);
      if (measurements.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_measurements?on_conflict=child_id,month`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify(measurements)
          }
        );
      }
      const teeth = withChildId(buildTeethRecords(body.growthTeeth), childId);
      if (teeth.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_teeth`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(teeth)
          }
        );
      }
      const sleep = withChildId(buildSleepRecords(body.growthSleep), childId);
      if (sleep.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_sleep`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(sleep)
          }
        );
      }
      return { status: 200, body: { child: updatedRow } };
    }

    if (action === 'delete') {
      const childId = normalizeString(body.childId ?? body.child_id ?? body.id ?? '', 128);
      if (!childId) throw new HttpError(400, 'child_id required');
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Forbidden');
      await supabaseRequest(
        `${supaUrl}/rest/v1/children?id=eq.${encodeURIComponent(childId)}`,
        {
          method: 'DELETE',
          headers: { ...headers, 'Prefer': 'return=representation' }
        }
      );
      return { status: 200, body: { success: true } };
    }

    if (action === 'set-primary') {
      const childId = normalizeString(body.childId ?? body.child_id ?? body.id ?? '', 128);
      if (!childId) throw new HttpError(400, 'child_id required');
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Forbidden');
      await supabaseRequest(
        `${supaUrl}/rest/v1/children?user_id=eq.${encodeURIComponent(profileId)}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_primary: false })
        }
      );
      await supabaseRequest(
        `${supaUrl}/rest/v1/children?id=eq.${encodeURIComponent(childId)}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_primary: true })
        }
      );
      return { status: 200, body: { success: true } };
    }

    if (action === 'log-update') {
      const childId = normalizeString(body.childId ?? body.child_id ?? '', 128);
      if (!childId) throw new HttpError(400, 'child_id required');
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Forbidden');
      const updateType = normalizeString(body.updateType ?? body.type ?? '', 64);
      const contentRaw = body.updateContent ?? body.content ?? {};
      const updateContent = typeof contentRaw === 'string' ? contentRaw : JSON.stringify(contentRaw);
      const aiComment = body.aiComment != null ? normalizeString(body.aiComment, 5000, { allowNull: true }) : null;
      const payload = { child_id: childId, update_type: updateType || 'update', update_content: updateContent };
      if (aiComment != null) payload.ai_comment = aiComment;
      const inserted = await supabaseRequest(
        `${supaUrl}/rest/v1/child_updates`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify([payload])
        }
      );
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return { status: 200, body: { update: row } };
    }

    if (action === 'list-updates') {
      const childId = normalizeString(body.childId ?? body.child_id ?? '', 128);
      if (!childId) throw new HttpError(400, 'child_id required');
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Forbidden');
      const updates = await supabaseRequest(
        `${supaUrl}/rest/v1/child_updates?select=*&child_id=eq.${encodeURIComponent(childId)}&order=created_at.desc`,
        { headers }
      );
      return { status: 200, body: { updates: Array.isArray(updates) ? updates : [] } };
    }

    if (action === 'add-growth') {
      const childId = normalizeString(body.childId ?? body.child_id ?? '', 128);
      if (!childId) throw new HttpError(400, 'child_id required');
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Forbidden');
      const measurements = withChildId(buildMeasurementRecords(body.growthMeasurements ?? body.measurements), childId);
      if (measurements.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_measurements?on_conflict=child_id,month`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify(measurements)
          }
        );
      }
      const sleep = withChildId(buildSleepRecords(body.growthSleep ?? body.sleepEntries), childId);
      if (sleep.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_sleep`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(sleep)
          }
        );
      }
      const teeth = withChildId(buildTeethRecords(body.growthTeeth ?? body.teethEntries), childId);
      if (teeth.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_teeth`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(teeth)
          }
        );
      }
      return { status: 200, body: { success: true } };
    }

    throw new HttpError(400, 'Unknown action');
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message, details: err.details } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err && err.message ? err.message : err) } };
  }
}

export {
  HttpError,
  buildMeasurementRecords,
  buildTeethRecords,
  buildSleepRecords,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  supabaseRequest,
};
