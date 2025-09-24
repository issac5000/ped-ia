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
        const basePayload = payload && typeof payload === 'object' ? { ...payload } : {};
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
