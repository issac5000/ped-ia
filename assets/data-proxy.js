const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHILD_ACTIONS_REQUIRING_ID = new Set(['get', 'growth-status', 'update', 'delete', 'set-primary', 'log-update', 'list-updates', 'add-growth']);

let ensureSupabaseClientRef = null;
let getSupabaseClientRef = null;

function rememberSupabaseAccessors({ ensureSupabaseClient, getSupabaseClient } = {}) {
  if (typeof ensureSupabaseClient === 'function') {
    ensureSupabaseClientRef = ensureSupabaseClient;
  }
  if (typeof getSupabaseClient === 'function') {
    getSupabaseClientRef = getSupabaseClient;
  }
}

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

function toTrimmedString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
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
  const requiresId = CHILD_ACTIONS_REQUIRING_ID.has(action);
  const originalChild = base.child && typeof base.child === 'object' ? { ...base.child } : null;
  if (base.child && typeof base.child === 'object') {
    base.child = normalizeChildPayloadForSupabase(base.child);
  }
  let candidate = base.child_id ?? base.childId ?? base.id;
  if (!candidate && originalChild && Object.prototype.hasOwnProperty.call(originalChild, 'id')) {
    candidate = originalChild.id;
  }
  const trimmedCandidate = toTrimmedString(candidate);
  if (trimmedCandidate) {
    if (UUID_REGEX.test(trimmedCandidate)) {
      base.child_id = trimmedCandidate;
    } else {
      base.child_id = trimmedCandidate;
    }
  } else if (requiresId) {
    throw new Error('child_id manquant ou invalide');
  } else {
    delete base.child_id;
  }
  if (base.child && typeof base.child === 'object') {
    const normalizedChildId = toTrimmedString(base.child.id);
    if (!normalizedChildId && base.child_id) {
      base.child.id = base.child_id;
    } else if (normalizedChildId && !UUID_REGEX.test(normalizedChildId)) {
      base.child.id = normalizedChildId;
    }
  }
  if ('childId' in base) delete base.childId;
  if ('id' in base) {
    const inline = toTrimmedString(base.id);
    if (!inline) {
      delete base.id;
    } else {
      base.id = inline;
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
  rememberSupabaseAccessors({ ensureSupabaseClient, getSupabaseClient });

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
        if (anonHandler === anonChildrenRequest) {
          const childIdRaw = basePayload.child_id ?? basePayload.childId ?? (basePayload.child && basePayload.child.id);
          const childId = typeof childIdRaw === 'string' ? childIdRaw.trim() : '';
          if (action === 'latest-growth' && (!childId || childId.startsWith('demo-'))) {
            console.warn('[Anon skip] latest-growth sans child_id valide');
            return null;
          }
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
  const trimmedId = toTrimmedString(id);
  if (!trimmedId || trimmedId.startsWith('demo-')) {
    console.warn('[Anon skip] loadChildById sans id valide');
    return null;
  }
  const uuid = normalizeChildIdValue(trimmedId);
  if (!uuid) {
    console.warn('[loadChildById] Ignoring non-UUID identifier', trimmedId);
    return null;
  }
  try {
    if (typeof ensureSupabaseClientRef === 'function') {
      const ok = await ensureSupabaseClientRef();
      if (!ok) {
        console.warn('[loadChildById] Supabase client not ready yet (retrying later)');
        if (typeof setTimeout === 'function') {
          setTimeout(() => {
            try { loadChildById(id); } catch {}
          }, 1000);
        }
        return null;
      }
    }
  } catch (err) {
    console.warn('[loadChildById] ensureSupabaseClient failed', err);
    return null;
  }
  const client = typeof getSupabaseClientRef === 'function' ? getSupabaseClientRef() : null;
  if (!client) {
    console.warn('[loadChildById] Supabase client not ready yet (retrying later)');
    if (typeof setTimeout === 'function') {
      setTimeout(() => {
        try { loadChildById(id); } catch {}
      }, 1000);
    }
    return null;
  }
  try {
    const { data, error } = await client
      .from('children')
      .select('*')
      .eq('id', uuid)
      .single();
    if (error && error.code === 'PGRST116') {
      console.warn('[Anon skip] Aucun enfant trouvé pour', id);
      return null;
    }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      console.warn('[Anon skip] Résultat vide pour', id);
      return null;
    }
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
