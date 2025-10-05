const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHILD_ACTIONS_REQUIRING_ID = new Set(['get', 'growth-status', 'update', 'delete', 'set-primary', 'log-update', 'list-updates', 'add-growth']);

function normalizeSexValue(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw === 0 || raw === 1) return raw;
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const normalized = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (['0', 'f', 'fille', 'girl', 'femme', 'female', 'feminin'].includes(normalized)) return 0;
    if (['1', 'g', 'm', 'garcon', 'garconne', 'boy', 'masculin', 'male'].includes(normalized)) return 1;
  }
  return null;
}

function normalizeDobValue(raw) {
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().split('T')[0];
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return null;
    const iso = date.toISOString().split('T')[0];
    if (iso !== `${match[1]}-${match[2]}-${match[3]}`) return null;
    return iso;
  }
  return null;
}

function normalizeChildIdValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return UUID_REGEX.test(trimmed) ? trimmed : '';
  }
  if (value == null) return '';
  return normalizeChildIdValue(String(value));
}

export function assertValidChildId(value) {
  const normalized = normalizeChildIdValue(value);
  if (!normalized) {
    throw new Error('child_id manquant ou invalide');
  }
  return normalized;
}

export function normalizeChildPayloadForSupabase(child = {}) {
  const payload = child && typeof child === 'object' ? { ...child } : {};
  if (Object.prototype.hasOwnProperty.call(payload, 'sex')) {
    const normalizedSex = normalizeSexValue(payload.sex);
    if (normalizedSex == null) {
      delete payload.sex;
    } else {
      payload.sex = normalizedSex;
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'dob')) {
    const normalizedDob = normalizeDobValue(payload.dob);
    if (normalizedDob) {
      payload.dob = normalizedDob;
    } else {
      delete payload.dob;
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'child_id')) {
    const normalizedId = normalizeChildIdValue(payload.child_id);
    if (normalizedId) {
      payload.child_id = normalizedId;
    } else {
      delete payload.child_id;
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'childId')) {
    const normalizedId = normalizeChildIdValue(payload.childId);
    if (normalizedId) {
      payload.child_id = normalizedId;
    }
    delete payload.childId;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'id')) {
    const normalizedId = normalizeChildIdValue(payload.id);
    if (normalizedId) {
      payload.id = normalizedId;
    } else {
      delete payload.id;
    }
  }
  return payload;
}

export function normalizeAnonChildPayload(action, payload = {}) {
  const base = payload && typeof payload === 'object' ? { ...payload } : {};
  if (base.child && typeof base.child === 'object') {
    base.child = normalizeChildPayloadForSupabase(base.child);
  }
  let candidate = base.child_id ?? base.childId ?? base.id ?? (base.child && base.child.id);
  if (candidate != null) {
    const normalized = normalizeChildIdValue(candidate);
    if (normalized) {
      base.child_id = normalized;
    } else if (CHILD_ACTIONS_REQUIRING_ID.has(action)) {
      throw new Error('child_id manquant ou invalide');
    } else {
      delete base.child_id;
    }
  } else if (CHILD_ACTIONS_REQUIRING_ID.has(action)) {
    throw new Error('child_id manquant ou invalide');
  }
  if (base.child && typeof base.child === 'object' && Object.prototype.hasOwnProperty.call(base.child, 'id')) {
    const normalizedChildId = normalizeChildIdValue(base.child.id);
    if (normalizedChildId) {
      base.child.id = normalizedChildId;
    } else {
      delete base.child.id;
    }
  }
  if ('childId' in base) delete base.childId;
  if ('id' in base && (base.id === candidate || typeof base.id === 'string')) {
    const normalizedInlineId = normalizeChildIdValue(base.id);
    if (normalizedInlineId) {
      base.id = normalizedInlineId;
    } else {
      delete base.id;
    }
  }
  return base;
}

const DEFAULT_ERROR_MESSAGES = {
  missingSupabase: 'Supabase client unavailable',
  missingAnonHandler: 'Anonymous route unavailable',
};

export function createDataProxy({
  getActiveProfile,
  ensureSupabaseClient,
  getSupabaseClient,
  anonChildrenRequest,
  anonParentRequest,
  anonFamilyRequest,
} = {}) {
  const getProfile = () => {
    try {
      return typeof getActiveProfile === 'function' ? (getActiveProfile() || null) : null;
    } catch {
      return null;
    }
  };

  const isAnonProfile = () => {
    const profile = getProfile();
    if (!profile) return false;
    const code = profile.code_unique || profile.codeUnique || '';
    if (!code) return false;
    if (Object.prototype.hasOwnProperty.call(profile, 'user_id') && profile.user_id) return false;
    if (Object.prototype.hasOwnProperty.call(profile, 'isAnonymous')) {
      return !!profile.isAnonymous;
    }
    return true;
  };

  const ensureSupabase = async () => {
    if (isAnonProfile()) {
      throw new Error(DEFAULT_ERROR_MESSAGES.missingSupabase);
    }
    if (typeof ensureSupabaseClient === 'function') {
      const ok = await ensureSupabaseClient();
      if (!ok) throw new Error(DEFAULT_ERROR_MESSAGES.missingSupabase);
    }
    const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
    if (!client) throw new Error(DEFAULT_ERROR_MESSAGES.missingSupabase);
    return client;
  };

  const createProxy = (anonHandler) => {
    const anon = isAnonProfile();
    return {
      mode: anon ? 'anon' : 'supabase',
      isAnon: anon,
      isSupabase: !anon,
      getProfile,
      async getClient() {
        return ensureSupabase();
      },
      async callAnon(action, payload = {}) {
        if (!anon) {
          throw new Error(DEFAULT_ERROR_MESSAGES.missingAnonHandler);
        }
        if (typeof anonHandler !== 'function') {
          throw new Error(DEFAULT_ERROR_MESSAGES.missingAnonHandler);
        }
        const endpoint =
          typeof anonHandler.__anonEndpoint === 'string'
            ? anonHandler.__anonEndpoint
            : '(unknown anon endpoint)';
        const expectsCode = anonHandler.__expectsCode !== false;
        let basePayload = payload && typeof payload === 'object' ? { ...payload } : {};
        if (expectsCode) {
          const existingCode = typeof basePayload.code === 'string' ? basePayload.code.trim() : basePayload.code;
          if (!existingCode) {
            const profile = typeof getProfile === 'function' ? getProfile() : null;
            const rawCode =
              (profile && (profile.code_unique || profile.codeUnique))
                ? profile.code_unique || profile.codeUnique
                : '';
            const normalizedCode =
              typeof rawCode === 'string'
                ? rawCode.trim().toUpperCase()
                : rawCode != null
                ? String(rawCode).trim().toUpperCase()
                : '';
            if (normalizedCode) {
              basePayload.code = normalizedCode;
            } else {
              console.warn('Anon request without code:', { action, ...basePayload });
            }
          } else if (typeof existingCode === 'string') {
            basePayload.code = existingCode.trim().toUpperCase();
          }
        }
        if (typeof anonHandler.__normalizePayload === 'function') {
          const normalized = anonHandler.__normalizePayload(action, basePayload);
          if (normalized && typeof normalized === 'object') {
            basePayload = normalized;
          } else {
            basePayload = {};
          }
        }
        if (expectsCode && typeof basePayload.code === 'string') {
          basePayload.code = basePayload.code.trim().toUpperCase();
        }
        const logPayload = basePayload && typeof basePayload === 'object' ? { action, ...basePayload } : { action };
        console.log('Anon request:', endpoint, logPayload);
        return anonHandler(action, basePayload);
      },
    };
  };

  return {
    mode: () => (isAnonProfile() ? 'anon' : 'supabase'),
    isAnon: () => isAnonProfile(),
    children: () => createProxy(anonChildrenRequest),
    parentUpdates: () => createProxy(anonParentRequest),
    family: () => createProxy(anonFamilyRequest),
  };
}

// --- Utility shared across Synap’Kids ---
// Handles fetching a child profile by ID from Supabase
async function loadChildById(id) {
  if (!id) return null;
  if (typeof supabase === 'undefined' || !supabase) {
    console.warn('[loadChildById] Supabase client not ready yet');
    return null;
  }
  try {
    const { data, error } = await supabase
      .from('children')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('loadChildById failed', err);
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.loadChildById = loadChildById;
}

export { loadChildById };
