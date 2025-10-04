// --- Utility shared across Synap’Kids ---
// Handles fetching a child profile by ID from Supabase

let resolveDependencies = null;

/**
 * Registers the dependency resolver used by child-related helpers.
 * The resolver should return the latest references each time it is invoked
 * so that consumers always work with up-to-date state (Supabase client, store, etc.).
 */
export function configureChildLoader(resolver) {
  resolveDependencies = typeof resolver === 'function' ? resolver : null;
}

export async function loadChildById(id) {
  if (!resolveDependencies) {
    throw new Error('loadChildById dependencies not configured');
  }
  if (!id) return null;

  const {
    useRemote,
    isAnonProfile,
    getDataProxy,
    mapRowToChild,
    getActiveProfileId,
    getSupabaseClient,
    store,
    keys,
  } = resolveDependencies() || {};

  if (typeof useRemote !== 'function' || typeof mapRowToChild !== 'function') {
    throw new Error('loadChildById resolver returned invalid dependencies');
  }

  const supabase = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
  const dataProxy = typeof getDataProxy === 'function' ? getDataProxy() : null;
  const loadFromStore = () => {
    if (!store || !keys) return null;
    const children = store.get(keys.children, []);
    if (!Array.isArray(children)) return null;
    return children.find((c) => c.id === id) || null;
  };

  if (!useRemote()) {
    return loadFromStore();
  }

  try {
    if (typeof isAnonProfile === 'function' && isAnonProfile()) {
      if (!dataProxy) return loadFromStore();
      const childAccess = dataProxy.children();
      const detail = await childAccess.callAnon('get', { childId: id });
      const data = detail?.child;
      if (!data) return null;
      const child = mapRowToChild(data);
      if (!child) return null;
      const growth = detail.growth || {};
      (growth.measurements || []).forEach((m) => {
        const h = Number(m?.height_cm);
        const w = Number(m?.weight_kg);
        const heightValid = Number.isFinite(h);
        const weightValid = Number.isFinite(w);
        child.growth.measurements.push({
          month: m.month,
          height: heightValid ? h : null,
          weight: weightValid ? w : null,
          bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
          measured_at: m.created_at,
        });
      });
      (growth.sleep || []).forEach((s) => child.growth.sleep.push({ month: s.month, hours: s.hours }));
      (growth.teeth || []).forEach((t) => child.growth.teeth.push({ month: t.month, count: t.count }));
      return child;
    }

    const getProfileId = typeof getActiveProfileId === 'function' ? getActiveProfileId : null;
    const uid = getProfileId ? getProfileId() : null;
    if (!uid) {
      console.warn('Aucun user_id disponible pour la requête children (loadChildById) — fallback local');
      return loadFromStore();
    }

    if (!supabase) return null;

    const { data: row } = await supabase
      .from('children')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!row) return null;
    const child = mapRowToChild(row);
    if (!child) return null;

    try {
      const [{ data: gm }, { data: gs }, { data: gt }] = await Promise.all([
        supabase
          .from('growth_measurements')
          .select('month,height_cm,weight_kg,created_at')
          .eq('child_id', row.id),
        supabase
          .from('growth_sleep')
          .select('month,hours')
          .eq('child_id', row.id),
        supabase
          .from('growth_teeth')
          .select('month,count')
          .eq('child_id', row.id),
      ]);
      (gm || [])
        .map((m) => {
          const h = m.height_cm == null ? null : Number(m.height_cm);
          const w = m.weight_kg == null ? null : Number(m.weight_kg);
          return {
            month: m.month,
            height: h,
            weight: w,
            bmi: w && h ? w / Math.pow(h / 100, 2) : null,
            measured_at: m.created_at,
          };
        })
        .forEach((m) => child.growth.measurements.push(m));
      (gs || []).forEach((s) => child.growth.sleep.push({ month: s.month, hours: s.hours }));
      (gt || []).forEach((t) => child.growth.teeth.push({ month: t.month, count: t.count }));
    } catch {
      // keep same lax error handling as original implementation
    }

    return child;
  } catch {
    return null;
  }
}
