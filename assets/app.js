let notifCount = 0;
const NOTIF_LAST_KEY = 'pedia_notif_last';
const NOTIF_BOOT_FLAG = 'pedia_notif_booted';
// Synap'Kids SPA — Prototype 100 % front avec localStorage + authentification Supabase (Google)
import { DEV_QUESTIONS } from './questions-dev.js';
// import { LENGTH_FOR_AGE, WEIGHT_FOR_AGE, BMI_FOR_AGE } from '/src/data/who-curves.js';
(async () => {
  document.body.classList.remove('no-js');
  // Forcer l’interface « menu hamburger » sur tous les formats d’écran
  try { document.body.classList.add('force-mobile'); } catch {}
  // Helpers DOM accessibles immédiatement
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const normalizeRoutePath = (input) => {
    const raw = typeof input === 'string' ? input.trim() : '';
    if (!raw) return '/';
    const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!withoutHash) return '/';
    const pathOnly = withoutHash.split('?')[0].split('&')[0] || '/';
    return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  };
  const routeSections = new Map();
  document.querySelectorAll('section[data-route]').forEach(section => {
    const key = normalizeRoutePath(section.dataset.route || '/');
    if (!routeSections.has(key)) routeSections.set(key, section);
  });
  let activeRouteEl = document.querySelector('section.route.active') || null;
  const navLinks = new Map();
  const navLinkTargets = new Map();
  document.querySelectorAll('#main-nav .nav-link').forEach(link => {
    const href = link.getAttribute('href') || '';
    navLinks.set(href, link);
    if (href.startsWith('#')) navLinkTargets.set(href, normalizeRoutePath(href));
  });
  const navBadges = new Map();
  const navBtn = document.getElementById('nav-toggle');
  const mainNav = document.getElementById('main-nav');
  const navBackdrop = document.getElementById('nav-backdrop');
  const closeMobileNav = () => {
    if (mainNav) mainNav.classList.remove('open');
    if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
    navBackdrop?.classList.remove('open');
  };
  // Les courbes OMS utilisaient auparavant Chart.js chargé via CDN.
  // Pour éviter les erreurs de chargement (réseau ou CSP),
  // on n'utilise plus de dépendance externe ici.
  // Les graphiques sont désormais rendus en SVG via une fonction locale.
  const { LENGTH_FOR_AGE, WEIGHT_FOR_AGE, BMI_FOR_AGE } = await import('../src/data/who-curves.js').catch(e => {
    console.error('Curves import failed', e);
    return {};
  });
  if (!LENGTH_FOR_AGE) console.error('Curves import failed');
  const fallbackCurves = { 0: { P3: null, P15: null, P50: null, P85: null, P97: null } };
  const curves = {
    LENGTH_FOR_AGE: LENGTH_FOR_AGE || fallbackCurves,
    WEIGHT_FOR_AGE: WEIGHT_FOR_AGE || fallbackCurves,
    BMI_FOR_AGE: BMI_FOR_AGE || fallbackCurves,
  };

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
    del(k) { localStorage.removeItem(k); },
  };
  const routes = [
    "/", "/signup", "/login", "/onboarding", "/dashboard",
    "/community", "/settings", "/about", "/ai", "/contact", "/legal"
  ];
  // Clés utilisées pour le stockage local du modèle de données
  const K = {
    user: 'pedia_user',
    children: 'pedia_children',
    forum: 'pedia_forum',
    privacy: 'pedia_privacy',
    session: 'pedia_session',
    messages: 'pedia_messages',
    notifs: 'pedia_notifs'
  };
  const DEBUG_AUTH = (typeof localStorage !== 'undefined' && localStorage.getItem('debug_auth') === '1');

  // Chargement des informations Supabase et du client JS
  let supabase = null;
  let authSession = null;
  let activeProfile = null;
  // Conserver la liste des canaux de notifications pour les nettoyer à la déconnexion
  let notifChannels = [];
  let anonNotifTimer = null;
  // Conserver la dernière route activée pour maîtriser les remises à zéro du scroll
  let __activePath = null;
  // Observateur d’animations de révélation (initialisé plus tard dans setupScrollAnimations)
  let revealObserver = null;

  const getActiveProfileId = () => activeProfile?.id || null;
  const isProfileLoggedIn = () => !!getActiveProfileId();
  // ✅ Fix: useRemote défini dès le départ
  const useRemote = () => !!supabase && isProfileLoggedIn();
  const isAnonProfile = () => !!activeProfile?.isAnonymous && !!activeProfile?.code_unique;

  restoreAnonSession();

  async function anonChildRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
    const response = await fetch('/api/anon/children', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text().catch(() => '');
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }
    if (!response.ok) {
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    return json || {};
  }

  async function anonCommunityRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
    const response = await fetch('/api/anon/community', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text().catch(() => '');
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }
    if (!response.ok) {
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    return json || {};
  }

  function buildMeasurementPayloads(entries) {
    const arr = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    const byMonth = new Map();
    arr.forEach(item => {
      if (!item) return;
      const month = Number(item.month);
      if (!Number.isInteger(month)) return;
      const current = byMonth.get(month) || { month };
      if (item.height != null || item.height_cm != null) {
        const h = Number(item.height_cm ?? item.height);
        if (Number.isFinite(h)) current.height_cm = h;
      }
      if (item.weight != null || item.weight_kg != null) {
        const w = Number(item.weight_kg ?? item.weight);
        if (Number.isFinite(w)) current.weight_kg = w;
      }
      byMonth.set(month, current);
    });
    const out = [];
    byMonth.forEach(entry => {
      const rec = { month: entry.month };
      let valid = false;
      if (Number.isFinite(entry.height_cm)) { rec.height_cm = entry.height_cm; valid = true; }
      if (Number.isFinite(entry.weight_kg)) { rec.weight_kg = entry.weight_kg; valid = true; }
      if (valid) out.push(rec);
    });
    return out;
  }

  function buildTeethPayloads(entries) {
    const arr = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    const out = [];
    arr.forEach(item => {
      if (!item) return;
      const month = Number(item.month);
      if (!Number.isInteger(month)) return;
      const countRaw = item.count ?? item.teeth ?? item.value;
      const count = Number(countRaw);
      if (!Number.isFinite(count)) return;
      out.push({ month, count: Math.max(0, Math.round(count)) });
    });
    return out;
  }

  function buildSleepPayloads(entries) {
    const arr = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    const out = [];
    arr.forEach(item => {
      if (!item) return;
      const month = Number(item.month);
      if (!Number.isInteger(month)) return;
      const hoursRaw = item.hours ?? item.value;
      const hours = Number(hoursRaw);
      if (!Number.isFinite(hours)) return;
      out.push({ month, hours });
    });
    return out;
  }

  function mapRowToChild(row) {
    if (!row || !row.id) return null;
    return {
      id: row.id,
      firstName: row.first_name,
      sex: row.sex,
      dob: row.dob,
      photo: row.photo_url,
      context: {
        allergies: row.context_allergies,
        history: row.context_history,
        care: row.context_care,
        languages: row.context_languages,
        feedingType: row.feeding_type,
        eatingStyle: row.eating_style,
        sleep: {
          falling: row.sleep_falling,
          sleepsThrough: row.sleep_sleeps_through,
          nightWakings: row.sleep_night_wakings,
          wakeDuration: row.sleep_wake_duration,
          bedtime: row.sleep_bedtime,
        },
      },
      milestones: Array.isArray(row.milestones) ? row.milestones : [],
      growth: { measurements: [], sleep: [], teeth: [] }
    };
  }

  try {
    const env = await fetch('/api/env').then(r => r.json());
    if (env?.url && env?.anonKey) {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      supabase = createClient(env.url, env.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });



    // Cas robuste : si Google renvoie ?code dans l’URL, on échange immédiatement contre une session
try {
  const urlNow = new URL(window.location.href);
  if (urlNow.searchParams.get('code')) {
    // Supabase veut l’URL sans hash (#/dashboard), donc on nettoie
    const cleanUrl = window.location.origin + urlNow.pathname + urlNow.search;
    const { error: xErr } = await supabase.auth.exchangeCodeForSession(cleanUrl);
    if (xErr) {
      console.warn('exchangeCodeForSession error', xErr);
    }
    // On enlève juste le ?code de l’URL, mais on garde le hash
    urlNow.search = '';
    history.replaceState({}, '', urlNow.toString());
  }
} catch (e) {
  console.warn('exchangeCodeForSession failed', e);
}




  
      // Vérifier si un utilisateur est déjà connecté après redirection OAuth
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        authSession = { user };
        await ensureProfile(user);
        await syncUserFromSupabase();
        updateHeaderAuth();
        // Si l'utilisateur est déjà connecté et qu'aucun hash n'est fourni ou qu'on se trouve sur
        // les pages de connexion/inscription, on redirige vers le dashboard. Sinon, on reste sur la
        // page actuelle (ex: rafraîchissement sur l'accueil doit rester sur l'accueil).
        if (!location.hash || location.hash === '#' || location.hash === '#/login' || location.hash === '#/signup') {
          location.hash = '#/dashboard';
        } else {
          setActiveRoute(location.hash);
        }
      }
  
      // Récupérer la session en cours (utile si pas d'user direct)
      const { data: { session } } = await supabase.auth.getSession();
      authSession = session || authSession;
      if (authSession?.user && !isProfileLoggedIn()) {
        await ensureProfile(authSession.user);
        await syncUserFromSupabase();
      }
      if (isProfileLoggedIn() && (location.hash === '' || location.hash === '#' || location.hash === '#/login' || location.hash === '#/signup')) {
        location.hash = '#/dashboard';
      }
      supabase.auth.onAuthStateChange(async (_event, session) => {
        authSession = session || null;
        if (session?.user) {
          await ensureProfile(session.user);
          await syncUserFromSupabase();
        } else {
          if (!isAnonProfile()) {
            setActiveProfile(null);
          }
        }
        updateHeaderAuth();
        if (isProfileLoggedIn() && (location.hash === '' || location.hash === '#' || location.hash === '#/login' || location.hash === '#/signup')) {
          location.hash = '#/dashboard';
        } else {
          setActiveRoute(location.hash);
        }
        // Ré-attache les notifications temps réel à chaque changement d’authentification
        if (authSession?.user) {
          setupRealtimeNotifications();
          updateBadgeFromStore();
          // Récupère systématiquement les notifications manquées après connexion (lacunes possibles après OAuth)
          fetchMissedNotifications();
          // Ne rejoue les toasts qu’une seule fois par session
          if (!hasBootedNotifs()) { replayUnseenNotifs(); markBootedNotifs(); }
        } else {
          // Nettoie les canaux lors de la déconnexion
          try { for (const ch of notifChannels) await supabase.removeChannel(ch); } catch {}
          notifChannels = [];
        }
      });
      // Routage initial une fois l’état d’authentification déterminé
      if (location.hash) {
        setActiveRoute(location.hash);
      } else {
        location.hash = isProfileLoggedIn() ? '#/dashboard' : '#/';
      }
      // Abonne les notifications pour une session déjà active et rejoue les toasts une fois
      if (authSession?.user) {
        setupRealtimeNotifications();
        updateBadgeFromStore();
        // Récupère systématiquement les notifications manquées à l’ouverture si déjà connecté
        fetchMissedNotifications();
        // Ne rejoue les toasts qu’une fois par session
        if (!hasBootedNotifs()) { replayUnseenNotifs(); markBootedNotifs(); }
      }
    }
  } catch (e) {
    console.warn('Supabase init failed (env or import)', e);
  }

 

  

  // Valeurs par défaut de démarrage
  function bootstrap() {
    if (!store.get(K.forum)) store.set(K.forum, { topics: [] });
    if (!store.get(K.children)) store.set(K.children, []);
    if (!store.get(K.privacy)) store.set(K.privacy, { showStats: true, allowMessages: true });
    if (!store.get(K.session)) store.set(K.session, { loggedIn: false });
  }

  // Gestion du routage
  const protectedRoutes = new Set(['/dashboard','/community','/ai','/settings','/onboarding']);
  function setActiveRoute(hash) {
    const requestedPath = normalizeRoutePath(hash);
    const path = routeSections.has(requestedPath) ? requestedPath : '/';
    const targetSection = routeSections.get(path) || null;
    if (targetSection && activeRouteEl !== targetSection) {
      activeRouteEl?.classList.remove('active');
      targetSection.classList.add('active');
      activeRouteEl = targetSection;
    } else if (!targetSection && activeRouteEl) {
      activeRouteEl.classList.add('active');
    }
    for (const [href, link] of navLinks) {
      const targetPath = navLinkTargets.get(href);
      link.classList.toggle('active', !!targetPath && targetPath === path);
    }
    try {
      const pl = document.getElementById('page-logo');
      if (pl) pl.hidden = (path === '/' || path === '');
    } catch {}
    updateHeaderAuth();
    const previousPath = (typeof __activePath === 'string' && __activePath.length > 0) ? __activePath : null;
    if (previousPath !== path) {
      window.scrollTo(0, 0);
    }
    const authed = isProfileLoggedIn();
    if (protectedRoutes.has(path) && !authed) {
      location.hash = '#/login';
      return;
    }
    if ((path === '/login' || path === '/signup') && authed) {
      location.hash = '#/dashboard';
      return;
    }
    if (path === '/onboarding') { renderOnboarding(); }
    if (path === '/dashboard') { renderDashboard(); }
    if (path === '/community') { renderCommunity(); }
    if (path === '/settings') { renderSettings(); }
    if (path === '/ai') { setupAIPage(); }
    if (path === '/contact') { setupContact(); }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(setupScrollAnimations);
    } else {
      setTimeout(setupScrollAnimations, 0);
    }
    if (path === '/') {
      try { setupNewsletter(); } catch {}
      stopRouteParticles();
      stopSectionParticles();
      startHeroParticles();
      stopLogoParticles();
      if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
        startRouteParticles();
        startSectionParticles();
        startCardParticles();
      } else {
        startRouteParticles();
        stopCardParticles();
      }
    } else {
      stopHeroParticles();
      stopSectionParticles();
      stopRouteParticles();
      stopLogoParticles();
      stopCardParticles();
      startRouteParticles();
      startLogoParticles();
    }
    __activePath = path;
  }

  window.addEventListener('hashchange', () => {
    setActiveRoute(location.hash || '#/ai');
    closeMobileNav();
  });

  // Forcer en permanence le menu hamburger, quelle que soit la largeur d’écran
  function evaluateHeaderFit(){
    document.body.classList.add('force-mobile');
  }

  // Au redimensionnement/orientation, réévaluer l’entête et réinitialiser l’état du menu si besoin
  function onViewportChange(){
    // Conserver systématiquement le mode mobile
    document.body.classList.add('force-mobile');
    // Garantir la cohérence de l’overlay lors des redimensionnements
    if (!mainNav?.classList.contains('open')) {
      closeMobileNav();
    }
  }
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  // Recontrôle après stabilisation du resize pour tenir compte du reflow des polices
  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(onViewportChange);
  });
  // Nouvelle évaluation après chargement complet (les polices/ressources peuvent modifier les largeurs)
  window.addEventListener('load', evaluateHeaderFit);

  // --- Notifications (popup) -------------------------------------------------
  // Notifications type toast (fermeture auto en 4 s, empilables)
  let notifyAudioCtx = null;
  function playNotifySound(){
    try {
      // Crée ou réutilise un AudioContext unique
      notifyAudioCtx = notifyAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = notifyAudioCtx;
      const now = ctx.currentTime + 0.01;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // tintement doux
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch {}
  }
  function getToastHost(){
    let host = document.getElementById('notify-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'notify-toasts';
      host.className = 'notify-toasts';
      document.body.appendChild(host);
    }
    return host;
  }
  function showNotification(opts){
    try {
      const { title = 'Notification', text = '', actionHref = '', actionLabel = 'Voir', onAcknowledge } = opts || {};
      const host = getToastHost();
      // Limite la pile à 4 éléments en supprimant le plus ancien
      while (host.children.length >= 4) host.removeChild(host.firstElementChild);
      const toast = document.createElement('div');
      toast.className = 'notify-toast';
      toast.innerHTML = `
        <div class="nt-content">
          <h3 class="nt-title"></h3>
          <p class="nt-text"></p>
          <div class="nt-actions">
            <button type="button" class="btn btn-secondary nt-close">Fermer</button>
            <a class="btn btn-primary nt-link" href="#">${actionLabel}</a>
          </div>
        </div>
      `;
      toast.querySelector('.nt-title').textContent = title;
      toast.querySelector('.nt-text').textContent = text;
      const link = toast.querySelector('.nt-link');
      if (actionHref) { link.setAttribute('href', actionHref); link.hidden = false; }
      else { link.hidden = true; }
      const hide = () => { try { toast.classList.add('hide'); setTimeout(()=>toast.remove(), 250); } catch { toast.remove(); } };
      const acknowledge = () => { try { toast.classList.add('hide'); setTimeout(()=>toast.remove(), 250); } catch { toast.remove(); } finally { try { onAcknowledge && onAcknowledge(); } catch {} } };
      toast.querySelector('.nt-close').addEventListener('click', acknowledge);
      link.addEventListener('click', acknowledge);
      host.appendChild(toast);
      // Son discret lors d’une notification
      playNotifySound();
      const timer = setTimeout(hide, 4000);
      toast.addEventListener('mouseenter', () => clearTimeout(timer));
      toast.addEventListener('mouseleave', () => setTimeout(hide, 1500));
    } catch {}
  }

  // Badges sur les liens de navigation (messages + communauté)
  function setNavBadgeFor(hrefSel, n){
    const link = navLinks.get(hrefSel);
    if (!link) return;
    let badge = navBadges.get(hrefSel);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      link.appendChild(badge);
      navBadges.set(hrefSel, badge);
    }
    const value = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : Math.max(0, n|0);
    badge.textContent = String(value);
    badge.hidden = value === 0;
  }
  function countsByKind(){
    const arr = loadNotifs();
    let msg = 0, reply = 0;
    for (const n of arr) { if (!n.seen) { if (n.kind==='msg') msg++; else if (n.kind==='reply') reply++; } }
    return { msg, reply };
  }
  function bumpMessagesBadge(){
    // Compatibilité : recalculer tous les badges depuis le store local
    updateBadgeFromStore();
  }

  // --- Persistance des notifications non lues (localStorage) ---
  function loadNotifs(){ return store.get(K.notifs, []); }
  function saveNotifs(arr){ store.set(K.notifs, arr); }
  function addNotif(n){
    const arr = loadNotifs();
    const exists = arr.some(x=>x.id===n.id);
    if (!exists) { arr.push({ ...n, seen:false }); saveNotifs(arr); }
    updateBadgeFromStore();
    return !exists;
  }
  function markNotifSeen(id){ const arr = loadNotifs(); const i = arr.findIndex(x=>x.id===id); if (i>=0) { arr[i].seen=true; saveNotifs(arr); } updateBadgeFromStore(); }
  function markAllByTypeSeen(kind){ const arr = loadNotifs().map(x=> x.kind===kind? { ...x, seen:true } : x); saveNotifs(arr); setNotifLastNow(kind); updateBadgeFromStore(); }
  function unseenNotifs(){ return loadNotifs().filter(x=>!x.seen); }
  function updateBadgeFromStore(){
    const { msg, reply } = countsByKind();
    setNavBadgeFor('messages.html', msg);
    setNavBadgeFor('#/community', reply);
  }

  const ANON_NOTIF_INTERVAL_MS = 15000;

  async function fetchAnonMissedNotifications(){
    if (!isAnonProfile()) return;
    const sinceDefault = new Date(Date.now() - 7*24*3600*1000).toISOString();
    const sinceMsg = getNotifLastSince('msg') || sinceDefault;
    const sinceRep = getNotifLastSince('reply') || sinceDefault;
    try {
      const res = await anonMessagesRequest('recent-activity', { since: sinceMsg });
      const messages = Array.isArray(res?.messages) ? res.messages : [];
      const senders = res?.senders || {};
      for (const m of messages) {
        if (!m || m.id == null) continue;
        const senderRaw = m.sender_id ?? m.senderId;
        if (senderRaw == null) continue;
        const fromId = String(senderRaw);
        const notifId = `msg:${m.id}`;
        const fromName = senders[fromId] || 'Un parent';
        const wasNew = addNotif({ id:notifId, kind:'msg', fromId, fromName, createdAt:m.created_at });
        if (wasNew) {
          showNotification({
            title:'Nouveau message',
            text:`Vous avez un nouveau message de ${fromName}`,
            actionHref:`messages.html?user=${fromId}`,
            actionLabel:'Ouvrir',
            onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('msg'); }
          });
        }
      }
    } catch (err) {
      console.warn('fetchAnonMissedNotifications messages failed', err);
    }
    try {
      const resRep = await anonCommunityRequest('recent-replies', { since: sinceRep });
      const replies = Array.isArray(resRep?.replies) ? resRep.replies : [];
      const authors = resRep?.authors || {};
      const topics = resRep?.topics || {};
      for (const r of replies) {
        if (!r || r.id == null) continue;
        const topicIdRaw = r.topic_id ?? r.topicId;
        const topicId = topicIdRaw != null ? String(topicIdRaw) : '';
        const whoIdRaw = r.user_id ?? r.userId;
        const whoId = whoIdRaw != null ? String(whoIdRaw) : '';
        const who = authors[whoId] || 'Un parent';
        const rawTitle = topics[topicId] || '';
        const cleanTitle = rawTitle ? rawTitle.replace(/^\[(.*?)\]\s*/, '') : '';
        const notifId = `reply:${r.id}`;
        const wasNew = addNotif({ id:notifId, kind:'reply', who, title: cleanTitle, topicId, createdAt:r.created_at });
        if (wasNew) {
          const t = cleanTitle ? ` « ${cleanTitle} »` : '';
          showNotification({
            title:'Nouvelle réponse',
            text:`${who} a répondu à votre publication${t}`,
            actionHref:'#/community',
            actionLabel:'Voir',
            onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('reply'); }
          });
        }
      }
    } catch (err) {
      console.warn('fetchAnonMissedNotifications replies failed', err);
    }
    updateBadgeFromStore();
  }

  function stopAnonNotifPolling(){
    if (anonNotifTimer) {
      clearInterval(anonNotifTimer);
      anonNotifTimer = null;
    }
  }

  async function anonNotifTick(){
    try {
      await fetchAnonMissedNotifications();
    } catch (err) {
      console.warn('anon notification tick failed', err);
    }
  }

  function startAnonNotifPolling(){
    stopAnonNotifPolling();
    anonNotifTick();
    anonNotifTimer = setInterval(anonNotifTick, ANON_NOTIF_INTERVAL_MS);
  }
  function isNotifUnseen(id){
    try { return unseenNotifs().some(x => x.id === id); } catch { return false; }
  }
  function replayUnseenNotifs(){
    unseenNotifs().forEach(n => {
      if (n.kind==='msg') {
        showNotification({ title:'Nouveau message', text:`Vous avez un nouveau message de ${n.fromName||'Un parent'}`, actionHref:`messages.html?user=${n.fromId}`, actionLabel:'Ouvrir', onAcknowledge: () => { markNotifSeen(n.id); setNotifLastNow('msg'); } });
      } else if (n.kind==='reply') {
        const t = n.title ? ` « ${n.title} »` : '';
        showNotification({ title:'Nouvelle réponse', text:`${n.who||'Un parent'} a répondu à votre publication${t}`, actionHref:'#/community', actionLabel:'Voir', onAcknowledge: () => { markNotifSeen(n.id); setNotifLastNow('reply'); } });
      }
    });
  }

  // Gestion des horodatages de dernière vue pour récupérer les notifications manquées à la connexion
  function getNotifLast(){ return store.get(NOTIF_LAST_KEY, {}); }
  function setNotifLast(obj){ store.set(NOTIF_LAST_KEY, obj); }
  function getNotifLastSince(kind){ const o = getNotifLast(); return o[kind] || null; }
  function setNotifLastNow(kind){ const o = getNotifLast(); o[kind] = new Date().toISOString(); setNotifLast(o); }

  async function fetchMissedNotifications(){
    try {
      if (isAnonProfile()) {
        await fetchAnonMissedNotifications();
        return;
      }
      if (!useRemote()) return;
      const uid = getActiveProfileId(); if (!uid) return;
      const sinceDefault = new Date(Date.now() - 7*24*3600*1000).toISOString();
      const sinceMsg = getNotifLastSince('msg') || sinceDefault;
      const sinceRep = getNotifLastSince('reply') || sinceDefault;
      // Messages reçus depuis la dernière consultation
      const { data: msgs } = await supabase
        .from('messages')
        .select('id,sender_id,created_at')
        .eq('receiver_id', uid)
        .gt('created_at', sinceMsg)
        .order('created_at', { ascending:true })
        .limit(50);
      if (msgs && msgs.length) {
        const senders = Array.from(new Set(msgs.map(m=>m.sender_id)));
        let names = new Map();
        try {
          const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', senders);
          names = new Map((profs||[]).map(p=>[p.id, p.full_name]));
        } catch {}
        for (const m of msgs) {
          const senderId = String(m.sender_id);
          const fromName = names.get(m.sender_id) || 'Un parent';
          const notifId = `msg:${m.id}`;
          const wasNew = addNotif({ id:notifId, kind:'msg', fromId:senderId, fromName, createdAt:m.created_at });
          if (wasNew) {
            showNotification({ title:'Nouveau message', text:`Vous avez un nouveau message de ${fromName}`, actionHref:`messages.html?user=${senderId}`, actionLabel:'Ouvrir', onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('msg'); } });
          }
        }
      }
      // Réponses aux sujets que je possède ou où j’ai déjà commenté depuis la dernière visite
      const [{ data: topics }, { data: myReps }] = await Promise.all([
        supabase.from('forum_topics').select('id').eq('user_id', uid).limit(200),
        supabase.from('forum_replies').select('topic_id').eq('user_id', uid).limit(500)
      ]);
      const topicIdSet = new Set([...(topics||[]).map(t=>t.id), ...(myReps||[]).map(r=>r.topic_id)]);
      const topicIds = Array.from(topicIdSet);
      if (topicIds.length) {
        const { data: reps } = await supabase
          .from('forum_replies')
          .select('id,topic_id,user_id,created_at')
          .in('topic_id', topicIds)
          .neq('user_id', uid)
          .gt('created_at', sinceRep)
          .order('created_at', { ascending:true })
          .limit(100);
        if (reps && reps.length) {
          const userIds = Array.from(new Set(reps.map(r=>r.user_id)));
          let names = new Map();
          try {
            const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', userIds);
            names = new Map((profs||[]).map(p=>[p.id, p.full_name]));
          } catch {}
          // Nécessite également la table des titres
          let titleMap = new Map();
          try {
            const { data: ts } = await supabase.from('forum_topics').select('id,title').in('id', Array.from(new Set(reps.map(r=>r.topic_id))));
            titleMap = new Map((ts||[]).map(t=>[t.id, (t.title||'').replace(/^\[(.*?)\]\s*/, '')]));
          } catch {}
          for (const r of reps) {
            const who = names.get(r.user_id) || 'Un parent';
            const title = titleMap.get(r.topic_id) || '';
            const cleanTitle = title ? title.replace(/^\[(.*?)\]\s*/, '') : '';
            const notifId = `reply:${r.id}`;
            const wasNew = addNotif({ id:notifId, kind:'reply', who, title: cleanTitle, topicId:r.topic_id, createdAt:r.created_at });
            if (wasNew) {
              const t = cleanTitle ? ` « ${cleanTitle} »` : '';
              showNotification({ title:'Nouvelle réponse', text:`${who} a répondu à votre publication${t}`, actionHref:'#/community', actionLabel:'Voir', onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('reply'); } });
            }
          }
        }
      }
      updateBadgeFromStore();
    } catch (e) { console.warn('fetchMissedNotifications error', e); }
  }

  // Éviter de rejouer les notifications à chaque changement de route : garde par session
  function hasBootedNotifs(){ try { return sessionStorage.getItem(NOTIF_BOOT_FLAG) === '1'; } catch { return false; } }
  function markBootedNotifs(){ try { sessionStorage.setItem(NOTIF_BOOT_FLAG, '1'); } catch {} }

  function setupRealtimeNotifications(){
    try {
      stopAnonNotifPolling();
      if (isAnonProfile()) {
        startAnonNotifPolling();
        return;
      }
      if (!useRemote()) return;
      const uid = getActiveProfileId(); if (!uid) return;
      // Nettoyer les abonnements précédents
      try { for (const ch of notifChannels) supabase.removeChannel(ch); } catch {}
      notifChannels = [];
      // Nouveaux messages qui me sont adressés
      const chMsg = supabase
        .channel('notify-messages-'+uid)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${uid}`
        }, async (payload) => {
          const row = payload.new || {};
          const fromId = row.sender_id != null ? String(row.sender_id) : '';
          if (!fromId) return;
          // Résoudre le nom de l’expéditeur
          let fromName = 'Un parent';
          try {
            const { data } = await supabase.from('profiles').select('full_name').eq('id', fromId).maybeSingle();
            if (data?.full_name) fromName = data.full_name;
          } catch {}
          const notifId = `msg:${row.id}`;
          const wasNew = addNotif({ id:notifId, kind:'msg', fromId, fromName, createdAt: row.created_at });
          if (wasNew) {
            showNotification({
              title: 'Nouveau message',
              text: `Vous avez un nouveau message de ${fromName}`,
              actionHref: `messages.html?user=${fromId}`,
              actionLabel: 'Ouvrir',
              onAcknowledge: () => markNotifSeen(notifId)
            });
            updateBadgeFromStore();
          }
        })
        .subscribe();
      notifChannels.push(chMsg);

      // Réponses sur les sujets que je possède ou où j’ai déjà commenté
      const chRep = supabase
        .channel('notify-replies-'+uid)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'forum_replies'
        }, async (payload) => {
          const r = payload.new || {};
          if (!r?.topic_id) return;
          // Ignorer mes propres réponses
          if (String(r.user_id) === String(uid)) return;
          try {
            const { data: topic } = await supabase.from('forum_topics').select('id,user_id,title').eq('id', r.topic_id).maybeSingle();
            if (!topic) return;
            let isParticipant = String(topic.user_id) === String(uid);
            if (!isParticipant) {
              const { count } = await supabase
                .from('forum_replies')
                .select('id', { count: 'exact', head: true })
                .eq('topic_id', r.topic_id)
                .eq('user_id', uid);
              isParticipant = (count||0) > 0;
            }
            if (!isParticipant) return;
            // Résoudre le nom de l’auteur de la réponse
            let who = 'Un parent';
            try {
              const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', r.user_id).maybeSingle();
              if (prof?.full_name) who = prof.full_name;
            } catch {}
            const title = (topic.title||'').replace(/^\[(.*?)\]\s*/, '');
            const notifId = `reply:${r.id}`;
            const wasNew = addNotif({ id:notifId, kind:'reply', who, title, topicId: r.topic_id, createdAt: r.created_at });
            if (wasNew) {
              showNotification({
                title: 'Nouvelle réponse',
                text: `${who} a répondu à votre publication${title?` « ${title} »`:''}`,
                actionHref: '#/community',
                actionLabel: 'Voir',
                onAcknowledge: () => markNotifSeen(notifId)
              });
              updateBadgeFromStore();
            }
          } catch {}
        })
        .subscribe();
      notifChannels.push(chRep);
    } catch {}
  }

  // Remet les badges à zéro lorsque l’utilisateur visite les pages
  window.addEventListener('DOMContentLoaded', () => {
    const link = document.querySelector('#main-nav a[href="messages.html"]');
    // Messages : on masque seulement le badge au clic, la vraie lecture se fait en ouvrant la conversation
    link?.addEventListener('click', () => { try { setNavBadgeFor('messages.html', 0); } catch {} });
    const linkComm = document.querySelector('#main-nav a[href="#/community"]');
    linkComm?.addEventListener('click', () => { markAllByTypeSeen('reply'); });
  });

  // Marque les notifications communauté comme lues lors de la visite de la page dédiée
  const origSetActiveRoute = setActiveRoute;
  setActiveRoute = function(hash){
    origSetActiveRoute(hash);
    try {
      const path = normalizeRoutePath(hash);
      if (path === '/community') markAllByTypeSeen('reply');
    } catch {}
  };

  // Particules pastel dans le hero
  let heroParticlesState = { raf: 0, canvas: null, ctx: null, parts: [], lastT: 0, resize: null, observer: null, extra: 0, route: null, hero: null };
  function startHeroParticles(){
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const route = document.querySelector('section[data-route="/"]');
      if (!route) return;
      const hero = route.querySelector('.hero-v2') || route.querySelector('.hero');
      const cvs = document.getElementById('hero-canvas');
      if (!cvs) return;
      // Conserver le canvas dans le hero pour ne pas impacter le scroll de page
      if (cvs.parentElement !== hero && hero) hero.prepend(cvs);
      const width = hero ? hero.clientWidth : route.clientWidth;
      const height = hero ? hero.clientHeight : route.clientHeight;
      const extra = 0; // aucune zone supplémentaire : rester dans les limites du hero
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      // Réinitialiser la taille pour épouser la zone du hero
      cvs.style.left = '';
      cvs.style.top = '';
      cvs.style.right = '';
      cvs.style.bottom = '';
      cvs.style.width = '100%';
      cvs.style.height = '100%';
      cvs.width = Math.floor((width + extra) * dpr);
      cvs.height = Math.floor((height + extra) * dpr);
      const ctx = cvs.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      heroParticlesState.canvas = cvs;
      heroParticlesState.ctx = ctx;
      heroParticlesState.parts = [];
      heroParticlesState.extra = extra;
      heroParticlesState.route = route;
      heroParticlesState.hero = hero;
      // Palette dérivée des variables CSS
      const cs = getComputedStyle(document.documentElement);
      const palette = [
        cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
        cs.getPropertyValue('--orange').trim()||'#ffcba4',
        cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
        '#ffd9e6'
      ];
      const W = width, H = height;
      const isSmallScreen = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
      // Ajuster le nombre de particules sur les écrans petits ou économes en énergie
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const lowPower = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) || Math.min(W, H) < 520;
      const N = lowPower
        ? Math.max(8, Math.min(24, Math.round(W*H/80000)))
        : Math.max(20, Math.min(48, Math.round(W*H/45000)));
      for (let i=0;i<N;i++) {
        // Trois familles de tailles : petites (50 %), moyennes (35 %), grandes (15 %) avec des rayons distincts
        const u = Math.random();
        const r = u < .5 ? (5 + Math.random()*8)       // 5–13 px
                : (u < .85 ? (12 + Math.random()*12)   // 12–24 px
                : (22 + Math.random()*20));            // 22–42 px
        heroParticlesState.parts.push({
          x: Math.random()*W,
          y: Math.random()*H,
          r,
          vx: (Math.random()*.35 - .175),
          vy: (Math.random()*.35 - .175),
          hue: palette[Math.floor(Math.random()*palette.length)],
          alpha: (isSmallScreen ? .08 : .12) + Math.random()*(isSmallScreen ? .22 : .24),
          drift: Math.random()*Math.PI*2,
          spin: .0015 + Math.random()*.0035
        });
      }
      // Ajoute des particules supplémentaires concentrées autour du hero
      const heroH = hero?.offsetHeight || 0;
      const extraHeroParts = heroH ? Math.round(N * 0.3) : 0;
      for (let i=0; i<extraHeroParts; i++) {
        const u = Math.random();
        const r = u < .5 ? (5 + Math.random()*8)
                : (u < .85 ? (12 + Math.random()*12)
                : (22 + Math.random()*20));
        heroParticlesState.parts.push({
          x: Math.random()*W,
          y: Math.random()*heroH,
          r,
          vx: (Math.random()*.35 - .175),
          vy: (Math.random()*.35 - .175),
          hue: palette[Math.floor(Math.random()*palette.length)],
          alpha: (isSmallScreen ? .08 : .12) + Math.random()*(isSmallScreen ? .22 : .24),
          drift: Math.random()*Math.PI*2,
          spin: .0015 + Math.random()*.0035
        });
      }
      const step = (t)=>{
        const ctx = heroParticlesState.ctx; if (!ctx) return;
        const now = t || performance.now();
        const dt = heroParticlesState.lastT? Math.min(40, now - heroParticlesState.lastT) : 16;
        // Ne dessine rien si l’onglet est caché pour préserver batterie/CPU
        if (document.hidden) { heroParticlesState.lastT = now; heroParticlesState.raf = requestAnimationFrame(step); return; }
        heroParticlesState.lastT = now;
        const hero = heroParticlesState.hero;
        const W = hero ? hero.clientWidth : 0;
        const H = hero ? hero.clientHeight : 0;
        const extra = heroParticlesState.extra || 0;
        // Efface la zone de dessin
        ctx.clearRect(0,0,W+extra,H+extra);
        // Dessine chaque particule
        for (const p of heroParticlesState.parts){
          p.drift += p.spin*dt;
          p.x += p.vx + Math.cos(p.drift)*.05;
          p.y += p.vy + Math.sin(p.drift)*.05;
          // Remise en circulation quand une particule sort de l’aire
          if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
          if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.hue;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
        }
        heroParticlesState.raf = requestAnimationFrame(step);
      };
      cancelAnimationFrame(heroParticlesState.raf);
      heroParticlesState.raf = requestAnimationFrame(step);
      // Gestion du redimensionnement
      const onR = ()=>{
        const hero = heroParticlesState.hero;
        if (!hero) return;
        const width = hero.clientWidth;
        const height = hero.clientHeight;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const extra = heroParticlesState.extra || 0;
        cvs.width = Math.floor((width + extra) * dpr);
        cvs.height = Math.floor((height + extra) * dpr);
        heroParticlesState.ctx?.setTransform(dpr,0,0,dpr,0,0);
      };
      window.addEventListener('resize', onR);
      heroParticlesState.resize = onR;
      if (window.ResizeObserver && hero) {
        const ro = new ResizeObserver(onR);
        ro.observe(hero);
        heroParticlesState.observer = ro;
      }
    } catch {}
  }
  function stopHeroParticles(){
    try {
      cancelAnimationFrame(heroParticlesState.raf);
      heroParticlesState.raf = 0;
      if (heroParticlesState.resize) window.removeEventListener('resize', heroParticlesState.resize);
      heroParticlesState.resize = null;
      if (heroParticlesState.observer) { heroParticlesState.observer.disconnect(); heroParticlesState.observer = null; }
      if (heroParticlesState.ctx){
        const route = heroParticlesState.route;
        const extra = heroParticlesState.extra || 0;
        if (route) heroParticlesState.ctx.clearRect(-extra/2,-extra/2,route.clientWidth+extra,route.clientHeight+extra);
      }
      if (heroParticlesState.canvas){
        heroParticlesState.canvas.style.left = '';
        heroParticlesState.canvas.style.top = '';
        heroParticlesState.canvas.style.right = '';
        heroParticlesState.canvas.style.bottom = '';
        heroParticlesState.canvas.style.width = '';
        heroParticlesState.canvas.style.height = '';
        if (heroParticlesState.hero){
          heroParticlesState.hero.prepend(heroParticlesState.canvas);
        }
      }
      heroParticlesState.ctx = null; heroParticlesState.parts = [];
      heroParticlesState.extra = 0;
      heroParticlesState.route = null;
      heroParticlesState.hero = null;
    } catch {}
  }

    // Particules plein écran pour les routes (dashboard utilise un canvas fixe couvrant tout l’écran)
    let routeParticles = { cvs: null, ctx: null, parts: [], raf: 0, lastT: 0, resize: null, route: null, dpr: 1, observer: null };
  function startRouteParticles(){
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const route = document.querySelector('.route.active');
      if (!route) return;
      const routePath = route.getAttribute('data-route') || '';
      const isDashboard = routePath === '/dashboard';
      const isHome = routePath === '/';
      const cvs = document.createElement('canvas');
      // Dashboard : canvas fixe plein écran pour recouvrir toute la page
      if (isDashboard || isHome) {
        cvs.className = 'route-canvas route-canvas-fixed';
        // Empêche le canvas de bloquer les éléments d’interface
        cvs.style.pointerEvents = 'none';
        document.body.prepend(cvs);
      } else {
        cvs.className = 'route-canvas';
        cvs.style.pointerEvents = 'none';
        route.prepend(cvs);
      }
      const width = (isDashboard || isHome) ? window.innerWidth : route.clientWidth;
      const height = (isDashboard || isHome) ? window.innerHeight : route.scrollHeight;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      cvs.width = Math.floor(width * dpr);
      cvs.height = Math.floor(height * dpr);
      const ctx = cvs.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
        // Palette dérivée des variables CSS
        const cs = getComputedStyle(document.documentElement);
        const palette = [
          cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
          cs.getPropertyValue('--orange').trim()||'#ffcba4',
          cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
          '#ffd9e6'
        ];
        const W = width, H = height;
        const area = Math.max(1, W*H);
        const N = Math.max(14, Math.min(40, Math.round(area/52000)));
        const parts = [];
        const isSmallScreen = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
        for (let i=0;i<N;i++){
          const u = Math.random();
          const r = u < .5 ? (4 + Math.random()*7) : (u < .85 ? (10 + Math.random()*10) : (20 + Math.random()*18));
          parts.push({
            x: Math.random()*W,
            y: Math.random()*H,
            r,
            vx:(Math.random()*.28 - .14),
            vy:(Math.random()*.28 - .14),
            hue: palette[Math.floor(Math.random()*palette.length)],
            alpha:(isSmallScreen ? .08 : .12) + Math.random()*(isSmallScreen ? .22 : .24),
            drift: Math.random()*Math.PI*2,
            spin:.001 + Math.random()*.003
          });
        }
        routeParticles = { cvs, ctx, parts, raf: 0, lastT: 0, resize: null, route, dpr, observer: null };
      const step = (t)=>{
        const now = t || performance.now();
        const dt = routeParticles.lastT ? Math.min(40, now - routeParticles.lastT) : 16;
        routeParticles.lastT = now;
        const W = (isDashboard || isHome) ? window.innerWidth : route.clientWidth;
        const H = (isDashboard || isHome) ? window.innerHeight : route.scrollHeight;
        const dpr = routeParticles.dpr;
        ctx.setTransform(dpr,0,0,dpr,0,0);
        ctx.clearRect(0,0,W,H);
        for (const p of routeParticles.parts){
          p.drift += p.spin*dt;
            p.x += p.vx + Math.cos(p.drift)*.04;
            p.y += p.vy + Math.sin(p.drift)*.04;
            if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
            if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.hue;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
          }
          routeParticles.raf = requestAnimationFrame(step);
        };
        routeParticles.raf = requestAnimationFrame(step);
      const onR = ()=>{
        const width = (isDashboard || isHome) ? window.innerWidth : route.clientWidth;
        const height = (isDashboard || isHome) ? window.innerHeight : route.scrollHeight;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        cvs.width = Math.floor(width * dpr);
        cvs.height = Math.floor(height * dpr);
        routeParticles.dpr = dpr;
        routeParticles.ctx?.setTransform(dpr,0,0,dpr,0,0);
      };
        window.addEventListener('resize', onR);
        routeParticles.resize = onR;
        if (!isDashboard && window.ResizeObserver) {
          const ro = new ResizeObserver(onR);
          ro.observe(route);
          routeParticles.observer = ro;
        }
      } catch {}
    }
    function stopRouteParticles(){
      try {
        cancelAnimationFrame(routeParticles.raf);
        routeParticles.raf = 0;
        if (routeParticles.resize) window.removeEventListener('resize', routeParticles.resize);
        routeParticles.resize = null;
        routeParticles.observer?.disconnect();
        routeParticles.observer = null;
        routeParticles.cvs?.remove();
        routeParticles = { cvs: null, ctx: null, parts: [], raf: 0, lastT: 0, resize: null, route: null, dpr: 1, observer: null };
      } catch {}
    }

    // Particules autour du logo supérieur (affiché sur les routes hors accueil)
    let logoParticles = { cvs: null, ctx: null, parts: [], raf: 0, lastT: 0, resize: null, el: null, dpr: 1 };
    function startLogoParticles(){
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const wrap = document.querySelector('#page-logo .container');
        if (!wrap || wrap.offsetParent === null) return;
        const cvs = document.createElement('canvas');
        cvs.className = 'logo-canvas';
        wrap.prepend(cvs);
        const width = wrap.clientWidth;
        const height = wrap.clientHeight;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        cvs.width = Math.floor(width * dpr);
        cvs.height = Math.floor(height * dpr);
        const ctx = cvs.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
        const cs = getComputedStyle(document.documentElement);
        const palette = [
          cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
          cs.getPropertyValue('--orange').trim()||'#ffcba4',
          cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
          '#ffd9e6'
        ];
        const W = width, H = height;
        const area = Math.max(1, W*H);
        const N = Math.max(6, Math.min(16, Math.round(area/20000)));
        const parts = [];
        for (let i=0;i<N;i++){
          const u = Math.random();
          const r = u < .5 ? (3 + Math.random()*5) : (u < .85 ? (8 + Math.random()*8) : (16 + Math.random()*12));
          parts.push({
            x: Math.random()*W,
            y: Math.random()*H,
            r,
            vx:(Math.random()*.25 - .125),
            vy:(Math.random()*.25 - .125),
            hue: palette[Math.floor(Math.random()*palette.length)],
            alpha:.10 + Math.random()*.20,
            drift: Math.random()*Math.PI*2,
            spin:.001 + Math.random()*.003
          });
        }
        logoParticles = { cvs, ctx, parts, raf: 0, lastT: 0, resize: null, el: wrap, dpr };
        const step = (t)=>{
          const now = t || performance.now();
          const dt = logoParticles.lastT ? Math.min(40, now - logoParticles.lastT) : 16;
          logoParticles.lastT = now;
          const W = wrap.clientWidth, H = wrap.clientHeight;
          const dpr = logoParticles.dpr;
          ctx.setTransform(dpr,0,0,dpr,0,0);
          ctx.clearRect(0,0,W,H);
          for (const p of logoParticles.parts){
            p.drift += p.spin*dt;
            p.x += p.vx + Math.cos(p.drift)*.04;
            p.y += p.vy + Math.sin(p.drift)*.04;
            if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
            if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.hue;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
          }
          logoParticles.raf = requestAnimationFrame(step);
        };
        logoParticles.raf = requestAnimationFrame(step);
        const onR = ()=>{
          const width = wrap.clientWidth;
          const height = wrap.clientHeight;
          const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          cvs.width = Math.floor(width * dpr);
          cvs.height = Math.floor(height * dpr);
          logoParticles.dpr = dpr;
          logoParticles.ctx?.setTransform(dpr,0,0,dpr,0,0);
        };
        window.addEventListener('resize', onR);
        logoParticles.resize = onR;
      } catch {}
    }
    function stopLogoParticles(){
      try {
        cancelAnimationFrame(logoParticles.raf);
        logoParticles.raf = 0;
        if (logoParticles.resize) window.removeEventListener('resize', logoParticles.resize);
        logoParticles.resize = null;
        logoParticles.cvs?.remove();
        logoParticles = { cvs: null, ctx: null, parts: [], raf: 0, lastT: 0, resize: null, el: null, dpr: 1 };
      } catch {}
    }

    // Particules pour certaines sections de l’accueil (mobile uniquement)
    let sectionParticlesStates = [];
    function startSectionParticles(){
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches)) return;
        stopSectionParticles();
        const root = document.querySelector('section[data-route="/"]');
        if (!root) return;
        const sections = Array.from(root.querySelectorAll(':scope > .section.bubble-mobile'));
        sections.forEach(sec => {
          const cvs = document.createElement('canvas');
          cvs.className = 'section-canvas';
          sec.prepend(cvs);
          const ctx = cvs.getContext('2d');
          const state = { sec, cvs, ctx, parts: [], raf: 0, lastT: 0, resize: null, observer: null, dpr: 1 };
          const resize = ()=>{
            const rect = sec.getBoundingClientRect();
            const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
            cvs.width = Math.floor(rect.width * dpr);
            cvs.height = Math.floor(rect.height * dpr);
            ctx.setTransform(dpr,0,0,dpr,0,0);
            state.dpr = dpr;
            return rect;
          };
          const rect = resize();
          const cs = getComputedStyle(document.documentElement);
          const palette = [
            cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
            cs.getPropertyValue('--orange').trim()||'#ffcba4',
            cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
            '#ffd9e6'
          ];
          const W = rect.width, H = rect.height;
          const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
          const lowPower = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) || Math.min(W,H) < 520;
          const N = lowPower ? Math.max(8, Math.min(24, Math.round(W*H/80000))) : Math.max(20, Math.min(48, Math.round(W*H/45000)));
          for (let i=0;i<N;i++){
            const u = Math.random();
            const r = u < .5 ? (5 + Math.random()*8) : (u < .85 ? (12 + Math.random()*12) : (22 + Math.random()*20));
            state.parts.push({
              x: Math.random()*W,
              y: Math.random()*H,
              r,
              vx: (Math.random()*.35 - .175),
              vy: (Math.random()*.35 - .175),
              hue: palette[Math.floor(Math.random()*palette.length)],
              alpha: .08 + Math.random()*.24,
              drift: Math.random()*Math.PI*2,
              spin: .0015 + Math.random()*.0035
            });
          }
          const step = (t)=>{
            const now = t || performance.now();
            const dt = state.lastT ? Math.min(40, now - state.lastT) : 16;
            state.lastT = now;
            const W = sec.clientWidth, H = sec.clientHeight;
            const dpr = state.dpr;
            ctx.setTransform(dpr,0,0,dpr,0,0);
            ctx.clearRect(0,0,W,H);
            for (const p of state.parts){
              p.drift += p.spin*dt;
              p.x += p.vx + Math.cos(p.drift)*.05;
              p.y += p.vy + Math.sin(p.drift)*.05;
              if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
              if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
              ctx.globalAlpha = p.alpha;
              ctx.fillStyle = p.hue;
              ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
            }
            state.raf = requestAnimationFrame(step);
          };
          state.raf = requestAnimationFrame(step);
          window.addEventListener('resize', resize);
          state.resize = resize;
          if (window.ResizeObserver) {
            const ro = new ResizeObserver(resize);
            ro.observe(sec);
            state.observer = ro;
          }
          sectionParticlesStates.push(state);
        });
      } catch {}
    }
    function stopSectionParticles(){
      try {
        sectionParticlesStates.forEach(st => {
          cancelAnimationFrame(st.raf); st.raf=0;
          st.ctx?.clearRect(0,0,st.cvs.width, st.cvs.height);
          st.cvs.remove();
          st.observer?.disconnect();
          if (st.resize) window.removeEventListener('resize', st.resize);
        });
        sectionParticlesStates = [];
      } catch {}
    }

  let cardParticlesStates = [];
  function startCardParticles(){
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches)) return;
      stopCardParticles();
      const root = document.querySelector('section[data-route="/"]');
      if (!root) return;
      const cards = Array.from(root.querySelectorAll('.card'));
      cards.forEach(card => {
        const cvs = document.createElement('canvas');
        cvs.className = 'card-canvas';
        card.prepend(cvs);
        const ctx = cvs.getContext('2d');
        const state = { el: card, cvs, ctx, parts: [], raf: 0, lastT: 0, ro: null, dpr: 1 };
        const resize = ()=>{
          const rect = card.getBoundingClientRect();
          const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          cvs.width = Math.floor(rect.width * dpr);
          cvs.height = Math.floor(rect.height * dpr);
          ctx.setTransform(dpr,0,0,dpr,0,0);
          state.dpr = dpr;
          return rect;
        };
        const rect = resize();
        const cs = getComputedStyle(document.documentElement);
        const palette = [
          cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
          cs.getPropertyValue('--orange').trim()||'#ffcba4',
          cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
          '#ffd9e6'
        ];
        const W = rect.width, H = rect.height;
        const area = Math.max(1, W*H);
        const isSmallScreen = true;
        const N = Math.max(8, Math.min(24, Math.round(area/52000)));
        for (let i=0;i<N;i++){
          const u = Math.random();
          const r = u < .5 ? (4 + Math.random()*7) : (u < .85 ? (10 + Math.random()*10) : (20 + Math.random()*18));
          state.parts.push({
            x: Math.random()*W,
            y: Math.random()*H,
            r,
            vx: (Math.random()*.28 - .14),
            vy: (Math.random()*.28 - .14),
            hue: palette[Math.floor(Math.random()*palette.length)],
            alpha: (.08) + Math.random()*.22,
            drift: Math.random()*Math.PI*2,
            spin: .001 + Math.random()*.003
          });
        }
        const step = (t)=>{
          const now = t || performance.now();
          const dt = state.lastT? Math.min(40, now - state.lastT) : 16;
          state.lastT = now;
          const W = card.clientWidth, H = card.clientHeight;
          const dpr = state.dpr;
          ctx.setTransform(dpr,0,0,dpr,0,0);
          ctx.clearRect(0,0,W,H);
          for (const p of state.parts){
            p.drift += p.spin*dt;
            p.x += p.vx + Math.cos(p.drift)*.04;
            p.y += p.vy + Math.sin(p.drift)*.04;
            if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
            if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.hue;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
          }
          state.raf = requestAnimationFrame(step);
        };
        state.raf = requestAnimationFrame(step);
        if (window.ResizeObserver) {
          const rObs = new ResizeObserver(resize);
          rObs.observe(card);
          state.ro = rObs;
        }
        cardParticlesStates.push(state);
      });
      const onR = ()=>{
        cardParticlesStates.forEach(st => {
          const rect = st.el.getBoundingClientRect();
          const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          st.cvs.width = Math.floor(rect.width * dpr);
          st.cvs.height = Math.floor(rect.height * dpr);
          st.ctx.setTransform(dpr,0,0,dpr,0,0);
          st.dpr = dpr;
        });
      };
      window.addEventListener('resize', onR);
      startCardParticles._resize = onR;
    } catch {}
  }
  function stopCardParticles(){
    try {
      (cardParticlesStates||[]).forEach(st => { cancelAnimationFrame(st.raf); st.raf=0; st.ctx?.clearRect(0,0,st.cvs.width, st.cvs.height); st.cvs.remove(); st.ro?.disconnect(); });
      cardParticlesStates = [];
      if (startCardParticles._resize) window.removeEventListener('resize', startCardParticles._resize);
      startCardParticles._resize = null;
    } catch {}
  }

  // Boutons d’authentification de l’en-tête
  function updateHeaderAuth() {
    const logged = isProfileLoggedIn();
    $('#btn-login').hidden = logged;
    $('#btn-logout').hidden = !logged;
    $('#login-status').hidden = !logged;
  }

  function setActiveProfile(profile) {
    if (profile && profile.id) {
      activeProfile = {
        id: profile.id,
        full_name: profile.full_name || '',
        code_unique: profile.code_unique ? String(profile.code_unique).trim().toUpperCase() : null,
        user_id: profile.user_id ?? null,
        isAnonymous: profile.isAnonymous ?? false,
      };
    } else {
      activeProfile = null;
    }
    if (activeProfile && activeProfile.isAnonymous && activeProfile.code_unique) {
      store.set(K.session, {
        type: 'anon',
        code: activeProfile.code_unique,
        id: activeProfile.id,
        fullName: activeProfile.full_name || '',
        loggedIn: true
      });
    } else {
      try { store.del(K.session); } catch {}
    }
    updateHeaderAuth();
    if (activeProfile && activeProfile.isAnonymous) {
      try {
        setupRealtimeNotifications();
        updateBadgeFromStore();
        fetchMissedNotifications();
        if (!hasBootedNotifs()) { replayUnseenNotifs(); markBootedNotifs(); }
      } catch (err) {
        console.warn('Anonymous notifications init failed', err);
      }
    } else {
      stopAnonNotifPolling();
    }
  }

  function restoreAnonSession() {
    try {
      const saved = store.get(K.session);
      if (saved?.type === 'anon' && saved?.code) {
        setActiveProfile({
          id: saved.id,
          full_name: saved.fullName || '',
          code_unique: saved.code,
          user_id: null,
          isAnonymous: true,
        });
        const currentHash = location?.hash || '';
        if (currentHash === '' || currentHash === '#' || currentHash === '#/login' || currentHash === '#/signup') {
          location.hash = '#/dashboard';
        }
        return true;
      }
    } catch {}
    return false;
  }

  // Garantir l’existence d’une ligne profil pour l’utilisateur authentifié sans écraser son pseudo
  async function ensureProfile(user){
    try {
      if (!supabase || !user?.id) return;
      const uid = user.id;
      const metaName = user.user_metadata?.full_name || user.email || '';
      // Vérifier si un profil existe déjà
      const { data: existing, error: selErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', uid)
        .maybeSingle();
      if (selErr) throw selErr;
      if (!existing) {
        // Insérer un nouveau profil avec les métadonnées par défaut (pas d’avatar)
        await supabase.from('profiles').insert({ id: uid, full_name: metaName });
      } else {
        // Ne pas écraser un full_name choisi par l’utilisateur ; rien d’autre à mettre à jour
      }
    } catch (e) {
      if (DEBUG_AUTH) console.warn('ensureProfile failed', e);
    }
  }

  // Garder le pseudo local synchronisé avec le profil Supabase
  async function syncUserFromSupabase() {
    try {
      if (!supabase) return;
      const uid = authSession?.user?.id || getActiveProfileId();
      if (!uid) return;
      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, full_name, code_unique')
        .eq('id', uid)
        .maybeSingle();
      if (error) throw error;
      if (prof) {
        setActiveProfile({ ...prof, isAnonymous: false });
      } else {
        setActiveProfile({ id: uid, isAnonymous: false });
      }
      const current = store.get(K.user) || {};
      const pseudo = prof?.full_name || current.pseudo || '';
      if (pseudo !== current.pseudo) {
        store.set(K.user, { ...current, pseudo });
      }
    } catch (e) {
      if (DEBUG_AUTH) console.warn('syncUserFromSupabase failed', e);
    }
  }
  async function ensureSupabaseClient() {
    if (supabase) return true;
    try {
      const env = await fetch('/api/env').then(r => r.json());
      if (!env?.url || !env?.anonKey) throw new Error('Env manquante');
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      supabase = createClient(env.url, env.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      return true;
    } catch (e) {
      console.warn('ensureSupabaseClient failed', e);
      return false;
    }
  }

  async function signInGoogle(){
    try {
      const ok = await ensureSupabaseClient();
      if (!ok) throw new Error('Supabase indisponible');
      await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } });
    } catch (e) { alert('Connexion Google indisponible'); }
  }
  async function createAnonymousProfile() {
    const status = $('#anon-create-status');
    const btn = $('#btn-create-anon');
    if (btn?.dataset.busy === '1') return;
    status?.classList.remove('error');
    if (status) status.textContent = '';
    const ok = await ensureSupabaseClient();
    if (!ok) {
      if (status) { status.classList.add('error'); status.textContent = 'Service indisponible pour le moment.'; }
      return;
    }
    try {
      if (btn) { btn.dataset.busy = '1'; btn.disabled = true; }
      const response = await fetch('/api/profiles/create-anon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok || !payload?.profile) {
        const msg = payload?.error || 'Création impossible pour le moment.';
        const err = new Error(msg);
        if (payload?.details) err.details = payload.details;
        throw err;
      }
      const data = payload.profile;
      // Ne pas connecter automatiquement l’utilisateur : on lui fournit le code et on le laisse se connecter manuellement.
      setActiveProfile(null);
      authSession = null;
      if (status) {
        status.classList.remove('error');
        status.innerHTML = `Ton code unique : <strong>${data.code_unique}</strong>.<br>Garde-le précieusement et saisis-le juste en dessous dans « Se connecter avec un code ».`;
      }
      const inputCode = $('#anon-code-input');
      if (inputCode) {
        inputCode.value = data.code_unique || '';
        inputCode.focus();
        try { inputCode.select(); } catch {}
      }
    } catch (e) {
      console.error('createAnonymousProfile failed', e);
      if (status) {
        status.classList.add('error');
        const msg = (e && typeof e.message === 'string' && e.message.trim()) ? e.message : 'Création impossible pour le moment.';
        status.textContent = msg;
      }
    } finally {
      if (btn) { btn.dataset.busy = '0'; btn.disabled = false; }
    }
  }

  async function loginWithCode() {
    const input = $('#anon-code-input');
    const status = $('#anon-login-status');
    const btn = $('#btn-login-code');
    if (btn?.dataset.busy === '1') return;
    const rawCode = (input?.value || '').trim();
    const code = rawCode.toUpperCase();
    if (input) input.value = code;
    status?.classList.remove('error');
    if (!code) {
      if (status) { status.classList.add('error'); status.textContent = 'Saisis ton code unique pour continuer.'; }
      input?.focus();
      return;
    }
    if (status) status.textContent = '';
    const ok = await ensureSupabaseClient();
    if (!ok) {
      if (status) { status.classList.add('error'); status.textContent = 'Service indisponible pour le moment.'; }
      return;
    }
    try {
      if (btn) { btn.dataset.busy = '1'; btn.disabled = true; }
      const { data, error } = await supabase
        .from('profiles')
        .select('id, code_unique, full_name, user_id')
        .eq('code_unique', code)
        .single();
      if (error) {
        if (status && (error.code === 'PGRST116' || (error.message || '').includes('Row not found'))) {
          status.classList.add('error'); status.textContent = 'Code invalide.';
          return;
        }
        throw error;
      }
      if (!data) {
        if (status) { status.classList.add('error'); status.textContent = 'Code invalide.'; }
        return;
      }
      setActiveProfile({ ...data, isAnonymous: !data.user_id });
      authSession = null;
      const current = store.get(K.user) || {};
      const pseudo = data.full_name || '';
      if (pseudo !== current.pseudo) {
        store.set(K.user, { ...current, pseudo });
      }
      if (status) { status.classList.remove('error'); status.textContent = ''; }
      if (input) input.value = '';
      location.hash = '#/dashboard';
    } catch (e) {
      console.error('loginWithCode failed', e);
      if (status) { status.classList.add('error'); status.textContent = 'Connexion impossible pour le moment.'; }
    } finally {
      if (btn) { btn.dataset.busy = '0'; btn.disabled = false; }
    }
  }

  function redirectToLogin() {
    const targetHash = '#/login';
    if (location.hash === targetHash) return;
    if (location.hash.startsWith('#/')) {
      location.hash = targetHash;
      return;
    }
    const path = location.pathname || '';
    if (path === '/' || path.endsWith('/') || path.endsWith('/index.html')) {
      location.hash = targetHash;
      return;
    }
    let basePath = path;
    if (path.endsWith('.html')) {
      basePath = path.replace(/[^/]*$/, '');
    } else if (!path.endsWith('/')) {
      basePath = `${path}/`;
    }
    if (!basePath.startsWith('/')) {
      basePath = `/${basePath}`;
    }
    location.href = `${basePath}${targetHash}`;
  }

  $('#btn-login').addEventListener('click', (e) => {
    e.preventDefault();
    redirectToLogin();
  });
  // Boutons des pages /login et /signup (délégation d’événements pour plus de robustesse)
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('.btn-google-login') : null;
    if (t) {
      e.preventDefault();
      if (t.dataset.busy === '1') return;
      t.dataset.busy = '1';
      t.setAttribute('aria-disabled','true');
      signInGoogle();
    }
  });
  $('#btn-create-anon')?.addEventListener('click', (e) => {
    e.preventDefault();
    createAnonymousProfile();
  });

  $('#btn-login-code')?.addEventListener('click', (e) => {
    e.preventDefault();
    loginWithCode();
  });

  $('#anon-code-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loginWithCode();
    }
  });

  $('#btn-logout').addEventListener('click', async (e) => {
    const btn = e.currentTarget; if (btn.dataset.busy==='1') return; btn.dataset.busy='1'; btn.disabled = true;
    try { if (authSession?.user) { await supabase?.auth.signOut(); } } catch {}
    setActiveProfile(null);
    authSession = null;
    try { if (supabase) { for (const ch of notifChannels) await supabase.removeChannel(ch); } } catch {}
    notifChannels = [];
    alert('Déconnecté.');
    updateHeaderAuth();
    location.hash = '#/login';
  });

  // Bascule du menu mobile
  navBtn?.addEventListener('click', () => {
    const isOpen = mainNav?.classList.toggle('open');
    navBtn.setAttribute('aria-expanded', String(!!isOpen));
    if (isOpen) navBackdrop?.classList.add('open'); else navBackdrop?.classList.remove('open');
  });
  // Ferme le menu lorsqu’un lien est cliqué (mobile)
  $$('.main-nav .nav-link').forEach(a => a.addEventListener('click', closeMobileNav));

  // Ferme le menu lors d’un appui sur l’arrière-plan
  navBackdrop?.addEventListener('click', closeMobileNav);

  // Parcours d’authentification
  $('#form-signup')?.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Veuillez utiliser "Se connecter avec Google".');
    location.hash = '#/login';
  });

  $('#form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.dataset.busy==='1') return; f.dataset.busy='1';
    const btn = f.querySelector('button[type="submit"],input[type="submit"]'); if (btn) btn.disabled = true;
    try { await signInGoogle(); } finally { /* redirect expected; keep disabled */ }
  });

  function logout() { /* replaced by supabase signOut above */ }

  // Contact (démo : enregistrement local)
  function setupContact(){
    const form = $('#form-contact');
    const status = $('#contact-status');
    if (!form) return;
    if (!form.dataset.bound) form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (form.dataset.busy === '1') return;
      form.dataset.busy = '1';
      const btn = form.querySelector('button[type="submit"],input[type="submit"]'); if (btn) btn.disabled = true;
      try {
        const fd = new FormData(form);
        const entry = {
          email: fd.get('email').toString(),
          subject: fd.get('subject').toString(),
          message: fd.get('message').toString(),
          createdAt: Date.now()
        };
        const msgs = store.get(K.messages, []);
        msgs.push(entry);
        store.set(K.messages, msgs);
        form.reset();
        if (status) status.textContent = 'Merci ! Votre message a été enregistré (démo locale).';
      } finally {
        form.dataset.busy = '0'; if (btn) btn.disabled = false;
      }
    }); form && (form.dataset.bound='1');
  }

  // Newsletter (démo: enregistrement local + feedback)
  function setupNewsletter(){
    const form = document.getElementById('form-newsletter');
    if (!form || form.dataset.bound) return;
    const emailInput = form.querySelector('input[type="email"]');
    const status = document.getElementById('newsletter-status');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!emailInput) return;
      // Champ piège anti-bot
      const fd = new FormData(form);
      const trap = (fd.get('website')||'').toString().trim();
      if (trap) { return; }
      // Validation côté client
      const email = (fd.get('email')||'').toString().trim();
      if (!email) {
        if (status){ status.textContent = 'Veuillez renseigner votre email.'; status.classList.add('error'); }
        emailInput.focus();
        return;
      }
      if (emailInput && emailInput.checkValidity && !emailInput.checkValidity()){
        if (status){ status.textContent = 'Adresse e‑mail invalide.'; status.classList.add('error'); }
        emailInput.focus();
        return;
      }
      if (status){ status.textContent = ''; status.classList.remove('error'); }
      if (form.dataset.busy==='1') return; form.dataset.busy='1';
      const btn = form.querySelector('button[type="submit"],input[type="submit"]'); if (btn) btn.disabled = true;
      try {
        // Démo locale: on stocke en localStorage puis feedback
        const list = store.get('pedia_newsletter', []);
        list.push({ email, createdAt: Date.now() });
        store.set('pedia_newsletter', list);
        form.reset();
        if (status){ status.textContent = 'Merci ! Vous êtes bien inscrit(e) à la newsletter.'; status.classList.remove('error'); }
      } finally {
        form.dataset.busy='0'; if (btn) btn.disabled = false;
      }
    });
    form.dataset.bound='1';
  }

  // --- Gestion de la page IA ---
  function setupAIPage(){
    // Déterminer l’enfant courant via Supabase si connecté, sinon via le stockage local
    let currentChild = null;
    const loadChild = async () => {
      if (useRemote()) {
        try {
          if (isAnonProfile()) {
            const list = await anonChildRequest('list', {});
            const rows = Array.isArray(list.children) ? list.children : [];
            if (!rows.length) {
              const user = store.get(K.user);
              const children = store.get(K.children, []);
              return children.find(c => c.id === user?.primaryChildId) || children[0] || null;
            }
            const primaryRow = rows.find(x => x.is_primary) || rows[0];
            if (!primaryRow) return null;
            const detail = await anonChildRequest('get', { childId: primaryRow.id });
            const data = detail.child;
            if (!data) return null;
            const child = mapRowToChild(data);
            if (!child) return null;
            const growth = detail.growth || {};
            (growth.measurements || []).forEach(m => {
              const h = Number(m?.height_cm);
              const w = Number(m?.weight_kg);
              const heightValid = Number.isFinite(h);
              const weightValid = Number.isFinite(w);
              child.growth.measurements.push({
                month: m.month,
                height: heightValid ? h : null,
                weight: weightValid ? w : null,
                bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at
              });
            });
            (growth.sleep || []).forEach(s => child.growth.sleep.push({ month: s.month, hours: s.hours }));
            (growth.teeth || []).forEach(t => child.growth.teeth.push({ month: t.month, count: t.count }));
            return child;
          }
          const uid = authSession?.user?.id || getActiveProfileId();
          if (!uid) {
            console.warn("Aucun user_id disponible pour la requête children (loadChild) — fallback local");
            const user = store.get(K.user);
            const children = store.get(K.children, []);
            return children.find(c => c.id === user?.primaryChildId) || children[0] || null;
          }
          const { data: rows } = await supabase.from('children').select('*').eq('user_id', uid).order('created_at', { ascending: true });
          const r = (rows||[]).find(x=>x.is_primary) || (rows||[])[0];
          if (r) {
            const child = mapRowToChild(r);
            if (!child) return null;
            try {
              const [{ data: gm }, { data: gs }, { data: gt }] = await Promise.all([
                supabase.from('growth_measurements').select('month,height_cm,weight_kg,created_at').eq('child_id', r.id),
                supabase.from('growth_sleep').select('month,hours').eq('child_id', r.id),
                supabase.from('growth_teeth').select('month,count').eq('child_id', r.id),
              ]);
              (gm||[])
                .map(m => {
                  const h = m.height_cm == null ? null : Number(m.height_cm);
                  const w = m.weight_kg == null ? null : Number(m.weight_kg);
                  return {
                    month: m.month,
                    height: h,
                    weight: w,
                    bmi: w && h ? w / Math.pow(h / 100, 2) : null,
                    measured_at: m.created_at
                  };
                })
                .forEach(m => child.growth.measurements.push(m));
              (gs||[]).forEach(s=> child.growth.sleep.push({ month: s.month, hours: s.hours }));
              (gt||[]).forEach(t=> child.growth.teeth.push({ month: t.month, count: t.count }));
            } catch {}
            return child;
          }
        } catch {}
      } else {
        const user = store.get(K.user);
        const children = store.get(K.children, []);
        const c = children.find(c => c.id === user?.primaryChildId) || children[0];
        if (c) return c;
      }
      return null;
    };

    const loadChildById = async (id) => {
      if (!id) return null;
      if (useRemote()) {
        try {
          if (isAnonProfile()) {
            const detail = await anonChildRequest('get', { childId: id });
            const data = detail.child;
            if (!data) return null;
            const ch = mapRowToChild(data);
            if (!ch) return null;
            const growth = detail.growth || {};
            (growth.measurements || []).forEach(m => {
              const h = Number(m?.height_cm);
              const w = Number(m?.weight_kg);
              const heightValid = Number.isFinite(h);
              const weightValid = Number.isFinite(w);
              ch.growth.measurements.push({
                month: m.month,
                height: heightValid ? h : null,
                weight: weightValid ? w : null,
                bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at
              });
            });
            (growth.sleep || []).forEach(s => ch.growth.sleep.push({ month: s.month, hours: s.hours }));
            (growth.teeth || []).forEach(t => ch.growth.teeth.push({ month: t.month, count: t.count }));
            return ch;
          }
          const uid = getActiveProfileId();
          if (!uid) {
            console.warn("Aucun user_id disponible pour la requête children (loadChildById) — fallback local");
            const children = store.get(K.children, []);
            return children.find(c=>c.id===id) || null;
          }
          const { data: r } = await supabase.from('children').select('*').eq('id', id).maybeSingle();
          if (!r) return null;
          const ch = mapRowToChild(r);
          if (!ch) return null;
          try {
              const [{ data: gm }, { data: gs }, { data: gt }] = await Promise.all([
                supabase.from('growth_measurements').select('month,height_cm,weight_kg,created_at').eq('child_id', r.id),
                supabase.from('growth_sleep').select('month,hours').eq('child_id', r.id),
                supabase.from('growth_teeth').select('month,count').eq('child_id', r.id),
              ]);
              (gm||[])
                .map(m => {
                  const h = m.height_cm == null ? null : Number(m.height_cm);
                  const w = m.weight_kg == null ? null : Number(m.weight_kg);
                  return {
                    month: m.month,
                    height: h,
                    weight: w,
                    bmi: w && h ? w / Math.pow(h / 100, 2) : null,
                    measured_at: m.created_at
                  };
                })
                .forEach(m => ch.growth.measurements.push(m));
            (gs||[]).forEach(s=> ch.growth.sleep.push({ month: s.month, hours: s.hours }));
            (gt||[]).forEach(t=> ch.growth.teeth.push({ month: t.month, count: t.count }));
          } catch {}
          return ch;
        } catch { return null; }
      }
      const children = store.get(K.children, []);
      return children.find(c=>c.id===id) || null;
    };

    // Helpers d’historique de chat (local, par enfant)
    const chatKey = (c) => `pedia_ai_chat_${c?.id||'anon'}`;
    const loadChat = (c) => { try { return JSON.parse(localStorage.getItem(chatKey(c))||'[]'); } catch { return []; } };
    const saveChat = (c, arr) => { try { localStorage.setItem(chatKey(c), JSON.stringify(arr.slice(-20))); } catch {} };
    const renderChat = (arr) => {
      const el = document.getElementById('ai-chat-messages');
      if (!el) return;
      const userRole = store.get(K.user)?.role;
      const userAvatar = userRole === 'papa' ? '👨' : '👩';
      el.innerHTML = arr.map(m=>{
        const role = m.role==='user' ? 'user' : 'assistant';
        const avatar = role==='user' ? userAvatar : '🤖';
        const label = role==='user' ? 'Vous' : 'Assistant';
        return `<div class=\"chat-line ${role}\"><div class=\"avatar\">${avatar}</div><div class=\"message\"><div class=\"meta\">${label}</div><div class=\"bubble ${role}\">${escapeHtml(m.content).replace(/\\n/g,'<br/>')}</div></div></div>`;
      }).join('');
      el.scrollTo({ top: el.scrollHeight, behavior:'smooth' });
    };

    // Recettes
    const fRecipes = document.getElementById('form-ai-recipes');
    const sRecipes = document.getElementById('ai-recipes-status');
    const outRecipes = document.getElementById('ai-recipes-result');
    if (fRecipes && !fRecipes.dataset.bound) fRecipes.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (fRecipes.dataset.busy === '1') return;
      fRecipes.dataset.busy = '1';
      const submitBtn = fRecipes.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
      if (!currentChild) { outRecipes.innerHTML = '<div class="muted">Ajoutez un profil enfant pour des recommandations personnalisées.</div>'; return; }
      const prefs = new FormData(fRecipes).get('prefs')?.toString() || '';
      sRecipes.textContent = 'Génération en cours…'; outRecipes.innerHTML='';
      try {
        const text = await askAIRecipes(currentChild, prefs);
        outRecipes.innerHTML = `<div>${escapeHtml(text).replace(/\n/g,'<br/>')}</div>`;
      } catch (err){
        outRecipes.innerHTML = `<div class="muted">Serveur IA indisponible.</div>`;
      } finally { sRecipes.textContent=''; fRecipes.dataset.busy='0'; if (submitBtn) submitBtn.disabled = false; }
    }); fRecipes && (fRecipes.dataset.bound='1');

    // Histoire
    const fStory = document.getElementById('form-ai-story');
    const sStory = document.getElementById('ai-story-status');
    const outStory = document.getElementById('ai-story-result');
    if (fStory && !fStory.dataset.bound) fStory.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (fStory.dataset.busy === '1') return;
      fStory.dataset.busy = '1';
      const submitBtn = fStory.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
      if (!currentChild) { outStory.innerHTML = '<div class="muted">Ajoutez un profil enfant pour générer une histoire personnalisée.</div>'; return; }
      const fd = new FormData(fStory);
      const theme = fd.get('theme')?.toString() || '';
      const duration = parseInt(fd.get('duration')?.toString() || '3');
      const sleepy = !!fd.get('sleepy');
      sStory.textContent = 'Génération en cours…'; outStory.innerHTML='';
      try {
        const text = await askAIStory(currentChild, { theme, duration, sleepy });
        outStory.innerHTML = `<div>${escapeHtml(text).replace(/\n/g,'<br/>')}</div>`;
      } catch (err){
        outStory.innerHTML = `<div class="muted">Serveur IA indisponible.</div>`;
      } finally { sStory.textContent=''; fStory.dataset.busy='0'; if (submitBtn) submitBtn.disabled = false; }
    }); fStory && (fStory.dataset.bound='1');

    // Discussion
    const fChat = document.getElementById('form-ai-chat');
    const sChat = document.getElementById('ai-chat-status');
    const msgsEl = document.getElementById('ai-chat-messages');
    const btnReset = document.getElementById('ai-chat-reset');
    const txtChat = fChat?.querySelector('textarea[name="q"]');
    if (txtChat) {
      const placeholders = ['Écris ici…','Pose ta question…','Dis-moi tout…'];
      let idx = 0;
      setInterval(() => {
        if (document.activeElement !== txtChat) {
          idx = (idx + 1) % placeholders.length;
          txtChat.placeholder = placeholders[idx];
        }
      }, 4000);
    }
    if (btnReset && !btnReset.dataset.bound) {
      btnReset.addEventListener('click', (e) => {
        e.preventDefault();
        const key = chatKey(currentChild);
        try { localStorage.removeItem(key); } catch {}
        renderChat([]);
        sChat.textContent = '';
      });
      btnReset.dataset.bound = '1';
    }
    if (fChat && !fChat.dataset.bound) fChat.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (fChat.dataset.busy === '1') return;
      fChat.dataset.busy = '1';
      const submitBtn = fChat.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
      const q = new FormData(fChat).get('q')?.toString().trim();
      if (!q) return;
      sChat.textContent = 'Réflexion en cours…';
      // Afficher immédiatement la bulle de l’utilisateur
      const history = loadChat(currentChild);
      history.push({ role:'user', content:q });
      saveChat(currentChild, history);
      renderChat(history);
      // Afficher l’indicateur de frappe
      document.getElementById('ai-typing')?.remove();
      const typing = document.createElement('div');
      typing.id='ai-typing';
      typing.className='chat-line assistant';
      typing.innerHTML='<div class="avatar">🤖</div><div class="message"><div class="bubble assistant"><span class="typing"><span></span><span></span><span></span></span></div></div>';
      msgsEl?.appendChild(typing);
      msgsEl?.scrollTo({ top: msgsEl.scrollHeight, behavior:"smooth" });
      try {
        const resp = await askAI(q, currentChild, history);
        const newH = loadChat(currentChild);
        newH.push({ role:'assistant', content:resp });
        saveChat(currentChild, newH);
        renderChat(newH);
      } catch (err){
        const msg = (err && err.message) ? err.message : String(err||'IA indisponible');
        const newH = loadChat(currentChild);
        newH.push({ role:'assistant', content:`[Erreur IA] ${msg}` });
        saveChat(currentChild, newH);
        renderChat(newH);
      } finally { sChat.textContent=''; document.getElementById('ai-typing')?.remove(); fChat.dataset.busy='0'; if (submitBtn) submitBtn.disabled = false; }
    }); fChat && (fChat.dataset.bound='1');

    // Charger l’enfant de façon asynchrone pour personnaliser l’IA
    const renderIndicator = async (child) => {
      const route = document.querySelector('section[data-route="/ai"]');
      if (!route) return;
      const container = route.querySelector('.stack');
      if (!container) return;
      let box = document.getElementById('ai-profile-indicator');
      if (!box) {
        box = document.createElement('div');
        box.id = 'ai-profile-indicator';
        box.className = 'card';
      }
      container.insertBefore(box, container.firstChild);
      const slim = await listChildrenSlim();
      if (!child || !slim.length) {
        box.innerHTML = `<div class="muted">Aucun profil enfant chargé pour l’IA. <a href="#/onboarding">Créer un profil</a>.</div>`;
        return;
      }
      const ageTxt = formatAge(child.dob);
      const selectedId = child.id;
      const opts = slim.map(c => `<option value="${c.id}" ${c.id===selectedId?'selected':''}>${escapeHtml(c.firstName)}${c.dob?` • ${formatAge(c.dob)}`:''}</option>`).join('');
      box.innerHTML = `
        <div class="hstack">
          <strong>Profil IA:</strong>
          <label style="margin-left:6px">Enfant
            <select id="ai-child-switcher">${opts}</select>
          </label>
          <span class="chip">${escapeHtml(child.firstName)} • ${ageTxt}</span>
          <span class="chip">Allergies: ${escapeHtml(child.context.allergies||'—')}</span>
          <span class="chip">Alimentation: ${labelFeedingType(child.context.feedingType)}</span>
          <span class="chip">Sommeil: ${summarizeSleep(child.context.sleep)}</span>
        </div>`;
      const sel = box.querySelector('#ai-child-switcher');
      if (sel && !sel.dataset.bound) {
        sel.addEventListener('change', async (e) => {
          const id = e.currentTarget.value;
          await setPrimaryChild(id);
          currentChild = await loadChildById(id);
          // Rafraîchir l’indicateur et les historiques pour cet enfant
          await renderIndicator(currentChild);
          renderChat(loadChat(currentChild));
          // Vider les textes générés précédemment pour éviter la confusion
          const outR = document.getElementById('ai-recipes-result'); if (outR) outR.innerHTML = '';
          const outS = document.getElementById('ai-story-result'); if (outS) outS.innerHTML = '';
        });
        sel.dataset.bound = '1';
      }
    };

    (async () => { currentChild = await loadChild(); await renderIndicator(currentChild); renderChat(loadChat(currentChild)); const m=document.getElementById('ai-chat-messages'); m?.scrollTo({top:m.scrollHeight, behavior:'smooth'}); })();
  }

  // Onboarding

  function renderOnboarding() {
    const container = $('#dev-questions');
    if (!container) return;
    container.innerHTML = '';

    // Construire 3 sections avec titres et 10 cases à cocher chacune
    const groups = [
      { title: '0 – 12 mois', start: 0, end: 9 },
      { title: '12 – 24 mois', start: 10, end: 19 },
      { title: '24 – 36 mois', start: 20, end: 29 },
    ];

    groups.forEach(g => {
      const sec = document.createElement('section');
      sec.className = 'dev-group';
      const h = document.createElement('h4');
      h.textContent = g.title;
      const grid = document.createElement('div');
      grid.className = 'qgrid';
      for (let i = g.start; i <= g.end; i++) {
        const q = DEV_QUESTIONS[i];
        const id = `ms_${i}`;
        const item = document.createElement('div');
        item.className = 'qitem';
        // Case avec name milestones[] pour que FormData regroupe les valeurs (on lit .checked pour inclure les faux)
        item.innerHTML = `
          <input type="checkbox" id="${id}" name="milestones[]" data-index="${i}" />
          <label for="${id}">${q.label}</label>
        `;
        grid.appendChild(item);
      }
      sec.appendChild(h);
      sec.appendChild(grid);
      container.appendChild(sec);
    });

    const form = $('#form-child');
    if (form && !form.dataset.bound) {
      // Fonction d’envoi du profil enfant vers Supabase
      async function saveChildProfile(child) {
        const uid = getActiveProfileId();
        if (!uid) throw new Error('Profil utilisateur introuvable');
        const payload = {
          user_id: uid,
          first_name: child.firstName,
          sex: child.sex,
          dob: child.dob,
          photo_url: child.photo,
          context_allergies: child.context.allergies,
          context_history: child.context.history,
          context_care: child.context.care,
          context_languages: child.context.languages,
          feeding_type: child.context.feedingType,
          eating_style: child.context.eatingStyle,
          sleep_falling: child.context.sleep.falling,
          sleep_sleeps_through: child.context.sleep.sleepsThrough,
          sleep_night_wakings: child.context.sleep.nightWakings,
          sleep_wake_duration: child.context.sleep.wakeDuration,
          sleep_bedtime: child.context.sleep.bedtime,
          milestones: child.milestones,
          is_primary: true
        };
        const measurementRecords = buildMeasurementPayloads(child.growth.measurements);
        const teethRecords = buildTeethPayloads(child.growth.teeth);
        const sleepRecords = buildSleepPayloads(child.growth.sleep);
        if (isAnonProfile()) {
          await anonChildRequest('create', {
            child: payload,
            growthMeasurements: measurementRecords,
            growthTeeth: teethRecords,
            growthSleep: sleepRecords
          });
          return;
        }
        const { data: insChild, error: errC } = await supabase
          .from('children')
          .insert([payload])
          .select('id')
          .single();
        if (errC) throw errC;
        const childId = insChild.id;
        const msPayload = measurementRecords.map(m => ({ ...m, child_id: childId }));
        if (msPayload.length) {
          await supabase
            .from('growth_measurements')
            .upsert(msPayload, { onConflict: 'child_id,month' });
        }
        const teethPayloads = teethRecords.map(t => ({ ...t, child_id: childId }));
        if (teethPayloads.length) {
          await supabase.from('growth_teeth').insert(teethPayloads);
        }
        const sleepPayloads = sleepRecords.map(s => ({ ...s, child_id: childId }));
        if (sleepPayloads.length) {
          await supabase.from('growth_sleep').insert(sleepPayloads);
        }
      }

      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        // Anti double-clic + anti multi-bind
        if (form.dataset.busy === '1') return;
        form.dataset.busy = '1';
        const btn = form.querySelector('button[type="submit"],input[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Chargement...'; }
        try {
          const fd = new FormData(form);
          const dobStr = fd.get('dob').toString();
          const ageMAtCreation = ageInMonths(dobStr);
          const // lire 30 booléens dans l’ordre d’affichage (inclure les faux)
            msInputs = Array.from(document.querySelectorAll('#dev-questions input[name="milestones[]"]')),
            milestones = msInputs
              .sort((a,b)=> (Number(a.dataset.index||0) - Number(b.dataset.index||0)))
              .map(inp => !!inp.checked);

          const child = {
            id: genId(),
            firstName: fd.get('firstName').toString().trim(),
            sex: fd.get('sex').toString(),
            dob: dobStr,
            photo: null,
            context: {
              allergies: fd.get('allergies').toString(),
              history: fd.get('history').toString(),
              care: fd.get('care').toString(),
              languages: fd.get('languages').toString(),
              feedingType: fd.get('feedingType')?.toString() || '',
              eatingStyle: fd.get('eatingStyle')?.toString() || '',
              sleep: {
                falling: fd.get('sleep_falling')?.toString() || '',
                sleepsThrough: fd.get('sleep_through')?.toString() === 'oui',
                nightWakings: fd.get('sleep_wakings')?.toString() || '',
                wakeDuration: fd.get('sleep_wake_duration')?.toString() || '',
                bedtime: fd.get('sleep_bedtime')?.toString() || '',
              },
            },
            milestones,
            growth: {
              measurements: [], // {mois, taille, poids}
              sleep: [], // {mois, heures}
              teeth: [], // {mois, nombre}
            },
            createdAt: Date.now(),
          };
          // Mesures initiales si fournies
          const h = parseFloat(fd.get('height'));
          const w = parseFloat(fd.get('weight'));
          const t = parseInt(fd.get('teeth'));
          if (Number.isFinite(h)) child.growth.measurements.push({ month: ageMAtCreation, height: h });
          if (Number.isFinite(w)) child.growth.measurements.push({ month: ageMAtCreation, weight: w });
          if (Number.isFinite(t)) child.growth.teeth.push({ month: ageMAtCreation, count: t });
          if (!useRemote()) throw new Error('Backend indisponible');
          await saveChildProfile(child);
          alert('Profil enfant créé.');
          if (btn) { btn.disabled = false; btn.textContent = 'Créer le profil'; }
          form.dataset.busy = '0';
          location.hash = '#/dashboard';
        } catch (err) {
          console.error('Erreur lors de la création du profil enfant', err);
          if (btn) { btn.disabled = false; btn.textContent = 'Réessayer'; }
          form.dataset.busy = '0';
        }
      });
    }
  }

  // Dashboard
  async function renderDashboard() {
    const rid = (renderDashboard._rid = (renderDashboard._rid || 0) + 1);
    let child = null; let all = [];
    if (useRemote()) {
      // Chargement distant
      const uid = getActiveProfileId();
      // Charger les enfants, choisir le primaire s’il existe sinon le premier
      // Supposition : une colonne booléenne is_primary est présente
      // Repli sur la première ligne si aucun enfant principal
      // Les données de croissance sont chargées après la mise en place du squelette DOM
    } else {
      const user = store.get(K.user);
      all = store.get(K.children, []);
      child = all.find(c => c.id === user?.primaryChildId) || all[0];
    }
    const dom = $('#dashboard-content');
    if (!dom) {
      const appEl = document.querySelector('#app');
      if (appEl) {
        console.warn('Dashboard container missing — injecting fallback');
        appEl.insertAdjacentHTML('beforeend', '<p>Aucune donnée disponible</p>');
      }
      return;
    }
    // Local : afficher le sélecteur d’enfant si des profils existent
    if (!useRemote()) {
      const u = store.get(K.user) || {};
      const slimLocal = (all || []).map(c => ({ id: c.id, firstName: c.firstName, dob: c.dob, isPrimary: c.id === u.primaryChildId }));
      if (slimLocal.length) renderChildSwitcher(dom.parentElement || dom, slimLocal, (slimLocal.find(s=>s.isPrimary)||slimLocal[0]).id, () => renderDashboard());
    }
    if (!useRemote() && !child) {
      if (rid !== renderDashboard._rid) return;
      dom.innerHTML = `<div class="card stack"><p>Aucun profil enfant. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Ajouter un enfant</a></div>`;
      return;
    }
    // Placeholder pendant le chargement distant
    if (useRemote()) {
      if (rid !== renderDashboard._rid) return;
      dom.innerHTML = `<div class="card stack"><p>Chargement du profil…</p><button id="btn-refresh-profile" class="btn btn-secondary">Forcer le chargement</button></div>`;
      $('#btn-refresh-profile')?.addEventListener('click', () => location.reload());
    }
    const renderForChild = async (child) => {
      const ageM = ageInMonths(child.dob);
      const ageTxt = formatAge(child.dob);
      if (rid !== renderDashboard._rid) return;
    // Calculer le dernier état de santé (mesures récentes)
    const msAll = normalizeMeasures(child.growth.measurements);
    const latestH = [...msAll].reverse().find(m=>Number.isFinite(m.height))?.height;
    const latestW = [...msAll].reverse().find(m=>Number.isFinite(m.weight))?.weight;
    const lastTeeth = [...(child.growth.teeth||[])].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0]?.count;
    const lastSleepHours = [...(child.growth.sleep||[])].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0]?.hours;
    if (rid !== renderDashboard._rid) return;
    dom.innerHTML = `
      <div class="grid-2">
        <div class="card stack">
          <div class="hstack">
            ${child.photo ? `<img src="${child.photo}" alt="${child.firstName}" style="width:64px;height:64px;object-fit:cover;border-radius:12px;border:1px solid var(--border);"/>` :
            `<div style="width:64px;height:64px;border-radius:12px;border:1px solid var(--border);display:grid;place-items:center;background:#111845;font-weight:600;font-size:24px;color:#fff;">${(child.firstName||'?').slice(0,1).toUpperCase()}</div>`}
            <div>
              <h2 style="margin:0">${child.firstName}</h2>
              <div class="muted">${child.sex} • ${ageTxt}</div>
            </div>
          </div>
          <div class="hstack">
            <span class="chip">Allergies: ${child.context.allergies || '—'}</span>
            <span class="chip">Mode de garde: ${child.context.care || '—'}</span>
            <span class="chip">Langues: ${child.context.languages || '—'}</span>
            <span class="chip">Alimentation: ${labelFeedingType(child.context.feedingType)}</span>
            <span class="chip">Appétit: ${labelEatingStyle(child.context.eatingStyle)}</span>
            <span class="chip">Sommeil: ${summarizeSleep(child.context.sleep)}</span>
          </div>
          <div class="hstack">
            <button class="btn btn-primary" type="button" id="btn-toggle-milestones">Afficher les jalons</button>
          </div>
          <div class="hstack" id="milestones-list" hidden>
            ${child.milestones.map((v,i)=> v?`<span class="badge done">${DEV_QUESTIONS[i]?.label||''}</span>`: '').join('') || '<span class="muted">Pas encore de badges — cochez des étapes dans le profil.</span>'}
          </div>
        </div>
      </div>

      <div class="grid-2" style="margin-top:12px">
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Taille (cm)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet-strong)"></span>P50</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>P15/P85</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--border)"></span>P3/P97</span>
            </div>
          </div>
          <svg class="chart" id="chart-height"></svg>
        </div>
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Poids (kg)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet-strong)"></span>P50</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>P15/P85</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--border)"></span>P3/P97</span>
            </div>
          </div>
          <svg class="chart" id="chart-weight"></svg>
        </div>
        <div class="card chart-card">
          <div class="chart-header">
            <h3>IMC</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet-strong)"></span>P50</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>P15/P85</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--border)"></span>P3/P97</span>
            </div>
          </div>
          <svg class="chart" id="chart-bmi"></svg>
        </div>
        
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Dents (nb)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
            </div>
          </div>
          <svg class="chart" id="chart-teeth"></svg>
        </div>
      </div>

    `;

    // Section « Profil santé » retirée à la demande

    // Ajouter le bloc d’historique des mises à jour
    try {
      const updates = await getChildUpdates(child.id);
      if (rid !== renderDashboard._rid) return;
      const hist = document.createElement('div');
      hist.className = 'card stack';
      hist.style.marginTop = '20px';
      const timelineHtml = updates.map(u => {
        const created = new Date(u.created_at);
        const hasValidDate = !Number.isNaN(created.getTime());
        const when = hasValidDate
          ? created.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
          : 'Date inconnue';
        const iso = hasValidDate ? created.toISOString() : '';
        let details = '';
        try {
          const parsed = JSON.parse(u.update_content || '');
          details = escapeHtml(parsed.summary || summarizeUpdate(parsed.prev || {}, parsed.next || {}));
        } catch {
          details = escapeHtml(u.update_content || '');
        }
        const typeBadge = u.update_type ? `<span class="timeline-tag">${escapeHtml(u.update_type)}</span>` : '';
        const comment = u.ai_comment
          ? `<div class="timeline-comment"><strong><em>${escapeHtml(u.ai_comment)}</em></strong></div>`
          : '';
        return `
          <article class="timeline-item" role="listitem">
            <div class="timeline-marker" aria-hidden="true"></div>
            <div class="timeline-content">
              <div class="timeline-meta">
                <time datetime="${iso}">${when}</time>
                ${typeBadge}
              </div>
              <div class="timeline-summary">${details}</div>
              ${comment}
            </div>
          </article>
        `;
      }).join('');

      hist.innerHTML = `
        <div class="card-header history-header">
          <h3>Historique de l’évolution</h3>
          <p class="page-subtitle">Suivez en un coup d’œil les derniers ajouts et observations.</p>
        </div>
      ` + (
        updates.length
          ? `<div class="timeline" role="list">${timelineHtml}</div>`
          : `<div class="empty-state muted">Aucune mise à jour enregistrée pour l’instant.</div>`
      );
      if (updates.length > 2) {
        const timeline = hist.querySelector('.timeline');
        const items = timeline ? Array.from(timeline.children) : [];
        items.forEach((el, idx) => {
          if (idx >= 2) el.style.display = 'none';
        });
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.textContent = 'Tout afficher';
        btn.dataset.expanded = '0';
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', () => {
          const expanded = btn.dataset.expanded === '1';
          if (!expanded) {
            items.forEach(el => { el.style.display = ''; });
            btn.textContent = 'Réduire';
            btn.dataset.expanded = '1';
            btn.setAttribute('aria-expanded', 'true');
          } else {
            items.forEach((el, idx) => { if (idx >= 2) el.style.display = 'none'; });
            btn.textContent = 'Tout afficher';
            btn.dataset.expanded = '0';
            btn.setAttribute('aria-expanded', 'false');
          }
        });
        const actions = document.createElement('div');
        actions.className = 'timeline-actions';
        actions.appendChild(btn);
        hist.appendChild(actions);
      }
      if (rid !== renderDashboard._rid) return;
      dom.appendChild(hist);
    } catch {}

    // Ajouter le bloc de conseils après l’historique
    const adviceWrap = document.createElement('div');
    adviceWrap.className = 'grid-2';
    adviceWrap.style.marginTop = '12px';
    adviceWrap.innerHTML = `
        <div class="card stack">
          <h3>Conseils IA (indicatifs)</h3>
          ${renderAdvice(ageM)}
        </div>
    `;
    if (rid !== renderDashboard._rid) return;
    dom.appendChild(adviceWrap);

    // Gérer le formulaire de mesures (interface retirée ; garde au cas où)
    const formMeasure = $('#form-measure');
    if (formMeasure) formMeasure.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (form.dataset.busy === '1') return; // anti double-clic
      form.dataset.busy = '1';
      const submitEls = form.querySelectorAll('button[type="submit"],input[type="submit"]');
      submitEls.forEach(b => { b.disabled = true; });
      const fd = new FormData(form);
      const month = +fd.get('month');
      const height = parseFloat(fd.get('height'));
      const weight = parseFloat(fd.get('weight'));
      const sleep = parseFloat(fd.get('sleep'));
      const teeth = parseInt(fd.get('teeth'));
      const summaryParts = [];
      if (Number.isFinite(height)) summaryParts.push(`Taille: ${height} cm`);
      if (Number.isFinite(weight)) summaryParts.push(`Poids: ${weight} kg`);
      if (Number.isFinite(teeth)) summaryParts.push(`Dents: ${teeth}`);
      if (Number.isFinite(sleep)) summaryParts.push(`Sommeil: ${sleep} h`);
      const summary = summaryParts.join(' ; ');
      try {
        let handled = false;
        if (useRemote()) {
          try {
            if (isAnonProfile()) {
              const measurementInputs = [];
              if (Number.isFinite(height)) measurementInputs.push({ month, height });
              if (Number.isFinite(weight)) measurementInputs.push({ month, weight });
              const measurementRecords = buildMeasurementPayloads(measurementInputs);
              const sleepRecords = Number.isFinite(sleep) ? buildSleepPayloads([{ month, hours: sleep }]) : [];
              const teethRecords = Number.isFinite(teeth) ? buildTeethPayloads([{ month, count: teeth }]) : [];
              await anonChildRequest('add-growth', {
                childId: child.id,
                growthMeasurements: measurementRecords,
                growthSleep: sleepRecords,
                growthTeeth: teethRecords
              });
              await logChildUpdate(child.id, 'measure', { summary, month, height, weight, sleep, teeth });
              renderDashboard();
              handled = true;
            } else {
              const uid = getActiveProfileId();
              if (!uid) {
                console.warn('Aucun user_id disponible pour growth_measurements/growth_sleep/growth_teeth (form-measure)');
                throw new Error('Pas de user_id');
              }
              const promises = [];
              if (Number.isFinite(height) || Number.isFinite(weight)) {
                const payload = {
                  child_id: child.id,
                  month,
                  height_cm: Number.isFinite(height) ? Number(height) : null,
                  weight_kg: Number.isFinite(weight) ? Number(weight) : null,
                };
                if (payload.child_id && Number.isInteger(payload.month)) {
                  promises.push(
                    supabase
                      .from('growth_measurements')
                      .upsert([payload], { onConflict: 'child_id,month' })
                  );
                } else {
                  console.warn('Skip growth_measurements, invalid payload:', payload);
                }
              }
              if (Number.isFinite(sleep) && child?.id) {
                promises.push((async () => {
                  try {
                    const { data, error } = await supabase
                      .from('growth_sleep')
                      .insert([{ child_id: child.id, month, hours: sleep }]);
                    if (error) {
                      console.error('Erreur insert growth_sleep:', error);
                    } else {
                    }
                  } catch (err) {
                    console.error('Exception insert growth_sleep:', err);
                  }
                })());
              }
              if (Number.isFinite(teeth)) {
                const payload = { child_id: child.id, month, count: teeth };
                promises.push(
                  supabase
                    .from('growth_teeth')
                    .insert([payload])
                );
              }
              const results = await Promise.allSettled(promises);
              await logChildUpdate(child.id, 'measure', { summary, month, height, weight, sleep, teeth });
              renderDashboard();
              handled = true;
            }
          } catch (err) {
            console.error('Supabase error (form-measure):', err);
            alert('Erreur Supabase — enregistrement local des mesures.');
          }
        }
        if (!handled) {
        // Repli local
          const children = store.get(K.children, []);
          const c = children.find(x => x.id === child.id);
          if (Number.isFinite(height) || Number.isFinite(weight)) {
            const m = { month };
            if (Number.isFinite(height)) m.height = height;
            if (Number.isFinite(weight)) m.weight = weight;
            if (Number.isFinite(height) && Number.isFinite(weight)) {
              m.bmi = weight / Math.pow(height / 100, 2);
            }
            m.measured_at = new Date().toISOString();
            c.growth.measurements.push(m);
          }
          if (Number.isFinite(sleep)) c.growth.sleep.push({ month, hours: sleep });
          if (Number.isFinite(teeth)) c.growth.teeth.push({ month, count: teeth });
          store.set(K.children, children);
          await logChildUpdate(child.id, 'measure', { summary, month, height, weight, sleep, teeth });
          renderDashboard();
        }
      } finally {
        submitEls.forEach(b => { b.disabled = false; });
        delete form.dataset.busy;
      }
    });

    // Bouton pour afficher/masquer les jalons
    try {
      const btn = document.getElementById('btn-toggle-milestones');
      const list = document.getElementById('milestones-list');
      if (btn && list && !btn.dataset.bound) {
        btn.addEventListener('click', () => {
          const willShow = list.hidden;
          list.hidden = !willShow;
          btn.textContent = willShow ? 'Masquer les jalons' : 'Afficher les jalons';
        });
        btn.dataset.bound = '1';
      }
    } catch {}

    // Graphiques
    const ms = normalizeMeasures(child.growth.measurements);
    const heightData = ms.filter(m=>Number.isFinite(m.height)).map(m=>({month:m.month,value:m.height}));
    const weightData = ms.filter(m=>Number.isFinite(m.weight)).map(m=>({month:m.month,value:m.weight}));
    const bmiData = ms.filter(m=>Number.isFinite(m.bmi))
                      .map(m=>({month:m.month, value: m.bmi}));
    const safeRender = (id, data, curve, unit) => {
      if (rid !== renderDashboard._rid) return;
      try {
        renderWhoChart(id, data, curve, unit);
      } catch (e) {
        console.error(e);
        const host = document.getElementById(id)?.parentElement;
        if (host) {
          const note = document.createElement('div');
          note.className = 'chart-note';
          note.textContent = 'Impossible de charger les courbes OMS';
          host.appendChild(note);
        }
      }
    };
    safeRender('chart-height', heightData, curves.LENGTH_FOR_AGE, 'cm');
    safeRender('chart-weight', weightData, curves.WEIGHT_FOR_AGE, 'kg');
    safeRender('chart-bmi', bmiData, curves.BMI_FOR_AGE, 'IMC');
    if (rid === renderDashboard._rid) {
      drawChart($('#chart-teeth'), buildSeries(child.growth.teeth.map(t=>({x:t.month,y:t.count}))));
    }

    // Notes explicatives en langage simple pour les parents
    try {
      if (rid !== renderDashboard._rid) return;
      const latestT = [...(child.growth.teeth||[])].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0];
      const noteT = document.createElement('div'); noteT.className='chart-note';
      if (latestT) noteT.textContent = `Dernier relevé: ${latestT.count} dent(s). Le calendrier d’éruption varie beaucoup — comparez surtout avec les observations précédentes.`;
      else noteT.textContent = 'Ajoutez un relevé de dents pour suivre l’évolution.';
      document.getElementById('chart-teeth')?.parentElement?.appendChild(noteT);
    } catch {}

    // Assistant IA retiré du dashboard (disponible dans /ai)
    };

    if (!useRemote()) {
      await renderForChild(child);
    } else {
      (async () => {
        let remoteChild = null;
        let gmErr = null;
        let gmCount = 0;
        try {
          if (isAnonProfile()) {
            const listRes = await anonChildRequest('list', {});
            const rows = Array.isArray(listRes.children) ? listRes.children : [];
            if (!rows.length) {
              if (rid !== renderDashboard._rid) return;
              dom.innerHTML = `<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`;
              return;
            }
            const slimRemote = rows.map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
            const selId = (slimRemote.find(s=>s.isPrimary) || slimRemote[0]).id;
            if (rid !== renderDashboard._rid) return;
            renderChildSwitcher(dom.parentElement || dom, slimRemote, selId, () => renderDashboard());
            const primary = rows.find(r => r.id === selId) || rows[0];
            const detail = await anonChildRequest('get', { childId: primary.id });
            const data = detail.child;
            if (!data) throw new Error('Profil introuvable');
            const mapped = mapRowToChild(data);
            if (!mapped) throw new Error('Profil introuvable');
            remoteChild = mapped;
            const growth = detail.growth || {};
            (growth.measurements || []).forEach(m => {
              const h = Number(m?.height_cm);
              const w = Number(m?.weight_kg);
              const heightValid = Number.isFinite(h);
              const weightValid = Number.isFinite(w);
              remoteChild.growth.measurements.push({
                month: m.month,
                height: heightValid ? h : null,
                weight: weightValid ? w : null,
                bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at
              });
            });
            (growth.sleep || []).forEach(s => remoteChild.growth.sleep.push({ month: s.month, hours: s.hours }));
            (growth.teeth || []).forEach(t => remoteChild.growth.teeth.push({ month: t.month, count: t.count }));
            gmCount = remoteChild.growth.measurements.length;
          } else {
            const uid = getActiveProfileId();
            if (!uid) {
              console.warn('Aucun user_id disponible pour la requête children (renderDashboard) — fallback local');
              const u = store.get(K.user) || {};
              const all = store.get(K.children, []);
              if (!all.length) {
                if (rid !== renderDashboard._rid) return;
                dom.innerHTML = `<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`;
                return;
              }
              const slimLocal = all.map(c => ({ id: c.id, firstName: c.firstName, dob: c.dob, isPrimary: c.id === u.primaryChildId }));
              const selId = (slimLocal.find(s=>s.isPrimary) || slimLocal[0]).id;
              if (rid !== renderDashboard._rid) return;
              renderChildSwitcher(dom.parentElement || dom, slimLocal, selId, () => renderDashboard());
              const child = all.find(c => c.id === selId) || all[0];
              await renderForChild(child);
              return;
            }
            const { data: rows, error: rowsErr } = await supabase.from('children').select('*').eq('user_id', uid).order('created_at', { ascending: true });
            if (rowsErr) throw rowsErr;
            if (!rows || !rows.length) {
              if (rid !== renderDashboard._rid) return;
              dom.innerHTML = `<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`;
              return;
            }
            const slimRemote = rows.map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
            const selId = (slimRemote.find(s=>s.isPrimary) || slimRemote[0]).id;
            if (rid !== renderDashboard._rid) return;
            renderChildSwitcher(dom.parentElement || dom, slimRemote, selId, () => renderDashboard());
            const primary = rows.find(r=>r.is_primary) || rows[0];
            remoteChild = {
              id: primary.id,
              firstName: primary.first_name,
              sex: primary.sex,
              dob: primary.dob,
              photo: primary.photo_url,
              context: {
                allergies: primary.context_allergies,
                history: primary.context_history,
                care: primary.context_care,
                languages: primary.context_languages,
                feedingType: primary.feeding_type,
                eatingStyle: primary.eating_style,
                sleep: {
                  falling: primary.sleep_falling,
                  sleepsThrough: primary.sleep_sleeps_through,
                  nightWakings: primary.sleep_night_wakings,
                  wakeDuration: primary.sleep_wake_duration,
                  bedtime: primary.sleep_bedtime
                }
              },
              milestones: Array.isArray(primary.milestones)? primary.milestones : [],
              growth: { measurements: [], sleep: [], teeth: [] }
            };
            const [{ data: gm, error: gmErrLocal }, { data: gs }, { data: gt }] = await Promise.all([
              supabase
                .from('growth_measurements')
                .select('month, height_cm, weight_kg, created_at')
                .eq('child_id', primary.id)
                .order('month', { ascending: true }),
              supabase.from('growth_sleep').select('month,hours').eq('child_id', primary.id),
              supabase.from('growth_teeth').select('month,count').eq('child_id', primary.id),
            ]);
            gmErr = gmErrLocal;
            const measurements = (gm || []).map(m => {
              const h = m.height_cm == null ? null : Number(m.height_cm);
              const w = m.weight_kg == null ? null : Number(m.weight_kg);
              return {
                month: m.month,
                height: h,
                weight: w,
                bmi: w && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at
              };
            });
            gmCount = measurements.length;
            measurements.forEach(m => remoteChild.growth.measurements.push(m));
            (gs||[]).forEach(r=> remoteChild.growth.sleep.push({ month: r.month, hours: r.hours }));
            (gt||[]).forEach(r=> remoteChild.growth.teeth.push({ month: r.month, count: r.count }));
          }
        } catch (e) {
          if (rid !== renderDashboard._rid) return;
          dom.innerHTML = `<div class="card">Erreur de chargement Supabase. Réessayez.</div>`;
          return;
        }
        if (rid !== renderDashboard._rid) return;
        await renderForChild(remoteChild);
        if (rid !== renderDashboard._rid) return;
        if (gmErr) {
          ['chart-height', 'chart-weight', 'chart-bmi'].forEach(id => {
            const host = document.getElementById(id)?.parentElement;
            if (host) {
              const note = document.createElement('div');
              note.className = 'chart-note';
              note.textContent = 'Impossible de récupérer les mesures';
              host.appendChild(note);
            }
          });
        } else if (gmCount === 0) {
          ['chart-height', 'chart-weight', 'chart-bmi'].forEach(id => {
            const host = document.getElementById(id)?.parentElement;
            if (host) {
              const note = document.createElement('div');
              note.className = 'chart-note';
              note.textContent = 'Aucune mesure enregistrée';
              host.appendChild(note);
            }
          });
        }
      })();
    }
  }

  function normalizeMeasures(entries) {
    // les entrées peuvent ne contenir que la taille ou que le poids
    const byMonth = new Map();
    for (const e of entries) {
      const m = e.month ?? e.m ?? 0;
      const obj = byMonth.get(m) || { month: m };
      if (typeof e.height === 'number') obj.height = e.height;
      if (typeof e.weight === 'number') obj.weight = e.weight;
      if (typeof e.bmi === 'number') obj.bmi = e.bmi;
      if (e.measured_at && !obj.measured_at) obj.measured_at = e.measured_at;
      byMonth.set(m, obj);
    }
    for (const obj of byMonth.values()) {
      if (typeof obj.bmi !== 'number' && Number.isFinite(obj.height) && Number.isFinite(obj.weight)) {
        obj.bmi = obj.weight / Math.pow(obj.height / 100, 2);
      }
    }
    return Array.from(byMonth.values()).sort((a,b)=>a.month-b.month);
  }

  // Communauté
  function renderCommunity() {
    // Garde d’instance pour éviter les courses et les doublons DOM
    const rid = (renderCommunity._rid = (renderCommunity._rid || 0) + 1);
    const list = $('#forum-list');
    list.innerHTML = '';
    const refreshBtn = $('#btn-refresh-community');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => location.reload());
    }
    // Gestionnaires du filtre de catégories
    const cats = $('#forum-cats');
    if (cats && !cats.dataset.bound) {
      cats.addEventListener('click', (e)=>{
        const b = e.target.closest('.cat'); if (!b) return;
        const all = cats.querySelectorAll('.cat'); all.forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        cats.setAttribute('data-active', b.dataset.cat || 'all');
        renderCommunity();
      });
      cats.dataset.bound='1';
    }
    const activeCat = cats?.getAttribute('data-active') || 'all';
    const showEmpty = () => {
      if (rid !== renderCommunity._rid) return;
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.textContent = 'Aucun sujet pour le moment. Lancez la discussion !';
      list.appendChild(empty);
    };
      const renderTopics = (topics, replies, authorsMap) => {
        const activeId = getActiveProfileId();
        if (!topics.length) return showEmpty();
        if (rid !== renderCommunity._rid) return;
        topics.slice().forEach(t => {
        // Extraire la catégorie depuis un préfixe de titre [Sommeil] Titre
        let title = t.title || '';
        let cat = 'Divers';
        const m = title.match(/^\[(.*?)\]\s*(.*)$/);
        if (m) { cat = m[1]; title = m[2]; }
        if (activeCat !== 'all' && cat !== activeCat) return;
        const el = document.createElement('div');
        el.className = 'topic';
        const author = authorsMap.get(t.user_id) || 'Anonyme';
        const rs = (replies.get(t.id) || []).sort((a,b)=>a.created_at-b.created_at);
        const openSet = (renderCommunity._open = renderCommunity._open || new Set());
        const tid = String(t.id);
        const isOpen = openSet.has(tid);
        const toggleLabel = isOpen ? 'Réduire la publication' : 'Afficher les commentaires';
        const toggleCount = rs.length ? ` (${rs.length})` : '';
        const isMobile = document.body.classList.contains('force-mobile');
          el.innerHTML = `
            <div class="flex-between">
              <h3 style="margin:0">${escapeHtml(title)}</h3>
              <div class="hstack"><span class="chip">${escapeHtml(cat)}</span><span class="muted" title="Auteur">${escapeHtml(author)}</span><a href="messages.html?user=${t.user_id}" class="btn btn-secondary btn-message">💬 Message privé</a><button class="btn btn-secondary" data-toggle-comments="${tid}" aria-expanded="${isOpen?'true':'false'}">${toggleLabel}${toggleCount}</button></div>
            </div>
            <div class="topic-body" data-body="${tid}" style="${isOpen?'':'display:none'}">
              <p style="margin-top:8px">${escapeHtml(t.content)}</p>
              <div class="stack">
                ${rs.map(r=>`<div class="reply"><div class="muted">${escapeHtml(authorsMap.get(r.user_id)||'Anonyme')} • ${new Date(r.created_at).toLocaleString()} <a href="messages.html?user=${r.user_id}" class="btn btn-secondary btn-message" style="margin-left:8px">${isMobile ? '💬' : '💬 Message privé'}</a></div><div>${escapeHtml(r.content)}</div></div>`).join('')}
              </div>
              <form data-id="${tid}" class="form-reply form-grid" style="margin-top:8px">
                <label>Réponse<textarea name="content" rows="2" required></textarea></label>
                <button class="btn btn-secondary" type="submit">Répondre</button>
              </form>
              ${ (activeId && String(t.user_id) === String(activeId)) ? `<button class="btn btn-danger" data-del-topic="${tid}" style="margin-top:8px">Supprimer le sujet</button>`:''}
            </div>
          `;
        list.appendChild(el);
      });
      $$('.form-reply').forEach(f => {
        if (f.dataset.bound) return;
        f.dataset.bound = '1';
        f.addEventListener('submit', async (e)=>{
          e.preventDefault();
          const form = e.currentTarget;
          if (form.dataset.busy === '1') return;
          form.dataset.busy = '1';
          const submitBtn = form.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
          try {
            const id = form.getAttribute('data-id');
            const fd = new FormData(form);
            const content = fd.get('content').toString().trim();
            if (!content) return;
            if (useRemote()) {
              try {
                if (isAnonProfile()) {
                  await anonCommunityRequest('reply', { topicId: id, content });
                  renderCommunity();
                  return;
                }
                const uid = getActiveProfileId();
                if (!uid) { console.warn('Aucun user_id disponible pour forum_replies'); throw new Error('Pas de user_id'); }
                await supabase.from('forum_replies').insert([{ topic_id: id, user_id: uid, content }]);
                renderCommunity();
                return;
              } catch {}
            }
            // Repli local
            const forum = store.get(K.forum);
            const topic = forum.topics.find(x=>x.id===id);
            const user = store.get(K.user);
            const children = store.get(K.children, []);
            const child = children.find(c=>c.id===user?.primaryChildId) || children[0];
            const whoAmI = user?.pseudo || (user ? `${user.role} de ${child? child.firstName : '—'}` : 'Anonyme');
            topic.replies.push({ content, author: whoAmI, createdAt: Date.now() });
            store.set(K.forum, forum);
            renderCommunity();
          } finally { form.dataset.busy='0'; if (submitBtn) submitBtn.disabled = false; }
        });
      });
      // Actions déléguées : pliage/dépliage et suppression (avec garde d’occupation)
      if (!list.dataset.delBound) {
        list.addEventListener('click', async (e)=>{
          // Ouvrir/fermer le sujet
          const tgl = e.target.closest('[data-toggle-comments]');
          if (tgl) {
            e.preventDefault();
            const id = tgl.getAttribute('data-toggle-comments');
            const body = list.querySelector(`[data-body="${id}"]`);
            const openSet = (renderCommunity._open = renderCommunity._open || new Set());
            const isOpen = openSet.has(id);
            if (body) {
              if (isOpen) { body.style.display = 'none'; openSet.delete(id); tgl.setAttribute('aria-expanded','false'); tgl.textContent = tgl.textContent.replace('Réduire la publication', 'Afficher les commentaires'); }
              else { body.style.display = ''; openSet.add(id); tgl.setAttribute('aria-expanded','true'); tgl.textContent = tgl.textContent.replace('Afficher les commentaires', 'Réduire la publication'); }
            }
            return;
          }
          // Supprimer le sujet
          const btn = e.target.closest('[data-del-topic]'); if (!btn) return;
          if (btn.dataset.busy === '1') return; btn.dataset.busy='1'; btn.disabled = true;
          const id = btn.getAttribute('data-del-topic');
          if (!confirm('Supprimer ce sujet ?')) { btn.dataset.busy='0'; btn.disabled=false; return; }
          if (useRemote()) {
            try {
              if (isAnonProfile()) {
                await anonCommunityRequest('delete-topic', { topicId: id });
                renderCommunity();
                return;
              }
              const uid = getActiveProfileId();
              if (!uid) { console.warn('Aucun user_id disponible pour forum_topics (delete)'); throw new Error('Pas de user_id'); }
              await supabase.from('forum_topics').delete().eq('id', id);
              renderCommunity();
              return;
            } catch {}
          }
          // Repli local
          const forum = store.get(K.forum);
          forum.topics = forum.topics.filter(t=>t.id!==id);
          store.set(K.forum, forum);
          renderCommunity();
        });
        list.dataset.delBound = '1';
      }
    };
    if (useRemote()) {
      (async () => {
        try {
          if (isAnonProfile()) {
            const res = await anonCommunityRequest('list', {});
            const topics = Array.isArray(res.topics) ? res.topics : [];
            const repliesArr = Array.isArray(res.replies) ? res.replies : [];
            const authorsRaw = res.authors || {};
            const authorsMap = new Map(Object.entries(authorsRaw).map(([id, name]) => [String(id), name || 'Utilisateur']));
            const repliesMap = new Map();
            repliesArr.forEach(r => {
              if (!r || !r.topic_id) return;
              const key = String(r.topic_id);
              const arr = repliesMap.get(key) || [];
              arr.push(r);
              repliesMap.set(key, arr);
            });
            renderTopics(topics, repliesMap, authorsMap);
            return;
          }
          const uid = getActiveProfileId();
          if (!uid) {
            console.warn('Aucun user_id disponible pour forum_topics/forum_replies/profiles (fetch)');
            const forum = store.get(K.forum, { topics: [] });
            const repliesMap = new Map();
            forum.topics.forEach(t=> repliesMap.set(t.id, t.replies||[]));
            const authors = new Map();
            renderTopics(forum.topics.slice().reverse(), repliesMap, authors);
            return;
          }
          const { data: topics } = await supabase.from('forum_topics').select('id,user_id,title,content,created_at').order('created_at',{ascending:false});
          const ids = (topics||[]).map(t=>t.id);
          const { data: reps } = ids.length? await supabase.from('forum_replies').select('id,topic_id,user_id,content,created_at').in('topic_id', ids) : { data: [] };
          const userIds = new Set([...(topics||[]).map(t=>t.user_id), ...(reps||[]).map(r=>r.user_id)]);
          let authorsMap = new Map();
          if (userIds.size) {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token || '';
              const r = await fetch('/api/profiles/by-ids', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ ids: Array.from(userIds) })
              });
              if (r.ok) {
                const j = await r.json();
                authorsMap = new Map((j.profiles||[]).map(p=>[p.id, p.full_name || 'Utilisateur']));
              } else {
                const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', Array.from(userIds));
                authorsMap = new Map((profs||[]).map(p=>[p.id, p.full_name || 'Utilisateur']));
              }
            } catch {
              const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', Array.from(userIds));
              authorsMap = new Map((profs||[]).map(p=>[p.id, p.full_name || 'Utilisateur']));
            }
          }
          const repliesMap = new Map();
          (reps||[]).forEach(r=>{ const key = String(r.topic_id); const arr = repliesMap.get(key)||[]; arr.push(r); repliesMap.set(key, arr); });
          renderTopics(topics||[], repliesMap, authorsMap);
        } catch (e) { showEmpty(); }
      })();
    } else {
      const forum = store.get(K.forum, { topics: [] });
      const repliesMap = new Map();
      forum.topics.forEach(t=> repliesMap.set(t.id, t.replies||[]));
      const authors = new Map();
      renderTopics(forum.topics.slice().reverse(), repliesMap, authors);
    }

    // Boîte de dialogue de nouveau sujet
    const dlg = $('#dialog-topic');
    // Déplacer la boîte de dialogue dans le body pour éviter l’opacité du parent
    if (dlg && dlg.parentElement && dlg.parentElement.tagName.toLowerCase() !== 'body') {
      document.body.appendChild(dlg);
    }
    $('#btn-new-topic').onclick = () => { if (dlg) dlg.showModal(); };
    const formTopic = $('#form-topic');
    // Bouton Annuler : fermer la boîte de dialogue et réinitialiser le formulaire
    const btnCancelTopic = $('#btn-cancel-topic');
    if (btnCancelTopic && !btnCancelTopic.dataset.bound) {
      btnCancelTopic.dataset.bound = '1';
      btnCancelTopic.addEventListener('click', (e) => {
        e.preventDefault();
        try { formTopic?.reset(); } catch {}
        dlg?.close();
      });
    }
    if (formTopic && !formTopic.dataset.bound) {
      formTopic.dataset.bound = '1';
      formTopic.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        if (form.dataset.busy === '1') return;
        form.dataset.busy = '1';
        const submitBtn = form.querySelector('button[type="submit"], button[value="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        try {
          const fd = new FormData(form);
          let title = fd.get('title').toString().trim();
          const content = fd.get('content').toString().trim();
          const category = fd.get('category')?.toString() || 'Divers';
          if (!title || !content) return;
          if (category && category !== 'Divers' && !/^\[.*\]/.test(title)) title = `[${category}] ${title}`;
          if (useRemote()) {
            try {
              if (isAnonProfile()) {
                await anonCommunityRequest('create-topic', { id: crypto.randomUUID(), title, content });
                dlg.close();
                renderCommunity();
                return;
              }
              const uid = getActiveProfileId();
              if (!uid) { console.warn('Aucun user_id disponible pour forum_topics (new topic)'); throw new Error('Pas de user_id'); }
              const payload = {
                id: crypto.randomUUID(),
                user_id: uid,
                title,
                content,
                created_at: new Date().toISOString()
              };
              const { error } = await supabase
                .from('forum_topics')
                .upsert([payload], { onConflict: 'id' });
              if (error) throw error;
              dlg.close();
              renderCommunity();
              return;
            } catch (err) { console.error('Erreur publication Supabase', err); }
          }
          // Local fallback
          const forum = store.get(K.forum);
          const user = store.get(K.user);
          const children = store.get(K.children, []);
          const child = children.find(c=>c.id===user?.primaryChildId) || children[0];
          const whoAmI = user?.pseudo || (user ? `${user.role} de ${child? child.firstName : '—'}` : 'Anonyme');
          forum.topics.push({ id: genId(), title, content, author: whoAmI, createdAt: Date.now(), replies: [] });
          store.set(K.forum, forum);
          dlg.close();
          renderCommunity();
        } finally {
          form.dataset.busy = '0';
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  // (Comparateur retiré — les courbes sont dans le Dashboard)

    // Paramètres
  async function renderSettings() {
    // Garde d’instance pour éviter les duplications lors des chargements asynchrones
    const rid = (renderSettings._rid = (renderSettings._rid || 0) + 1);
    const user = store.get(K.user);
    const form = $('#form-settings');
    form.role.value = user?.role || 'maman';
    form.pseudo.value = user?.pseudo || '';
    const refreshBtn = $('#btn-refresh-settings');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => location.reload());
    }
    // Chargement des préférences de confidentialité et du profil
    (async () => {
      if (useRemote()) {
        try {
          const uid = getActiveProfileId();
          if (!uid) { console.warn('Aucun user_id disponible pour privacy_settings/profiles (fetch)'); throw new Error('Pas de user_id'); }
          const [priv, prof] = await Promise.all([
            supabase.from('privacy_settings').select('show_stats,allow_messages').eq('user_id', uid).maybeSingle(),
            supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle()
          ]);
          const p = priv.data || {};
          form.showStats.checked = !!p.show_stats;
          form.allowMessages.checked = !!p.allow_messages;
          if (prof.data?.full_name) {
            form.pseudo.value = prof.data.full_name;
            // Garder le store local aligné pour que les autres pages voient le pseudo immédiatement
            const current = store.get(K.user) || {};
            if (current.pseudo !== prof.data.full_name) {
              store.set(K.user, { ...current, pseudo: prof.data.full_name });
            }
          }
        } catch {
          form.showStats.checked = true; form.allowMessages.checked = true;
        }
      } else {
        const privacy = store.get(K.privacy);
        form.showStats.checked = !!privacy.showStats;
        form.allowMessages.checked = !!privacy.allowMessages;
        form.pseudo.value = user?.pseudo || '';
      }
    })();
    form.onsubmit = async (e)=>{
      e.preventDefault();
      if (form.dataset.busy==='1') return; form.dataset.busy='1';
      const submitBtn = form.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
      try {
        const fd = new FormData(form);
        const role = fd.get('role').toString();
        const pseudo = fd.get('pseudo').toString().trim();
        const showStats = !!fd.get('showStats');
        const allowMessages = !!fd.get('allowMessages');
        if (useRemote()) {
          try {
            if (isAnonProfile()) {
              const code = (activeProfile?.code_unique || '').toString().trim().toUpperCase();
              if (!code) { console.warn('Code unique manquant pour la mise à jour anonyme'); throw new Error('Code unique manquant'); }
              const response = await fetch('/api/profiles/update-anon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code_unique: code, full_name: pseudo })
              });
              let payload = null;
              try { payload = await response.json(); } catch { payload = null; }
              if (!response.ok || !payload?.profile) {
                const msg = payload?.error || 'Mise à jour du profil impossible pour le moment.';
                const err = new Error(msg);
                if (payload?.details) err.details = payload.details;
                throw err;
              }
              const profile = payload.profile || {};
              const updatedPseudo = typeof profile.full_name === 'string' ? profile.full_name : pseudo;
              setActiveProfile({ ...profile, isAnonymous: true });
              store.set(K.user, { ...user, role, pseudo: updatedPseudo });
              store.set(K.privacy, { showStats, allowMessages });
              form.pseudo.value = updatedPseudo || '';
              alert('Paramètres enregistrés');
              return;
            }
            const uid = getActiveProfileId();
            if (!uid) { console.warn('Aucun user_id disponible pour privacy_settings/profiles (upsert)'); throw new Error('Pas de user_id'); }
            await Promise.all([
              supabase.from('privacy_settings').upsert([{ user_id: uid, show_stats: showStats, allow_messages: allowMessages }]),
              supabase.from('profiles').upsert([{ id: uid, full_name: pseudo }])
            ]);
            store.set(K.user, { ...user, role, pseudo });
            store.set(K.privacy, { showStats, allowMessages });
            alert('Paramètres enregistrés');
            return;
          } catch (err) {
            console.error('renderSettings remote save failed', err);
          }
        }
        store.set(K.user, { ...user, role, pseudo });
        store.set(K.privacy, { showStats, allowMessages });
        alert('Paramètres enregistrés (local)');
      } finally { form.dataset.busy='0'; if (submitBtn) submitBtn.disabled = false; }
    };

    const list = $('#children-list');
    list.innerHTML = '';
    let children = [];
    if (useRemote()) {
      try {
        if (isAnonProfile()) {
          const res = await anonChildRequest('list', {});
          children = Array.isArray(res.children) ? res.children : [];
        } else {
          const uid = getActiveProfileId();
          if (!uid) { console.warn('Aucun user_id disponible pour children (settings fetch)'); throw new Error('Pas de user_id'); }
          const { data: rows } = await supabase
            .from('children')
            .select('*')
            .eq('user_id', uid)
            .order('created_at', { ascending: true });
          children = rows || [];
        }
      } catch { children = []; }
    } else {
      children = store.get(K.children, []);
    }
    // Si un autre rendu a démarré, interrompre l’ajout pour éviter les doublons
    if (rid !== renderSettings._rid) return;
    children.forEach(c => {
      const firstName = c.first_name || c.firstName;
      const dob = c.dob;
      const row = document.createElement('div');
      row.className = 'hstack';
      row.innerHTML = `
        <span class="chip">${escapeHtml(firstName||'—')} (${dob?formatAge(dob):'—'})</span>
        <button class="btn btn-secondary" data-edit="${c.id}">Mettre à jour</button>
        <button class="btn btn-danger" data-del="${c.id}">Supprimer</button>
      `;
      list.appendChild(row);
    });
    if (!list.dataset.bound) {
      list.addEventListener('click', async (e)=>{
        const target = (e.target instanceof Element) ? e.target.closest('button[data-edit],button[data-del]') : null;
        if (!target) return;
        if (list.dataset.busy === '1') return; // éviter les actions concurrentes
        list.dataset.busy = '1';
        target.disabled = true;
        const idE = target.getAttribute('data-edit');
        const idD = target.getAttribute('data-del');
        if (idE) {
          const editBox = document.getElementById('child-edit');
          editBox?.setAttribute('data-edit-id', idE);
          renderSettings();
          list.dataset.busy = '0';
          return;
        }
        if (idD) {
          if (!confirm('Supprimer ce profil enfant ?')) return;
          if (useRemote()) {
            try {
              if (isAnonProfile()) {
                await anonChildRequest('delete', { childId: idD });
              } else {
                const uid = getActiveProfileId();
                if (!uid) { console.warn('Aucun user_id disponible pour children (delete)'); throw new Error('Pas de user_id'); }
                await supabase.from('children').delete().eq('id', idD);
              }
              renderSettings();
              return;
            } catch {}
          }
          let children = store.get(K.children, []);
          children = children.filter(c=>c.id!==idD);
          store.set(K.children, children);
          const u = { ...user, childIds: (user.childIds||[]).filter(x=>x!==idD) };
          if (u.primaryChildId===idD) u.primaryChildId = u.childIds[0] ?? null;
          store.set(K.user, u);
          renderSettings();
        }
        list.dataset.busy = '0';
      });
      list.dataset.bound = '1';
    }

    // Rendu du formulaire d’édition enfant
    const editBox = document.getElementById('child-edit');
    let currentEditId = editBox?.getAttribute('data-edit-id') || null;
    if (!currentEditId && children[0]) currentEditId = children[0].id;
    let child = null;
    if (useRemote()) {
      const c = (children||[]).find(x=>x.id===currentEditId) || children[0];
      if (c) {
        child = {
          id: c.id,
          firstName: c.first_name,
          sex: c.sex,
          dob: c.dob,
          photo: c.photo_url,
          milestones: Array.isArray(c.milestones) ? c.milestones : [],
          context: {
            allergies: c.context_allergies,
            history: c.context_history,
            care: c.context_care,
            languages: c.context_languages,
            feedingType: c.feeding_type,
            eatingStyle: c.eating_style,
            sleep: {
              falling: c.sleep_falling,
              sleepsThrough: c.sleep_sleeps_through,
              nightWakings: c.sleep_night_wakings,
              wakeDuration: c.sleep_wake_duration,
              bedtime: c.sleep_bedtime,
            }
          }
        };
      }
    } else {
      const localChildren = store.get(K.children, []);
      const uid = (store.get(K.user)||{}).primaryChildId;
      child = localChildren.find(c=>c.id===currentEditId) || localChildren.find(c=>c.id===uid) || localChildren[0];
    }
    if (child && !Array.isArray(child.milestones)) child.milestones = [];
    if (editBox) {
      if (!child) {
        editBox.innerHTML = '<div class="muted">Sélectionnez un enfant pour modifier son profil.</div>';
      } else {
        editBox.innerHTML = `
          <label>Enfant
            <select id="child-select">
              ${children.map(c=>`<option value="${c.id}" ${c.id===child.id?'selected':''}>${escapeHtml(c.first_name||c.firstName||'—')}</option>`).join('')}
            </select>
          </label>
          <form id="form-child-edit" class="form-grid" autocomplete="on">
            <input type="hidden" name="id" value="${child.id}" />
            <label>Prénom<input type="text" name="firstName" value="${escapeHtml(child.firstName)}" required /></label>
            <label>Sexe
              <select name="sex" required>
                <option value="fille" ${child.sex==='fille'?'selected':''}>Fille</option>
                <option value="garçon" ${child.sex==='garçon'?'selected':''}>Garçon</option>
              </select>
            </label>
            <label>Date de naissance<input type="date" name="dob" value="${child.dob}" required /></label>
            <h4>Mesures actuelles (optionnel)</h4>
            <div class="grid-2">
              <label>Taille (cm)<input type="number" step="0.1" name="height" /></label>
              <label>Poids (kg)<input type="number" step="0.01" name="weight" /></label>
            </div>
            <label>Dents (nb)<input type="number" step="1" name="teeth" /></label>
            <h4>Contexte</h4>
            <label>Allergies<input type="text" name="allergies" value="${escapeHtml(child.context.allergies||'')}" /></label>
            <label>Antécédents<input type="text" name="history" value="${escapeHtml(child.context.history||'')}" /></label>
            <label>Mode de garde<input type="text" name="care" value="${escapeHtml(child.context.care||'')}" /></label>
            <label>Langues parlées<input type="text" name="languages" value="${escapeHtml(child.context.languages||'')}" /></label>
            <h4>Habitudes alimentaires</h4>
            <label>Type d’alimentation
              <select name="feedingType">
                ${['','allaitement_exclusif','mixte_allaitement_biberon','allaitement_diversification','biberon_diversification','lait_poudre_vache'].map(v=>`<option value="${v}" ${ (child.context.feedingType||'')===v?'selected':'' }>${({
                  '':'—',
                  'allaitement_exclusif':'Allaitement exclusif',
                  'mixte_allaitement_biberon':'Mixte (allaitement + biberon)',
                  'allaitement_diversification':'Diversification + allaitement',
                  'biberon_diversification':'Biberon + diversification',
                  'lait_poudre_vache':'Lait en poudre / lait de vache'
                })[v]}</option>`).join('')}
              </select>
            </label>
            <label>Appétit / façon de manger
              <select name="eatingStyle">
                ${['','mange_tres_bien','appetit_variable','selectif_difficile','petites_portions'].map(v=>`<option value="${v}" ${ (child.context.eatingStyle||'')===v?'selected':'' }>${({
                  '':'—',
                  'mange_tres_bien':'Mange très bien',
                  'appetit_variable':'Appétit variable',
                  'selectif_difficile':'Sélectif / difficile',
                  'petites_portions':'Petites portions'
                })[v]}</option>`).join('')}
              </select>
            </label>
            <h4>Sommeil</h4>
            <div class="grid-2">
              <label>Endormissement
                <select name="sleep_falling">
                  ${['','facile','moyen','difficile'].map(v=>`<option value="${v}" ${ (child.context.sleep?.falling||'')===v?'selected':'' }>${({
                    '':'—','facile':'Facile','moyen':'Moyen','difficile':'Difficile'
                  })[v]}</option>`).join('')}
                </select>
              </label>
              <label>Nuits complètes
                <select name="sleep_through">
                  ${['','oui','non'].map(v=>`<option value="${v}" ${ ((child.context.sleep?.sleepsThrough?'oui':'non')===v)?'selected':'' }>${({
                    '':'—','oui':'Oui','non':'Non'
                  })[v]}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="grid-2">
              <label>Réveils nocturnes
                <select name="sleep_wakings">
                  ${['','0','1','2','3+'].map(v=>`<option value="${v}" ${ (child.context.sleep?.nightWakings||'')===v?'selected':'' }>${v||'—'}</option>`).join('')}
                </select>
              </label>
              <label>Durée des éveils
                <select name="sleep_wake_duration">
                  ${['','<5min','5-15min','15-30min','30-60min','>60min'].map(v=>`<option value="${v}" ${ (child.context.sleep?.wakeDuration||'')===v?'selected':'' }>${v||'—'}</option>`).join('')}
                </select>
              </label>
            </div>
            <label>Heure du coucher (approx.)
              <input type="time" name="sleep_bedtime" value="${child.context.sleep?.bedtime||''}" />
            </label>
            <button class="btn btn-secondary" type="button" id="btn-edit-milestones">Ouvrir les jalons</button>
            <div id="edit-milestones" class="stack" hidden>
              ${milestonesInputsHtml(child.milestones)}
            </div>
            <div class="hstack">
              <button class="btn btn-primary" type="submit">Mettre à jour</button>
              <button class="btn btn-secondary" type="button" id="btn-cancel-edit">Annuler</button>
            </div>
          </form>
        `;
        const select = document.getElementById('child-select');
        if (select && !select.dataset.bound) {
          select.addEventListener('change', () => {
            editBox.setAttribute('data-edit-id', select.value);
            renderSettings();
          });
          select.dataset.bound = '1';
        }
        const msBtn = document.getElementById('btn-edit-milestones');
        const msBox = document.getElementById('edit-milestones');
        if (msBtn && msBox && !msBtn.dataset.bound) {
          msBtn.addEventListener('click', () => {
            const willShow = msBox.hidden;
            msBox.hidden = !willShow;
            msBtn.textContent = willShow ? 'Fermer les jalons' : 'Ouvrir les jalons';
          });
          msBtn.dataset.bound = '1';
        }
        // Lier la soumission du formulaire
        const f = document.getElementById('form-child-edit');
        if (f && !f.dataset.bound) f.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (f.dataset.busy === '1') return;
          f.dataset.busy = '1';
          const submitBtn = f.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
          try {
          const fd = new FormData(f);
          const id = fd.get('id').toString();
          const photoUrl = child?.photo || null;
          const firstName = fd.get('firstName').toString().trim();
          const sex = fd.get('sex').toString();
          const newDob = fd.get('dob').toString();
          const ageMNow = ageInMonths(newDob);
          const msInputs = Array.from(f.querySelectorAll('#edit-milestones input[name="milestones[]"]'));
          const milestones = msInputs
            .sort((a,b)=> (Number(a.dataset.index||0) - Number(b.dataset.index||0)))
            .map(inp => !!inp.checked);
          // Préparer les instantanés pour l’historique des mises à jour
          const prevSnap = makeUpdateSnapshot(child);
          const payload = {
            first_name: firstName,
            sex,
            dob: newDob,
            photo_url: photoUrl,
            milestones,
            context_allergies: fd.get('allergies').toString(),
            context_history: fd.get('history').toString(),
            context_care: fd.get('care').toString(),
            context_languages: fd.get('languages').toString(),
            feeding_type: fd.get('feedingType')?.toString() || '',
            eating_style: fd.get('eatingStyle')?.toString() || '',
            sleep_falling: fd.get('sleep_falling')?.toString() || '',
            sleep_sleeps_through: fd.get('sleep_through')?.toString() === 'oui',
            sleep_night_wakings: fd.get('sleep_wakings')?.toString() || '',
            sleep_wake_duration: fd.get('sleep_wake_duration')?.toString() || '',
            sleep_bedtime: fd.get('sleep_bedtime')?.toString() || '',
          };
          const nextSnap = makeUpdateSnapshot({
            id,
            firstName,
            dob: newDob,
            milestones,
            context: {
              allergies: payload.context_allergies,
              history: payload.context_history,
              care: payload.context_care,
              languages: payload.context_languages,
              feedingType: payload.feeding_type,
              eatingStyle: payload.eating_style,
              sleep: {
                falling: payload.sleep_falling,
                sleepsThrough: payload.sleep_sleeps_through,
                nightWakings: payload.sleep_night_wakings,
                wakeDuration: payload.sleep_wake_duration,
                bedtime: payload.sleep_bedtime,
              }
            }
          });
          const heightVal = parseFloat(fd.get('height'));
          const weightVal = parseFloat(fd.get('weight'));
          const teethVal = parseInt(fd.get('teeth'));
          if (useRemote()) {
            try {
              const measurementInputs = [];
              if (Number.isFinite(heightVal)) measurementInputs.push({ month: ageMNow, height: heightVal });
              if (Number.isFinite(weightVal)) measurementInputs.push({ month: ageMNow, weight: weightVal });
              const measurementRecords = buildMeasurementPayloads(measurementInputs);
              const teethRecords = Number.isFinite(teethVal) ? buildTeethPayloads([{ month: ageMNow, count: teethVal }]) : [];
              if (isAnonProfile()) {
                await anonChildRequest('update', {
                  childId: id,
                  child: payload,
                  growthMeasurements: measurementRecords,
                  growthTeeth: teethRecords
                });
                const summary = summarizeUpdate(prevSnap, nextSnap);
                await logChildUpdate(id, 'profile', { summary, prev: prevSnap, next: nextSnap });
                alert('Profil enfant mis à jour.');
                renderSettings();
                return;
              }
              const uid = getActiveProfileId();
              if (!uid) { console.warn('Aucun user_id disponible pour children (update)'); throw new Error('Pas de user_id'); }
              await supabase.from('children').update(payload).eq('id', id);
              const promises = [];
              if (measurementRecords.length) {
                const msPayloads = measurementRecords.map(m => ({ ...m, child_id: id }));
                promises.push(
                  supabase
                    .from('growth_measurements')
                    .upsert(msPayloads, { onConflict: 'child_id,month' })
                );
              }
              if (Number.isFinite(teethVal)) {
                const payloadTeeth = { child_id: id, month: ageMNow, count: teethVal };
                promises.push(
                  supabase.from('growth_teeth').insert([payloadTeeth])
                );
              }
              if (promises.length) {
                const results = await Promise.all(promises);
              }
              const summary = summarizeUpdate(prevSnap, nextSnap);
              await logChildUpdate(id, 'profile', { summary, prev: prevSnap, next: nextSnap });
              alert('Profil enfant mis à jour.');
              renderSettings();
              return;
            } catch (err) {
              alert('Erreur Supabase — modifications enregistrées localement');
            }
          }
          // Repli local
          const childrenAll = store.get(K.children, []);
          const c = childrenAll.find(x=>x.id===id);
          if (!c) return;
          c.firstName = firstName; c.sex = sex; c.dob = newDob; c.photo = photoUrl;
          c.context = {
            allergies: payload.context_allergies,
            history: payload.context_history,
            care: payload.context_care,
            languages: payload.context_languages,
            feedingType: payload.feeding_type,
            eatingStyle: payload.eating_style,
            sleep: {
              falling: payload.sleep_falling,
              sleepsThrough: payload.sleep_sleeps_through,
              nightWakings: payload.sleep_night_wakings,
              wakeDuration: payload.sleep_wake_duration,
              bedtime: payload.sleep_bedtime,
            },
          };
          c.milestones = milestones;
          // Mesures optionnelles supplémentaires
          if (Number.isFinite(heightVal)) c.growth.measurements.push({ month: ageMNow, height: heightVal });
          if (Number.isFinite(weightVal)) c.growth.measurements.push({ month: ageMNow, weight: weightVal });
          if (Number.isFinite(teethVal)) c.growth.teeth.push({ month: ageMNow, count: teethVal });
          store.set(K.children, childrenAll);
          const summary = summarizeUpdate(prevSnap, nextSnap);
          await logChildUpdate(id, 'profile', { summary, prev: prevSnap, next: nextSnap });
          alert('Profil enfant mis à jour.');
          renderSettings();
        } finally {
          f.dataset.busy = '0';
          if (submitBtn) submitBtn.disabled = false;
        }
        }); f && (f.dataset.bound='1');

        document.getElementById('btn-cancel-edit')?.addEventListener('click', () => {
          editBox.removeAttribute('data-edit-id');
          renderSettings();
        });
      }
    }

    const btnExport = $('#btn-export');
    if (btnExport) btnExport.onclick = () => {
      const data = {
        user: store.get(K.user),
        children: store.get(K.children, []),
        forum: store.get(K.forum, {topics:[]}),
        privacy: store.get(K.privacy, {}),
      };
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pedia_export.json'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    };
    const btnDelete = $('#btn-delete-account');
    if (btnDelete && !btnDelete.dataset.bound) {
      btnDelete.dataset.bound='1';
      btnDelete.onclick = () => {
        if (btnDelete.dataset.busy==='1') return; btnDelete.dataset.busy='1'; btnDelete.disabled=true;
        if (!confirm('Supprimer le compte et toutes les données locales ?')) { btnDelete.dataset.busy='0'; btnDelete.disabled=false; return; }
        localStorage.removeItem(K.user);
        localStorage.removeItem(K.children);
        localStorage.removeItem(K.forum);
        localStorage.removeItem(K.privacy);
        localStorage.removeItem(K.session);
        bootstrap();
        alert('Compte supprimé (localement).');
        location.hash = '#/';
      };
    }
    const inputImport = $('#input-import');
    const btnImport = $('#btn-import');
    if (btnImport && inputImport) {
      btnImport.onclick = () => inputImport.click();
      inputImport.addEventListener('change', async (e) => {
        const f = inputImport.files?.[0]; if (!f) return;
        try {
          const text = await f.text();
          const data = JSON.parse(text);
          if (!confirm('Importer ces données et écraser les actuelles ?')) return;
          if (data.user) localStorage.setItem(K.user, JSON.stringify(data.user));
          if (data.children) localStorage.setItem(K.children, JSON.stringify(data.children));
          if (data.forum) localStorage.setItem(K.forum, JSON.stringify(data.forum));
          if (data.privacy) localStorage.setItem(K.privacy, JSON.stringify(data.privacy));
          alert('Import terminé.');
          renderSettings();
        } catch (e) {
          alert('Fichier invalide.');
        } finally {
          inputImport.value = '';
        }
      });
    }
  }

  // Fonctions utilitaires
  function genId() { return Math.random().toString(36).slice(2, 10); }
  function ageInMonths(dob) {
    const d = new Date(dob);
    const now = new Date();
    return Math.max(0, (now.getFullYear()-d.getFullYear())*12 + (now.getMonth()-d.getMonth()));
  }
  function formatAge(dob) {
    const m = ageInMonths(dob);
    const y = Math.floor(m/12); const rm = m%12;
    return y ? `${y} an${y>1?'s':''} ${rm?`• ${rm} mois`:''}` : `${rm} mois`;
  }
  function labelFeedingType(v){
    const map = {
      '': '—',
      'allaitement_exclusif': 'Allaitement exclusif',
      'mixte_allaitement_biberon': 'Mixte',
      'allaitement_diversification': 'Diversification + allaitement',
      'biberon_diversification': 'Biberon + diversification',
      'lait_poudre_vache': 'Lait en poudre / vache'
    }; return map[v] || '—';
  }
  function labelEatingStyle(v){
    const map = {
      '': '—',
      'mange_tres_bien':'Mange très bien',
      'appetit_variable':'Appétit variable',
      'selectif_difficile':'Sélectif / difficile',
      'petites_portions':'Petites portions'
    }; return map[v] || '—';
  }
  function summarizeSleep(s){
    if (!s) return '—';
    const parts = [];
    if (s.falling) parts.push(`endormissement ${s.falling}`);
    if (typeof s.sleepsThrough === 'boolean') parts.push(s.sleepsThrough? 'nuits complètes' : 'réveils');
    if (s.nightWakings) parts.push(`${s.nightWakings} réveil(s)`);
    if (s.wakeDuration) parts.push(`${s.wakeDuration}`);
    return parts.join(' • ') || '—';
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

  function milestonesInputsHtml(values = []) {
    const groups = [
      { title: '0 – 12 mois', start: 0, end: 9 },
      { title: '12 – 24 mois', start: 10, end: 19 },
      { title: '24 – 36 mois', start: 20, end: 29 },
    ];
    return groups.map(g => {
      const items = [];
      for (let i = g.start; i <= g.end; i++) {
        const q = DEV_QUESTIONS[i];
        const id = `ms_edit_${i}`;
        const checked = values[i] ? 'checked' : '';
        items.push(`<div class="qitem"><input type="checkbox" id="${id}" name="milestones[]" data-index="${i}" ${checked}/><label for="${id}">${escapeHtml(q.label)}</label></div>`);
      }
      return `<section class="dev-group"><h4>${g.title}</h4><div class="qgrid">${items.join('')}</div></section>`;
    }).join('');
  }

  // --- Update history helpers ---
  function makeUpdateSnapshot(childLike) {
    if (!childLike) return {};
    return {
      firstName: childLike.firstName || '',
      dob: childLike.dob || '',
      milestones: Array.isArray(childLike.milestones) ? childLike.milestones.slice() : [],
      context: {
        allergies: childLike.context?.allergies || '',
        history: childLike.context?.history || '',
        care: childLike.context?.care || '',
        languages: childLike.context?.languages || '',
        feedingType: childLike.context?.feedingType || '',
        eatingStyle: childLike.context?.eatingStyle || '',
        sleep: {
          falling: childLike.context?.sleep?.falling || '',
          sleepsThrough: typeof childLike.context?.sleep?.sleepsThrough === 'boolean' ? childLike.context.sleep.sleepsThrough : null,
          nightWakings: childLike.context?.sleep?.nightWakings || '',
          wakeDuration: childLike.context?.sleep?.wakeDuration || '',
          bedtime: childLike.context?.sleep?.bedtime || ''
        }
      }
    };
  }

  async function generateAiComment(content) {
    try {
      const res = await fetch('/api/ai/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (!res.ok) return '';
      const j = await res.json();
      return j.text || '';
    } catch {
      return '';
    }
  }

  async function logChildUpdate(childId, updateType, updateContent) {
    if (!childId || !useRemote()) return;
    try {
      const content = typeof updateContent === 'string' ? updateContent : JSON.stringify(updateContent);
      const comment = await generateAiComment(content);
      if (isAnonProfile()) {
        await anonChildRequest('log-update', {
          childId,
          updateType,
          updateContent: content,
          aiComment: comment || null
        });
        return;
      }
      const payload = { child_id: childId, update_type: updateType, update_content: content };
      if (comment) payload.ai_comment = comment;
      const { error } = await supabase
        .from('child_updates')
        .insert([payload]);
      if (error) throw error;
    } catch (e) {
      console.warn('Supabase child_updates insert failed', e);
    }
  }

  async function getChildUpdates(childId) {
    if (!useRemote()) return [];
    try {
      if (isAnonProfile()) {
        const res = await anonChildRequest('list-updates', { childId });
        return Array.isArray(res.updates) ? res.updates : [];
      }
      const { data, error } = await supabase
        .from('child_updates')
        .select('*')
        .eq('child_id', childId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('Supabase child_updates select failed', e);
      return [];
    }
  }

  function summarizeUpdate(prev, next) {
    try {
      const parts = [];
      if ((prev.firstName||'') !== (next.firstName||'')) parts.push(`Prénom: ${escapeHtml(prev.firstName||'—')} → ${escapeHtml(next.firstName||'—')}`);
      if ((prev.dob||'') !== (next.dob||'')) parts.push(`Naissance: ${prev.dob||'—'} → ${next.dob||'—'}`);
      if ((prev.context?.allergies||'') !== (next.context?.allergies||'')) parts.push(`Allergies: ${escapeHtml(prev.context?.allergies||'—')} → ${escapeHtml(next.context?.allergies||'—')}`);
      if ((prev.context?.history||'') !== (next.context?.history||'')) parts.push(`Antécédents: ${escapeHtml(prev.context?.history||'—')} → ${escapeHtml(next.context?.history||'—')}`);
      if ((prev.context?.care||'') !== (next.context?.care||'')) parts.push(`Mode de garde: ${escapeHtml(prev.context?.care||'—')} → ${escapeHtml(next.context?.care||'—')}`);
      if ((prev.context?.languages||'') !== (next.context?.languages||'')) parts.push(`Langues: ${escapeHtml(prev.context?.languages||'—')} → ${escapeHtml(next.context?.languages||'—')}`);
      if ((prev.context?.feedingType||'') !== (next.context?.feedingType||'')) parts.push(`Alimentation: ${labelFeedingType(prev.context?.feedingType||'')} → ${labelFeedingType(next.context?.feedingType||'')}`);
      if ((prev.context?.eatingStyle||'') !== (next.context?.eatingStyle||'')) parts.push(`Appétit: ${labelEatingStyle(prev.context?.eatingStyle||'')} → ${labelEatingStyle(next.context?.eatingStyle||'')}`);
      const pS = prev.context?.sleep || {}; const nS = next.context?.sleep || {};
      const sleepChanges = [];
      if ((pS.falling||'') !== (nS.falling||'')) sleepChanges.push(`endormissement ${pS.falling||'—'} → ${nS.falling||'—'}`);
      if (typeof pS.sleepsThrough === 'boolean' || typeof nS.sleepsThrough === 'boolean') {
        const a = typeof pS.sleepsThrough==='boolean' ? (pS.sleepsThrough?'oui':'non') : '—';
        const b = typeof nS.sleepsThrough==='boolean' ? (nS.sleepsThrough?'oui':'non') : '—';
        if (a !== b) sleepChanges.push(`nuits complètes ${a} → ${b}`);
      }
      if ((pS.nightWakings||'') !== (nS.nightWakings||'')) sleepChanges.push(`réveils ${pS.nightWakings||'—'} → ${nS.nightWakings||'—'}`);
      if ((pS.wakeDuration||'') !== (nS.wakeDuration||'')) sleepChanges.push(`éveils ${pS.wakeDuration||'—'} → ${nS.wakeDuration||'—'}`);
      if ((pS.bedtime||'') !== (nS.bedtime||'')) sleepChanges.push(`coucher ${pS.bedtime||'—'} → ${nS.bedtime||'—'}`);
      if (sleepChanges.length) parts.push(`Sommeil: ${sleepChanges.join(' • ')}`);
      const prevMs = Array.isArray(prev.milestones) ? prev.milestones : [];
      const nextMs = Array.isArray(next.milestones) ? next.milestones : [];
      const msChanges = [];
      for (let i = 0; i < DEV_QUESTIONS.length; i++) {
        const a = !!prevMs[i];
        const b = !!nextMs[i];
        if (a !== b) {
          const label = escapeHtml(DEV_QUESTIONS[i]?.label || '');
          msChanges.push(`${b ? '+' : '-'} ${label}`);
        }
      }
      if (msChanges.length) parts.push(`Jalons: ${msChanges.join(', ')}`);
      return parts.join(' ; ');
    } catch { return ''; }
  }

  // --- Shared child selection helpers (sync across pages) ---
  async function listChildrenSlim() {
    if (useRemote()) {
      try {
        if (isAnonProfile()) {
          const res = await anonChildRequest('list', {});
          const rows = Array.isArray(res.children) ? res.children : [];
          return rows.map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
        }
        const uid = getActiveProfileId();
        if (!uid) {
          console.warn('Aucun user_id disponible pour children (listChildrenSlim)');
          throw new Error('Pas de user_id');
        }
        const { data: rows } = await supabase
          .from('children')
          .select('id,first_name,dob,is_primary')
          .eq('user_id', uid)
          .order('created_at', { ascending: true });
        return (rows || []).map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
      } catch { /* fallback local below */ }
    }
    const children = store.get(K.children, []);
    const user = store.get(K.user) || {};
    return children.map(c => ({ id: c.id, firstName: c.firstName, dob: c.dob, isPrimary: c.id === user.primaryChildId }));
  }

  async function setPrimaryChild(id) {
    if (!id) return;
    if (useRemote()) {
      try {
        if (isAnonProfile()) {
          await anonChildRequest('set-primary', { childId: id });
        } else {
          const uid = getActiveProfileId();
          if (!uid) { console.warn('Aucun user_id disponible pour children (setPrimaryChild)'); throw new Error('Pas de user_id'); }
          await supabase.from('children').update({ is_primary: false }).eq('user_id', uid);
          await supabase.from('children').update({ is_primary: true }).eq('id', id);
        }
      } catch {}
      return;
    }
    const user = store.get(K.user) || {};
    store.set(K.user, { ...user, primaryChildId: id });
  }

  function renderChildSwitcher(container, items, selectedId, onChange) {
    if (!container) return;
    let box = container.querySelector('#child-switcher-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'child-switcher-box';
      box.className = 'stack';
      // Insérer juste après l’en-tête de page si présent (les titres restent avant le sélecteur)
      const header = container.querySelector('.page-header') || container.firstElementChild;
      if (header && header.nextSibling) {
        header.parentNode.insertBefore(box, header.nextSibling);
      } else if (header) {
        header.parentNode.appendChild(box);
      } else {
        container.insertBefore(box, container.firstChild);
      }
    }
    const options = items.map(c => `<option value="${c.id}" ${c.id===selectedId?'selected':''}>${escapeHtml(c.firstName)}${c.dob?` • ${formatAge(c.dob)}`:''}</option>`).join('');
    box.innerHTML = `
      <label>Enfant
        <select id="child-switcher">${options}</select>
      </label>
      <a class="btn btn-primary" href="#/onboarding">Ajouter</a>
    `;
    const sel = box.querySelector('#child-switcher');
    if (sel && !sel.dataset.bound) {
      sel.addEventListener('change', async (e) => {
        const id = e.currentTarget.value;
        await setPrimaryChild(id);
        if (typeof onChange === 'function') onChange(id);
      });
      sel.dataset.bound = '1';
    }
  }

  // Générateur de conseils (simulation d’IA)
  function renderAdvice(ageM){
    const sleep = sleepRecommendation(ageM);
    const tips = [];
    tips.push(`<div>🛏️ Sommeil recommandé: <strong>${sleep.min}–${sleep.max}h</strong> / 24h</div>`);
    if (ageM < 6) tips.push('<div>🍼 Alimentation: lait maternel ou infantile à la demande.</div>');
    else if (ageM < 12) tips.push('<div>🥣 Diversification progressive, textures adaptées, surveiller les allergies.</div>');
    else if (ageM < 36) tips.push('<div>🍽️ 3 repas + 2 collations, proposer fruits/légumes variés.</div>');
    else tips.push('<div>🍽️ Favoriser équilibre: légumes, protéines, féculents, limiter sucres.</div>');

    if (ageM < 18) tips.push('<div>🧩 Dépistage: contact visuel, babillage, interactions sociales.</div>');
    else if (ageM < 36) tips.push('<div>🧩 Dépistage: vocabulaire, compréhension consignes simples, motricité.</div>');
    else tips.push('<div>🧩 Dépistage: langage clair, autonomie habillage, motricité fine.</div>');

    tips.push('<div class="muted">Ces conseils sont indicatifs et ne remplacent pas un avis médical.</div>');
    return tips.map(t=>`<div>${t}</div>`).join('');
  }

  function sleepRecommendation(ageM){
    if (ageM<=3) return {min:14,max:17};
    if (ageM<=11) return {min:12,max:15};
    if (ageM<=24) return {min:11,max:14};
    if (ageM<=60) return {min:10,max:13};
    return {min:9,max:12};
  }
  function sleepRecommendedSeries(){
    const arr=[]; for(let m=0;m<=60;m+=3){const r=sleepRecommendation(m);arr.push({x:m,y:(r.min+r.max)/2});} return arr;
  }

  // Rendu des courbes OMS en SVG (sans dépendance externe)
  function renderWhoChart(id, childData, curve = {}, unit){
    const svg = document.getElementById(id);
    if (!svg) return;
    const buildCurve = (key, color, dash='', width=1) => ({
      color,
      dash,
      width,
      data: Array.from({length:61}, (_,m)=>({x:m, y: curve?.[m]?.[key]}))
                .filter(p=>Number.isFinite(p.y))
    });
    const childSeries = {
      color: 'var(--turquoise)',
      data: childData.map(p=>({x:p.month, y:p.value})),
      isChild: true,
      width: 2
    };
    const series = [
      buildCurve('P3', 'var(--border)', '4 2', 1),
      buildCurve('P15', 'var(--violet)', '', 1),
      buildCurve('P50', 'var(--violet-strong)', '', 1.5),
      buildCurve('P85', 'var(--violet)', '', 1),
      buildCurve('P97', 'var(--border)', '4 2', 1),
      childSeries
    ];
    drawMulti(svg, series);
    const latest = childData[childData.length - 1];
    const note = document.createElement('div'); note.className = 'chart-note';
    const val = latest ? latest.value.toFixed(1) : '—';
    const unitTxt = unit ? ` ${unit}` : '';
    note.textContent = `Courbes OMS (P3 à P97). La zone entre P3 et P97 correspond à la normale. Dernière valeur enregistrée : ${val}${unitTxt}.`;
    svg.parentElement.appendChild(note);
  }

  // Utilitaires de graphiques SVG (léger)
  // Helper pour construire une série unique de données enfant pour les graphiques génériques.
  // L’option `isChild` garantit que les points (dont le dernier marqué) sont rendus comme sur les courbes OMS.
  function buildSeries(list){
    return [{
      color: 'var(--turquoise)',
      data: list.filter(p => Number.isFinite(p.y)),
      isChild: true
    }];
  }
  function drawChart(svg, seriesA, seriesB){ drawMulti(svg, [...(seriesA||[]), ...(seriesB?[{color:'var(--violet)', data:seriesB[0].data}]:[])]); }

  function drawMulti(svg, series){
    if (!svg) return;
    const W = svg.clientWidth || 600; const H = svg.clientHeight || 240;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML='';
    // Calculer les bornes des axes
    const allPoints = series.flatMap(s=>s.data);
    const xs = allPoints.map(p=>p.x);
    const ys = allPoints.map(p=>p.y);
    const minX = Math.min(0, ...xs, 0), maxX = Math.max(60, ...xs, 60);
    const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 10);
    const pad = 28; const left=36, right=12, top=12, bottom=24;
    const innerW = W-left-right, innerH = H-top-bottom;
    const xScale = x => left + (x-minX)/(maxX-minX||1)*innerW;
    const yScale = y => top + (1-(y-minY)/(maxY-minY||1))*innerH;

    // Grille + graduations Y
    const grid = document.createElementNS('http://www.w3.org/2000/svg','g');
    grid.setAttribute('stroke', '#1f2447');
    grid.setAttribute('stroke-width', '1');
    grid.setAttribute('opacity', '0.4');
    grid.setAttribute('stroke-dasharray', '2,4');
    const stepY = (maxY - minY) / 6;
    for(let i=0;i<=6;i++){
      const y = top + i*(innerH/6);
      const l = line(left,y, left+innerW, y);
      grid.appendChild(l);
      // Étiquettes de l’axe Y
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', left - 4);
      t.setAttribute('y', y);
      t.setAttribute('text-anchor','end');
      t.setAttribute('dominant-baseline','middle');
      t.setAttribute('font-size','10');
      t.setAttribute('fill','#aab0c0');
      const val = maxY - stepY * i;
      t.textContent = stepY < 1 ? val.toFixed(1) : Math.round(val);
      svg.appendChild(t);
    }
    svg.appendChild(grid);
    // Axes
    svg.appendChild(line(left, top, left, top+innerH, 'var(--border)'));
    svg.appendChild(line(left, top+innerH, left+innerW, top+innerH, 'var(--border)'));

    // Tracé des séries
    series.forEach((s) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      const pts = s.data.sort((a,b)=>a.x-b.x);
      if (!pts.length) return;
      const d = pts.map((p,i)=>`${i?'L':'M'}${xScale(p.x)},${yScale(p.y)}`).join(' ');
      path.setAttribute('d', d);
      path.setAttribute('fill','none');
      const strokeColor = getComputedStyle(document.documentElement).getPropertyValue(s.color?.match(/^var/)? s.color.slice(4,-1):'') || s.color || '#0ff';
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', s.width || (s.isChild ? '2' : '1'));
      if (s.dash) path.setAttribute('stroke-dasharray', s.dash);
      if (!s.isChild) path.setAttribute('opacity','0.8');
      path.setAttribute('stroke-linecap','round');
      path.setAttribute('stroke-linejoin','round');
      svg.appendChild(path);
      // Points uniquement pour la série enfant
      if (s.isChild) {
        pts.forEach((p,i)=>{
          const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
          const isLatest = i === pts.length - 1;
          c.setAttribute('cx', xScale(p.x));
          c.setAttribute('cy', yScale(p.y));
          c.setAttribute('r', isLatest ? '5' : '3');
          c.setAttribute('fill', s.color || 'cyan');
          c.setAttribute('stroke', '#fff');
          c.setAttribute('stroke-width', '1');
          c.classList.add('child-point');
          if (isLatest) c.classList.add('child-point-latest');
          svg.appendChild(c);
        });
      }
    });

    // Graduations intermédiaires sur l’axe X (tous les 12 mois)
    for (let m=12;m<=60;m+=12){
      const x = xScale(m);
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', x);
      t.setAttribute('y', top+innerH+16);
      t.setAttribute('text-anchor','middle');
      t.setAttribute('font-size','10');
      t.setAttribute('fill','#aab0c0');
      t.textContent = `${Math.round(m/12)}a`;
      svg.appendChild(t);
    }
  }

  function line(x1,y1,x2,y2,stroke='#263169'){
    const l = document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('x1',x1); l.setAttribute('y1',y1); l.setAttribute('x2',x2); l.setAttribute('y2',y2);
    l.setAttribute('stroke',stroke); return l;
  }

  // Initialisation
  bootstrap();
  if (!location.hash) location.hash = '#/';
  setActiveRoute(location.hash);
  // Vérifier l’adaptation de l’en-tête au chargement
  evaluateHeaderFit();
  // Année du pied de page (remplace un script inline pour respecter la CSP)
  try {
    const yEl = document.getElementById('y');
    if (yEl) yEl.textContent = String(new Date().getFullYear());
  } catch {}

  // --- Helpers d’appels IA ---
  async function askAI(question, child, history){
    const payload = { question, child, history };
    const res = await fetch('/api/ai/advice', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    const raw = await res.text();
    if (!res.ok) {
      try { const j = JSON.parse(raw); throw new Error(j.error || j.details || raw || 'AI backend error'); }
      catch { throw new Error(raw || 'AI backend error'); }
    }
    let data; try { data = JSON.parse(raw); } catch { data = { text: raw }; }
    return data.text || 'Aucune réponse.';
  }

  async function askAIRecipes(child, prefs){
    const payload = { child, prefs };
    const res = await fetch('/api/ai/recipes', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
    return data.text || '';
  }

  async function askAIStory(child, opts){
    const payload = { child, ...opts };
    const res = await fetch('/api/ai/story', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
    return data.text || '';
  }

  // Animations révélées au scroll
  function setupScrollAnimations(){
    try { revealObserver?.disconnect(); } catch {}
    const root = document.querySelector('.route.active') || document;
    const targets = [
      ...$$('.card', root),
      ...$$('.feature', root),
      ...$$('.step', root),
      ...$$('.testimonial', root),
      ...$$('.faq-item', root),
      ...$$('.pillar', root),
      ...$$('.chart-card', root)
    ];
    targets.forEach((el, i) => {
      if (!el.classList.contains('reveal')) {
        el.classList.add('reveal');
        if (el.classList.contains('feature') || el.classList.contains('step')) el.classList.add('fade-right');
        el.setAttribute('data-delay', String(Math.min(4, (i % 5))));
      }
    });
    revealObserver = new IntersectionObserver((entries) => {
      for (const e of entries){
        if (e.isIntersecting) e.target.classList.add('in-view');
        else e.target.classList.remove('in-view');
      }
    }, { threshold: 0.01, rootMargin: '0px 0px -10% 0px' });
    targets.forEach(t => revealObserver.observe(t));
    // s’assurer que les éléments au-dessus de la ligne de flottaison apparaissent immédiatement
    targets.forEach(t => {
      const r = t.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      if (r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0) t.classList.add('in-view');
    });
  }
})();
