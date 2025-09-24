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
        return anonHandler(action, payload);
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
