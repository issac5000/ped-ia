import { ensureReactGlobals } from './react-shim.js';
import { getSupabaseClient } from './supabase-client.js';

document.body.classList.remove('no-js');
try {
  await ensureReactGlobals();
} catch (err) {
  console.warn('Optional React globals failed to load', err);
}
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem(k); },
};

const K = {
  session: 'pedia_session',
  user: 'pedia_user',
};

let supabase, session, user;
let myInitial = '';
let parents = [];
let lastMessages = new Map();
let activeParent = null;
let currentMessages = [];
let messagesChannel = null;
let navBtn, mainNav, navBackdrop;
let headerSetupDone = false;
// Notifications
let notifChannels = [];
let notifCount = 0;
let notifyAudioCtx = null;
let anonNotifTimer = null;

let isAnon = false;
let anonProfile = null;
let loginUIBound = false;

function sanitizeFullName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGoogleProfile(rawProfile, explicitId) {
  if (!rawProfile) return null;
  const rawId = explicitId != null ? explicitId : rawProfile?.id;
  const id = rawId != null ? idStr(rawId) : '';
  if (!id) return null;
  const fullName = sanitizeFullName(
    rawProfile?.full_name ?? rawProfile?.fullName ?? rawProfile?.name ?? ''
  );
  if (!isAnon) {
    console.debug('[GoogleAuth] Profil chargé:', id, fullName);
  }
  return { id, full_name: fullName };
}

function displayNameForProfile(profile) {
  if (!profile) return isAnon ? anonProfile?.fullName || 'Anonyme' : 'Parent';
  if (isAnon) {
    return profile.full_name || anonProfile?.fullName || 'Anonyme';
  }
  const fullName = sanitizeFullName(profile.full_name);
  return fullName || 'Parent';
}

// Normaliser tous les identifiants utilisateur en chaînes pour éviter les incohérences de type
const idStr = id => String(id);

function escapeHTML(str){
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

function isLoggedIn(){
  return isAnon || !!session?.user;
}

function updateAnonFullNameFromSelf(selfData, context = '') {
  if (!anonProfile || !selfData?.full_name) return;
  anonProfile.fullName = selfData.full_name;
  console.debug(`[anon] anonProfile.fullName updated${context ? ` (${context})` : ''}:`, anonProfile.fullName);
}

function updateHeaderAuth(){
  const logged = isLoggedIn();
  $('#btn-login').hidden = logged;
  $('#btn-logout').hidden = !logged;
  $('#login-status').hidden = !logged;
}

async function ensureSupabase(){
  if (supabase) return true;
  try {
    supabase = await getSupabaseClient();
    return !!supabase;
  } catch (e) {
    console.error('ensureSupabase failed', e);
    supabase = null;
    return false;
  }
}

async function fetchAnonProfileByCode(rawCode) {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (!code) throw new Error('Code unique manquant.');
  const response = await fetch('/api/anon/parent-updates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'profile', code })
  });
  const text = await response.text().catch(() => '');
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  if (!response.ok) {
    const err = new Error(payload?.error || 'Connexion impossible pour le moment.');
    if (payload?.details) err.details = payload.details;
    throw err;
  }
  const profile = payload?.data?.profile || null;
  if (!profile || !profile.id) {
    throw new Error('Code introuvable.');
  }
  return profile;
}

function presentLoginGate(){
  const shell = $('#messages-shell');
  if (shell) shell.hidden = true;
  const gate = $('#login-gate');
  if (gate) {
    gate.hidden = false;
    gate.classList.add('active');
  }
  stopAnonNotifPolling();
  if (messagesChannel) {
    try { supabase?.removeChannel(messagesChannel); } catch (e) {}
    messagesChannel = null;
  }
  if (notifChannels.length) {
    try { for (const ch of notifChannels) supabase?.removeChannel(ch); } catch (e) {}
    notifChannels = [];
  }
}

function presentMessagesUI(){
  const gate = $('#login-gate');
  if (gate) {
    gate.classList.remove('active');
    gate.hidden = true;
  }
  const shell = $('#messages-shell');
  if (shell) shell.hidden = false;
}

async function createAnonymousProfile(){
  const status = $('#anon-create-status');
  const btn = $('#btn-create-anon');
  if (btn?.dataset.busy === '1') return;
  if (status) {
    status.classList.remove('error');
    status.textContent = '';
  }
  try {
    if (btn) { btn.dataset.busy = '1'; btn.disabled = true; }
    const url = 'https://myrwcjurblksypvekuzb.supabase.co/functions/v1/profiles-create-anon';
    const payload = {};
    console.debug("Calling Supabase function:", url, payload);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let responsePayload = null;
    try { responsePayload = await response.json(); } catch (e) { responsePayload = null; }
    if (!response.ok || !responsePayload?.profile) {
      const msg = responsePayload?.error || 'Création impossible pour le moment.';
      const err = new Error(msg);
      if (responsePayload?.details) err.details = responsePayload.details;
      throw err;
    }
    const data = responsePayload.profile;
    if (status) {
      status.classList.remove('error');
      status.innerHTML = `Ton code unique&nbsp;: <strong>${data.code_unique}</strong>.<br>Garde-le précieusement et saisis-le juste en dessous dans «&nbsp;Se connecter avec un code&nbsp;».`;
    }
    const input = $('#anon-code-input');
    if (input) {
      input.value = data.code_unique || '';
      try { input.focus(); input.select(); } catch (e) {}
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

async function loginWithCode(){
  const input = $('#anon-code-input');
  const status = $('#anon-login-status');
  const btn = $('#btn-login-code');
  if (btn?.dataset.busy === '1') return;
  const rawCode = (input?.value || '').trim();
  const code = rawCode.toUpperCase();
  if (input) input.value = code;
  status?.classList.remove('error');
  if (!code) {
    if (status) {
      status.classList.add('error');
      status.textContent = 'Saisis ton code unique pour continuer.';
    }
    input?.focus();
    return;
  }
  if (status) status.textContent = '';
  try {
    if (btn) { btn.dataset.busy = '1'; btn.disabled = true; }
    const profile = await fetchAnonProfileByCode(code);
    const fullName = profile.full_name || '';
    const normalizedCode = String(profile.code_unique || code).trim().toUpperCase();
    const profileId = idStr(profile.id);
    store.set(K.session, {
      type: 'anon',
      code: normalizedCode,
      id: profileId,
      fullName,
      loggedIn: true
    });
    try {
      const current = store.get(K.user) || {};
      if (fullName && fullName !== current.pseudo) {
        store.set(K.user, { ...current, pseudo: fullName });
      }
    } catch (e) {}
    if (status) {
      status.classList.remove('error');
      status.textContent = '';
    }
    if (input) input.value = '';
    window.location.reload();
  } catch (e) {
    console.error('loginWithCode failed', e);
    if (status) {
      status.classList.add('error');
      const msg = e instanceof Error && e.message ? e.message : 'Connexion impossible pour le moment.';
      if (/introuvable|invalide/i.test(msg)) {
        status.textContent = 'Code invalide.';
      } else {
        status.textContent = msg;
      }
    }
  } finally {
    if (btn) { btn.dataset.busy = '0'; btn.disabled = false; }
  }
}

function setupLoginUI(){
  if (loginUIBound) return;
  loginUIBound = true;
  document.addEventListener('click', async (e) => {
    const gate = $('#login-gate');
    if (!gate) return;
    const btn = e.target instanceof Element ? e.target.closest('.btn-google-login') : null;
    if (!btn || !gate.contains(btn)) return;
    e.preventDefault();
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.setAttribute('aria-disabled', 'true');
    try {
      const ok = await ensureSupabase();
      if (!ok) throw new Error('Service indisponible');
      await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href } });
    } catch (err) {
      alert('Connexion Google indisponible');
    } finally {
      btn.removeAttribute('aria-disabled');
      delete btn.dataset.busy;
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
}

function setupHeader(){
  if (headerSetupDone) return;
  headerSetupDone = true;
  const redirectToLogin = () => {
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
  };
  $('#btn-login')?.addEventListener('click', e=>{
    e.preventDefault();
    redirectToLogin();
  });
  $('#btn-logout')?.addEventListener('click', async e=>{
    const btn = e.currentTarget; if(btn.dataset.busy==='1') return; btn.dataset.busy='1'; btn.disabled=true;
    try{
      if (isAnon) {
        store.del(K.session);
        stopAnonNotifPolling();
      } else {
        await supabase?.auth.signOut();
      }
    } catch(e){}
    alert('Déconnecté.');
    location.href = isAnon ? '/#/login' : '/';
  });
  navBtn = $('#nav-toggle');
  mainNav = $('#main-nav');
  navBackdrop = $('#nav-backdrop');
  navBtn?.addEventListener('click', ()=>{
    const isOpen = mainNav?.classList.toggle('open');
    navBtn.setAttribute('aria-expanded', String(!!isOpen));
    if(isOpen) navBackdrop?.classList.add('open'); else navBackdrop?.classList.remove('open');
  });
  $$('.main-nav .nav-link').forEach(a=>a.addEventListener('click', ()=>{
    if(mainNav?.classList.contains('open')){
      mainNav.classList.remove('open');
      navBtn?.setAttribute('aria-expanded','false');
      navBackdrop?.classList.remove('open');
    }
  }));
  navBackdrop?.addEventListener('click', ()=>{
    mainNav?.classList.remove('open');
    navBtn?.setAttribute('aria-expanded','false');
    navBackdrop?.classList.remove('open');
  });
}

function evaluateHeaderFit(){
  try{
    const header = document.querySelector('.header-inner');
    const brand = header?.querySelector('.brand');
    const nav = header?.querySelector('#main-nav');
    const auth = header?.querySelector('.auth-actions');
    if(!header || !brand || !nav || !auth) return;
    const padding = 40;
    const cs = getComputedStyle(header);
    const areas = (cs.gridTemplateAreas || '').toString();
    const twoRowLayout = areas.includes('nav');
    let needMobile = false;
    if(twoRowLayout){
      needMobile = nav.scrollWidth > header.clientWidth;
    } else {
      const total = brand.offsetWidth + nav.scrollWidth + auth.offsetWidth + padding;
      needMobile = total > header.clientWidth;
    }
    document.body.classList.toggle('force-mobile', needMobile);
  } catch(e){}
}

function onViewportChange(){
  if(window.innerWidth >= 900) document.body.classList.remove('force-mobile');
  evaluateHeaderFit();
  const isMobile = document.body.classList.contains('force-mobile');
  if(!isMobile){
    mainNav?.classList.remove('open');
    navBtn?.setAttribute('aria-expanded','false');
    navBackdrop?.classList.remove('open');
    if(mainNav) mainNav.style.removeProperty('display');
  }
}

window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);
let resizeRaf = null;
window.addEventListener('resize', () => {
  if(resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(onViewportChange);
});
window.addEventListener('load', evaluateHeaderFit);

// ---- Notifications toast (même style que la SPA) ----
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
function playNotifySound(){
  try {
    notifyAudioCtx = notifyAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = notifyAudioCtx; const now = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type='sine'; osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now+0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now+0.20);
    osc.connect(gain).connect(ctx.destination); osc.start(now); osc.stop(now+0.22);
  } catch (e) {}
}
function showNotification({ title='Notification', text='', actionHref='', actionLabel='Voir', onAcknowledge }={}){
  try {
    const host = getToastHost();
    while (host.children.length >= 4) host.removeChild(host.firstElementChild);
    const toast = document.createElement('div'); toast.className='notify-toast';
    toast.innerHTML=`<div class="nt-content"><h3 class="nt-title"></h3><p class="nt-text"></p><div class="nt-actions"><button type="button" class="btn btn-secondary nt-close">Fermer</button><a class="btn btn-primary nt-link" href="#">${actionLabel}</a></div></div>`;
    toast.querySelector('.nt-title').textContent = title;
    toast.querySelector('.nt-text').textContent = text;
    const link = toast.querySelector('.nt-link');
    if (actionHref) { link.setAttribute('href', actionHref); link.hidden=false; } else { link.hidden=true; }
    const hide = () => { try { toast.classList.add('hide'); setTimeout(()=>toast.remove(), 250); } catch (e) { toast.remove(); } };
    const acknowledge = () => { hide(); try { onAcknowledge && onAcknowledge(); } catch (e) {} };
    toast.querySelector('.nt-close').addEventListener('click', acknowledge);
    link.addEventListener('click', acknowledge);
    host.appendChild(toast);
    playNotifySound();
    const timer = setTimeout(hide, 4000);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => setTimeout(hide, 1500));
  } catch (e) {}
}
function setNavBadgeFor(hrefSel, n){
  const link = document.querySelector(`#main-nav a[href="${hrefSel}"]`);
  if (!link) return;
  let b = link.querySelector('.nav-badge');
  if (!b) { b=document.createElement('span'); b.className='nav-badge'; link.appendChild(b); }
  b.textContent = String(Math.max(0, n|0)); b.hidden = (n|0)===0;
}
function countsByKind(){
  const arr = loadNotifs();
  let msg=0, reply=0; for(const n of arr){ if(!n.seen){ if(n.kind==='msg') msg++; else if(n.kind==='reply') reply++; } }
  return { msg, reply };
}
function updateBadges(){ const { msg, reply } = countsByKind(); setNavBadgeFor('messages.html', msg); setNavBadgeFor('#/community', reply); }
function bumpMessagesBadge(){ updateBadges(); }

// Persistance des notifications non lues (partagée avec la SPA via localStorage)
const NOTIF_STORE = 'pedia_notifs';
function loadNotifs(){ try { return JSON.parse(localStorage.getItem(NOTIF_STORE)) || []; } catch (e) { return []; } }
function saveNotifs(arr){ try { localStorage.setItem(NOTIF_STORE, JSON.stringify(arr)); } catch (e) {} }
function addNotif(n){ const arr = loadNotifs(); const exists = arr.some(x=>x.id===n.id); if(!exists) { arr.push({ ...n, seen:false }); saveNotifs(arr); } updateBadgeFromStore(); return !exists; }
function markNotifSeen(id){ const arr = loadNotifs(); const idx = arr.findIndex(x=>x.id===id); if(idx>=0){ arr[idx].seen=true; saveNotifs(arr); updateBadgeFromStore(); } }
function markAllByTypeSeen(kind){ const arr = loadNotifs().map(x=> x.kind===kind? { ...x, seen:true } : x); saveNotifs(arr); setNotifLastNow(kind); updateBadgeFromStore(); }
function unseen(){ return loadNotifs().filter(x=>!x.seen); }
function updateBadgeFromStore(){ updateBadges(); }
function replayUnseen(){ unseen().forEach(n => { if (n.kind==='msg') { showNotification({ title:'Nouveau message', text:`Vous avez un nouveau message de ${n.fromName||'Un parent'}`, actionHref:`messages.html?user=${n.fromId}`, actionLabel:'Ouvrir' }); } }); }

async function anonMessagesRequest(code_unique, { since = null } = {}) {
  if (!isAnon || !anonProfile?.code) throw new Error('Profil anonyme requis');
  const code = typeof code_unique === 'string' ? code_unique.trim().toUpperCase() : '';
  if (!code) return { messages: [], senders: {} };
  try {
    const payload = { action: 'recent-activity', code };
    if (since) payload.since = since;
    const url = 'https://myrwcjurblksypvekuzb.supabase.co/functions/v1/anon-messages';
    console.debug("Calling Supabase function:", url, payload);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.debug("[anon-messages response]", res);
    const text = await res.text().catch(() => '');
    let json = {};
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }
    if (!res.ok) {
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    const data = json?.data || {};
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const senders = data?.senders && typeof data.senders === 'object' ? data.senders : {};
    if (json?.data?.self?.full_name) {
      updateAnonFullNameFromSelf(json.data.self, 'anonMessagesRequest');
    }
    return { messages, senders };
  } catch (err) {
    console.error('anonMessagesRequest failed', err);
    return { messages: [], senders: {} };
  }
}

const ANON_NOTIF_INTERVAL_MS = 15000;

async function fetchAnonMissedNotifications(){
  if (!isAnon || !anonProfile?.code) return;
  const code = (anonProfile.code || '').toString().trim().toUpperCase();
  if (!code) return;
  const sinceDefault = new Date(Date.now() - 7*24*3600*1000).toISOString();
  const sinceRep = getNotifLastSince('reply') || sinceDefault;
  try {
    const sinceMsg = getNotifLastSince('msg') || sinceDefault;
    const { messages, senders } = await anonMessagesRequest(code, { since: sinceMsg });
    const list = Array.isArray(messages) ? messages : [];
    for (const m of list) {
      if (!m || m.id == null) continue;
      const senderRaw = m.sender_id ?? m.senderId ?? m.sender_code ?? m.senderCode;
      if (senderRaw == null) continue;
      const fromId = idStr(senderRaw);
      const fromName = senders?.[fromId] || m.sender_name || m.senderName || m.sender_full_name || m.senderFullName || 'Un parent';
      const notifId = `msg:${m.id}`;
      const wasNew = addNotif({ id:notifId, kind:'msg', fromId, fromName, createdAt:m.created_at });
      if (wasNew) {
        showNotification({ title:'Nouveau message', text:`Vous avez un nouveau message de ${fromName}`, actionHref:`messages.html?user=${fromId}`, actionLabel:'Ouvrir', onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('msg'); } });
      }
    }
  } catch (e) { console.warn('fetchAnonMissedNotifications messages', e); }
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
        showNotification({ title:'Nouvelle réponse', text:`${who} a répondu à votre publication${t}`, actionHref:'/#/community', actionLabel:'Voir', onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('reply'); } });
      }
    }
  } catch (e) { console.warn('fetchAnonMissedNotifications replies', e); }
  updateBadgeFromStore();
}

function stopAnonNotifPolling(){ if (anonNotifTimer) { clearInterval(anonNotifTimer); anonNotifTimer = null; } }
async function anonNotifTick(){ try { await fetchAnonMissedNotifications(); } catch (e) { console.warn('anon notification tick failed', e); } }
function startAnonNotifPolling(){ stopAnonNotifPolling(); anonNotifTick(); anonNotifTimer = setInterval(anonNotifTick, ANON_NOTIF_INTERVAL_MS); }

async function anonMessagesActionRequest(action, payload = {}) {
  if (!isAnon || !anonProfile?.code) throw new Error('Profil anonyme requis');
  const url = 'https://myrwcjurblksypvekuzb.supabase.co/functions/v1/anon-messages';
  const payloadToSend = { action, code: anonProfile.code, ...payload };
  console.debug("Calling Supabase function:", url, payloadToSend);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadToSend),
  });
  console.debug("[anon-messages response]", res);
  const text = await res.text().catch(() => '');
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch {}
  }
  if (!res.ok) {
    const err = new Error(json?.error || 'Service indisponible');
    if (json?.details) err.details = json.details;
    throw err;
  }
  return json || {};
}

async function anonCommunityRequest(action, payload = {}) {
  if (!isAnon || !anonProfile?.code) throw new Error('Profil anonyme requis');
  const url = 'https://myrwcjurblksypvekuzb.supabase.co/functions/v1/anon-community';
  const payloadToSend = { action, code: anonProfile.code, ...payload };
  console.debug("Calling Supabase function:", url, payloadToSend);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadToSend),
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

// Helpers pour compter les messages non lus par expéditeur
function hasUnreadFrom(otherId){
  const id = idStr(otherId);
  return loadNotifs().some(n => !n.seen && n.kind==='msg' && idStr(n.fromId)===id);
}
function markSenderSeen(otherId){
  const id = idStr(otherId);
  const arr = loadNotifs().map(n => (n.kind==='msg' && idStr(n.fromId)===id) ? { ...n, seen:true } : n);
  saveNotifs(arr);
}

// Messages manqués depuis la dernière consultation
const NOTIF_LAST_KEY = 'pedia_notif_last';
function isNotifUnseen(id){ try { return loadNotifs().some(n=>n.id===id && !n.seen); } catch { return false; } }
function getNotifLast(){ try { return JSON.parse(localStorage.getItem(NOTIF_LAST_KEY)) || {}; } catch (e) { return {}; } }
function setNotifLast(o){ try { localStorage.setItem(NOTIF_LAST_KEY, JSON.stringify(o)); } catch (e) {} }
function getNotifLastSince(kind){ const o=getNotifLast(); return o[kind] || null; }
function setNotifLastNow(kind){ const o=getNotifLast(); o[kind]=new Date().toISOString(); setNotifLast(o); }
async function fetchMissedMessages(){
  try {
    if (isAnon) { await fetchAnonMissedNotifications(); return; }
    if (!supabase || !user?.id) return;
    const sinceDefault = new Date(Date.now() - 7*24*3600*1000).toISOString();
    const since = getNotifLastSince('msg') || sinceDefault;
    const { data: msgs } = await supabase
      .from('messages')
      .select('id,sender_id,created_at')
      .eq('receiver_id', user.id)
      .gt('created_at', since)
      .order('created_at', { ascending:true })
      .limit(50);
    if (msgs && msgs.length) {
      const senders = Array.from(new Set(msgs.map(m=>m.sender_id)));
      let names = new Map();
      try {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id,full_name')
          .in('id', senders);
        const list = Array.isArray(profs) ? profs : [];
        if (!isAnon) {
          list.forEach((p) => {
            normalizeGoogleProfile(p, p?.id);
          });
        }
        names = new Map(
          list.map((p) => [String(p.id), sanitizeFullName(p.full_name)])
        );
      } catch (e) {}
      for (const m of msgs) {
        const fromId = idStr(m.sender_id);
        const fromName = names.get(String(m.sender_id)) || 'Un parent';
        const notifId = `msg:${m.id}`;
        const wasNew = addNotif({ id:notifId, kind:'msg', fromId, fromName, createdAt:m.created_at });
        if (wasNew) {
          showNotification({ title:'Nouveau message', text:`Vous avez un nouveau message de ${fromName}`, actionHref:`messages.html?user=${fromId}`, actionLabel:'Ouvrir', onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('msg'); } });
        }
      }
      updateBadges();
    }
  } catch (e) {}
}

// Particules pastel sur l’ensemble de la page
let routeParticles = { cvs: null, ctx: null, parts: [], raf: 0, resize: null, W: 0, H: 0 };
function startRouteParticles(){
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cvs = document.createElement('canvas');
    cvs.className = 'route-canvas route-canvas-fixed';
    // S’assurer que le canvas d’arrière-plan ne bloque jamais les interactions
    cvs.style.pointerEvents = 'none';
    document.body.prepend(cvs);
    const ctx = cvs.getContext('2d');
    const state = routeParticles;
    state.cvs = cvs; state.ctx = ctx; state.parts = [];
    function resize(){
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio||1));
      state.W = window.innerWidth; state.H = window.innerHeight;
      cvs.width = Math.floor(state.W*dpr); cvs.height = Math.floor(state.H*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    resize();
    state.resize = resize;
    window.addEventListener('resize', resize);
    const cs = getComputedStyle(document.documentElement);
    const palette = [
      cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
      cs.getPropertyValue('--orange').trim()||'#ffcba4',
      cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
      '#ffd9e6'
    ];
    const area = Math.max(1, state.W*state.H);
    const N = Math.max(14, Math.min(40, Math.round(area/52000)));
    for(let i=0;i<N;i++){
      const u=Math.random();
      const r = u<.5 ? (4+Math.random()*7) : (u<.85 ? (10+Math.random()*10) : (20+Math.random()*18));
      state.parts.push({
        x:Math.random()*state.W,
        y:Math.random()*state.H,
        r,
        vx:(Math.random()*.28-.14),
        vy:(Math.random()*.28-.14),
        hue:palette[Math.floor(Math.random()*palette.length)],
        alpha:.10+Math.random()*.20,
        drift:Math.random()*Math.PI*2,
        spin:.001+Math.random()*.003
      });
    }
    const step=()=>{
      ctx.clearRect(0,0,state.W,state.H);
      for(const p of state.parts){
        p.drift += p.spin;
        p.x += p.vx + Math.cos(p.drift)*.04;
        p.y += p.vy + Math.sin(p.drift)*.04;
        if(p.x<-20) p.x=state.W+20; if(p.x>state.W+20) p.x=-20;
        if(p.y<-20) p.y=state.H+20; if(p.y>state.H+20) p.y=-20;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.hue;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      }
      state.raf = requestAnimationFrame(step);
    };
    step();
  } catch(e){}
}

// Particules autour du logo en haut de page
let logoParticles = { cvs:null, ctx:null, parts:[], raf:0, resize:null, W:0, H:0 };
function startLogoParticles(){
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const wrap = document.querySelector('#page-logo .container');
    if(!wrap) return;
    const cvs = document.createElement('canvas');
    cvs.className='logo-canvas';
    // Le canvas est décoratif : il ne doit pas intercepter les clics
    cvs.style.pointerEvents = 'none';
    wrap.prepend(cvs);
    const ctx = cvs.getContext('2d');
    const state = logoParticles;
    state.cvs=cvs; state.ctx=ctx; state.parts=[];
    function resize(){
      const dpr=Math.max(1, Math.min(2, window.devicePixelRatio||1));
      state.W=wrap.clientWidth; state.H=wrap.clientHeight;
      cvs.width=Math.floor(state.W*dpr); cvs.height=Math.floor(state.H*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    resize();
    state.resize=resize;
    window.addEventListener('resize', resize);
    const cs = getComputedStyle(document.documentElement);
    const palette=[
      cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
      cs.getPropertyValue('--orange').trim()||'#ffcba4',
      cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
      '#ffd9e6'
    ];
    const area=Math.max(1,state.W*state.H);
    const N=Math.max(6, Math.min(16, Math.round(area/20000)));
    for(let i=0;i<N;i++){
      const u=Math.random();
      const r=u<.5?(3+Math.random()*5):(u<.85?(8+Math.random()*8):(16+Math.random()*12));
      state.parts.push({
        x:Math.random()*state.W,
        y:Math.random()*state.H,
        r,
        vx:(Math.random()*.25-.125),
        vy:(Math.random()*.25-.125),
        hue:palette[Math.floor(Math.random()*palette.length)],
        alpha:.10+Math.random()*.20,
        drift:Math.random()*Math.PI*2,
        spin:.001+Math.random()*.003
      });
    }
    const step=()=>{
      ctx.clearRect(0,0,state.W,state.H);
      for(const p of state.parts){
        p.drift+=p.spin;
        p.x+=p.vx+Math.cos(p.drift)*.03;
        p.y+=p.vy+Math.sin(p.drift)*.03;
        if(p.x<-20) p.x=state.W+20; if(p.x>state.W+20) p.x=-20;
        if(p.y<-20) p.y=state.H+20; if(p.y>state.H+20) p.y=-20;
        ctx.globalAlpha=p.alpha; ctx.fillStyle=p.hue;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      }
      state.raf=requestAnimationFrame(step);
    };
    step();
  } catch(e){}
}

function preparePageChrome(){
  setupHeader();
  setupLoginUI();
  updateHeaderAuth();
  evaluateHeaderFit();
  const pageLogo = document.getElementById('page-logo');
  if (pageLogo) pageLogo.hidden = false;
  if (!routeParticles.cvs) startRouteParticles();
  if (!logoParticles.cvs) startLogoParticles();
}


async function init(){
  try {
    const ok = await ensureSupabase();
    if (!ok) throw new Error('Supabase indisponible');
    try {
      const urlNow = new URL(window.location.href);
      if (urlNow.searchParams.get('code')) {
        await supabase.auth.exchangeCodeForSession(window.location.href);
        urlNow.search = '';
        history.replaceState({}, '', urlNow.toString());
      }
    } catch (e) { console.warn('OAuth code exchange failed', e); }
    const { data: { session: s } } = await supabase.auth.getSession();
    if(!s){
      const saved = store.get(K.session);
      if (saved?.type === 'anon' && saved?.code && saved?.id) {
        isAnon = true;
        anonProfile = {
          id: idStr(saved.id),
          code: String(saved.code).trim().toUpperCase(),
          fullName: saved.fullName || '',
        };
        user = { id: idStr(saved.id) };
        session = null;
        const initialName = (anonProfile.fullName || '').trim();
        if (initialName) myInitial = initialName[0].toUpperCase();
        try {
          const resSelf = await anonMessagesActionRequest('profile-self', {});
          const dataSelf = resSelf?.data || {};
          const profileSelf = dataSelf.self || dataSelf.profile || null;
          if (resSelf?.data?.self?.full_name) {
            updateAnonFullNameFromSelf(resSelf.data.self, 'init profile-self');
          }
          if (profileSelf?.full_name) {
            const first = (profileSelf.full_name || '').trim()[0];
            if (first) myInitial = first.toUpperCase();
          }
        } catch (e) {
          console.warn('Impossible de récupérer le profil anonyme', e);
        }
        if (!myInitial) myInitial = 'A';
      } else {
        isAnon = false;
        anonProfile = null;
        user = null;
        session = null;
      }
    } else {
      session = s;
      user = s.user;
      user.id = idStr(user.id);
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id,full_name')
          .eq('id', user.id)
          .maybeSingle();
        const name = sanitizeFullName(prof?.full_name);
        if (prof) {
          normalizeGoogleProfile({ ...prof, id: prof.id ?? user.id }, prof.id ?? user.id);
        }
        myInitial = (name ? name[0] : (user.email?.[0] || '')).toUpperCase();
      } catch (e) {
        try { myInitial = (user.email?.[0] || '').toUpperCase(); } catch {}
      }
    }
    if (!myInitial) {
      const pseudo = store.get(K.user)?.pseudo || '';
      const first = pseudo.trim()[0];
      if (first) myInitial = first.toUpperCase();
      if (!myInitial) myInitial = 'P';
    }
    preparePageChrome();
    updateBadgeFromStore();
    if (!isLoggedIn()) {
      presentLoginGate();
      return;
    }
    presentMessagesUI();
    await loadConversations();
    const pre = new URLSearchParams(location.search).get('user');
    if(pre){ await ensureConversation(pre); openConversation(pre); }
    updateBadgeFromStore();
    setupRealtimeNotifications();
    fetchMissedMessages();
    try {
      const booted = sessionStorage.getItem('pedia_notif_booted') === '1';
      if (!booted) { replayUnseen(); sessionStorage.setItem('pedia_notif_booted', '1'); }
    } catch (e) { /* ignore */ }
    if (!isAnon) {
      try {
        const booted = sessionStorage.getItem('pedia_notif_booted') === '1';
        if (!booted) {
          const sinceDefault = new Date(Date.now() - 7*24*3600*1000).toISOString();
          const sinceRep = getNotifLastSince('reply') || sinceDefault;
          const [{ data: topics }, { data: myReps }] = await Promise.all([
            supabase.from('forum_topics').select('id').eq('user_id', user.id).limit(200),
            supabase.from('forum_replies').select('topic_id').eq('user_id', user.id).limit(500)
          ]);
          const topicIdSet = new Set([...(topics||[]).map(t=>t.id), ...(myReps||[]).map(r=>r.topic_id)]);
          const topicIds = Array.from(topicIdSet);
          if (topicIds.length) {
            const { data: reps } = await supabase
              .from('forum_replies')
              .select('id,topic_id,user_id,created_at')
              .in('topic_id', topicIds)
              .neq('user_id', user.id)
              .gt('created_at', sinceRep)
              .order('created_at', { ascending:true })
              .limit(100);
            if (reps && reps.length) {
              const userIds = Array.from(new Set(reps.map(r=>r.user_id)));
              let names = new Map();
              try {
                const { data: profs } = await supabase
                  .from('profiles')
                  .select('id,full_name')
                  .in('id', userIds);
                const list = Array.isArray(profs) ? profs : [];
                if (!isAnon) {
                  list.forEach((p) => {
                    normalizeGoogleProfile(p, p?.id);
                  });
                }
                names = new Map(
                  list.map((p) => [String(p.id), sanitizeFullName(p.full_name)])
                );
              } catch (e) {}
              let titleMap = new Map();
              try { const { data: ts } = await supabase.from('forum_topics').select('id,title').in('id', Array.from(new Set(reps.map(r=>r.topic_id)))); titleMap = new Map((ts||[]).map(t=>[t.id, (t.title||'').replace(/^\[(.*?)\]\s*/, '')])); } catch (e) {}
              for (const r of reps) {
                const who = names.get(String(r.user_id)) || 'Un parent';
                const title = titleMap.get(r.topic_id) || '';
                const notifId = `reply:${r.id}`;
                addNotif({ id:notifId, kind:'reply', who, title, topicId:r.topic_id, createdAt:r.created_at });
                if (isNotifUnseen(notifId)) {
                  showNotification({ title:'Nouvelle réponse', text:`${who} a répondu à votre publication${title?` « ${title} »`:''}`, actionHref:'/#/community', actionLabel:'Voir' });
                }
              }
              updateBadges();
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error('Init error', e);
    isAnon = false;
    anonProfile = null;
    session = null;
    user = null;
    preparePageChrome();
    updateBadgeFromStore();
    presentLoginGate();
  }
}

async function loadConversations(){
  const list = $('#parents-list');
  list.innerHTML = '<li>Chargement…</li>';
  if (isAnon) {
    try {
      const res = await anonMessagesActionRequest('list-conversations', {});
      const data = res?.data || {};
      const convs = Array.isArray(data.conversations) ? data.conversations : [];
      const profileList = Array.isArray(data.profiles) ? data.profiles : [];
      if (res?.data?.self?.full_name) {
        updateAnonFullNameFromSelf(res.data.self, 'loadConversations');
        const initial = (res.data.self.full_name || '').trim()[0];
        if (initial) myInitial = initial.toUpperCase();
      }
      const profileMap = new Map(profileList.map(p => [idStr(p.id), p.full_name || anonProfile?.fullName || 'Anonyme']));
      parents = convs.map(conv => {
        const pid = idStr(conv.otherId);
        const fullName = profileMap.get(pid) || anonProfile?.fullName || 'Anonyme';
        return { id: pid, full_name: fullName };
      });
      profileList.forEach(p => {
        const pid = idStr(p.id);
        if (!parents.some(x => x.id === pid)) parents.push({ id: pid, full_name: p.full_name || anonProfile?.fullName || 'Anonyme' });
      });
      lastMessages = new Map();
      convs.forEach(conv => {
        if (!conv) return;
        const pid = idStr(conv.otherId);
        const msg = conv.lastMessage;
        if (msg) {
          lastMessages.set(pid, {
            ...msg,
            sender_id: idStr(msg.sender_id),
            receiver_id: idStr(msg.receiver_id),
          });
        } else {
          lastMessages.set(pid, null);
        }
      });
      renderParentList();
    } catch (e) {
      console.error('loadConversations anon', e);
      list.innerHTML = '<li>Erreur.</li>';
    }
    return;
  }
  const { data, error } = await supabase
    .from('messages')
    .select('id,sender_id,receiver_id,content,created_at')
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .order('created_at', { ascending:false });
  if(error){ list.innerHTML = '<li>Erreur.</li>'; return; }
  const convMap = new Map();
  (data||[]).forEach(m=>{
    const sender = idStr(m.sender_id);
    const receiver = idStr(m.receiver_id);
    const other = sender===user.id ? receiver : sender;
    const key = idStr(other);
    if(!convMap.has(key)) convMap.set(key, { ...m, sender_id: sender, receiver_id: receiver });
  });
  const ids = Array.from(convMap.keys());
  let profiles = [];
  if(ids.length){
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const token = s?.access_token || '';
      const url = 'https://myrwcjurblksypvekuzb.supabase.co/functions/v1/profiles-by-ids';
      const payload = { ids };
      console.debug('[profiles-by-ids request]', payload);
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      console.debug('[profiles-by-ids response]', r);
      if (r.ok) {
        const j = await r.json();
        profiles = (j.profiles||[])
          .map((p) => normalizeGoogleProfile(p, p?.id))
          .filter(Boolean);
      } else {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id,full_name')
          .in('id', ids);
        profiles = (Array.isArray(profs) ? profs : [])
          .map((p) => normalizeGoogleProfile(p, p?.id))
          .filter(Boolean);
      }
    } catch (e) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id,full_name')
        .in('id', ids);
      profiles = (Array.isArray(profs) ? profs : [])
        .map((p) => normalizeGoogleProfile(p, p?.id))
        .filter(Boolean);
    }
  }
  parents = profiles.slice();
  // Certaines conversations peuvent impliquer des utilisateurs sans profil.
  // On veille à afficher malgré tout ces identifiants avec un profil par défaut
  ids.forEach(id=>{
    if(!parents.some(p=>p.id===id)) parents.push({ id, full_name:'' });
  });
  lastMessages = convMap;
  renderParentList();
}

function renderParentList(){
  const list = $('#parents-list');
  list.innerHTML='';
  parents.sort((a,b)=>{
    const ta = new Date(lastMessages.get(a.id)?.created_at||0);
    const tb = new Date(lastMessages.get(b.id)?.created_at||0);
    return tb - ta;
  });
  parents.forEach(p=>{
    const last = lastMessages.get(p.id);
    const li = document.createElement('li');
    li.className='parent-item';
    li.dataset.id = p.id;
    const time = last? new Date(last.created_at).toLocaleString() : '';
    const unreadDot = hasUnreadFrom(p.id) ? '<span class="dot-unread" title="Nouveau message"></span>' : '';
    const authorName = displayNameForProfile(p);
    li.innerHTML = `
      <div class="meta">
        <div class="name">${escapeHTML(authorName)} ${unreadDot}</div>
        ${time?`<time>${time}</time>`:''}
      </div>
      <button class="del-btn" title="Supprimer">✖</button>`;
    li.addEventListener('click', ()=>openConversation(p.id));
    li.querySelector('.del-btn').addEventListener('click', e=>{ e.stopPropagation(); deleteConversation(p.id); });
    list.appendChild(li);
  });
  if(!parents.length) list.innerHTML='<li>Aucune conversation</li>';
}

async function ensureConversation(otherId){
  const id = idStr(otherId);
  if(parents.some(p=>p.id===id)) return;
  if (isAnon) {
    let profile = { id, full_name: anonProfile?.fullName || 'Anonyme' };
    try {
      const res = await anonMessagesActionRequest('profile', { otherId: id });
      if (res?.data?.self?.full_name) {
        updateAnonFullNameFromSelf(res.data.self, 'ensureConversation');
      }
      if (res?.data?.profile) {
        profile = { id: idStr(res.data.profile.id), full_name: res.data.profile.full_name || anonProfile?.fullName || 'Anonyme' };
      }
    } catch (e) {}
    parents.push(profile);
    if (!lastMessages.has(id)) lastMessages.set(id, null);
    renderParentList();
    return;
  }
  let profile = { id, full_name:'' };
  try {
    const { data: { session: s } } = await supabase.auth.getSession();
    const token = s?.access_token || '';
    const url = 'https://myrwcjurblksypvekuzb.supabase.co/functions/v1/profiles-by-ids';
    const payload = { ids: [id] };
    console.debug('[profiles-by-ids request]', payload);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    console.debug('[profiles-by-ids response]', r);
    if (r.ok) {
      const j = await r.json();
      const p = (j.profiles||[])[0];
      const normalized = normalizeGoogleProfile(p, p?.id ?? id);
      if (normalized) profile = normalized;
    } else {
      const { data } = await supabase
        .from('profiles')
        .select('id,full_name')
        .eq('id', id)
        .maybeSingle();
      const normalized = normalizeGoogleProfile(data, data?.id ?? id);
      if (normalized) profile = normalized;
    }
  } catch {
    const { data } = await supabase
      .from('profiles')
      .select('id,full_name')
      .eq('id', id)
      .maybeSingle();
    const normalized = normalizeGoogleProfile(data, data?.id ?? id);
    if (normalized) profile = normalized;
  }
  parents.push(profile);
  lastMessages.set(id, null);
  renderParentList();
}

async function deleteConversation(otherId){
  const id = idStr(otherId);
  if(!confirm('Supprimer cette conversation ?')) return;
  try {
    if (isAnon) {
      await anonMessagesActionRequest('delete-conversation', { otherId: id });
    } else {
      const url = 'https://myrwcjurblksypvekuzb.supabase.co/functions/v1/messages-delete-conversation';
      const payload = { otherId: id };
      console.debug("Calling Supabase function:", url, payload);
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify(payload)
      });
      if(!r.ok){
        let info = '';
        try { const j = await r.json(); info = j?.error ? `${j.error}${j.details?` - ${j.details}`:''}` : (await r.text()); } catch(e){}
        throw new Error(`HTTP ${r.status}${info?`: ${info}`:''}`);
      }
    }
  } catch (e){
    console.error('delete conv', e);
    alert(`Erreur lors de la suppression. ${e?.message||''}`);
    return;
  }
  parents = parents.filter(p=>p.id!==id);
  lastMessages.delete(id);
  if(activeParent?.id===id){
    activeParent=null;
    currentMessages=[];
    $('#conversation').innerHTML='';
    if(messagesChannel && !isAnon) await supabase.removeChannel(messagesChannel);
    messagesChannel=null;
    const cw = document.querySelector('.chat-window');
    if (cw) cw.classList.remove('open');
    const ph = document.getElementById('chat-placeholder');
    if (ph) ph.classList.remove('hidden');
  }
  renderParentList();
}

async function openConversation(otherId){
  const id = idStr(otherId);
  await ensureConversation(id);
  activeParent = parents.find(p=>p.id===id);
  $$('#parents-list .parent-item').forEach(li=>li.classList.toggle('active', li.dataset.id===id));
  // Marquer les messages non lus de cet expéditeur comme lus puis rafraîchir badges et liste
  try { markSenderSeen(id); updateBadgeFromStore(); renderParentList(); } catch (e) {}
  currentMessages = [];
  $('#conversation').innerHTML='';
  await fetchConversation(id);
  if (!isAnon) setupMessageSubscription(id);
  const cw = document.querySelector('.chat-window');
  if (cw) cw.classList.add('open');
  const ph = document.getElementById('chat-placeholder');
  if (ph) ph.classList.add('hidden');
}

async function fetchConversation(otherId){
  const id = idStr(otherId);
  if (isAnon) {
    try {
      const res = await anonMessagesActionRequest('get-conversation', { otherId: id });
      const data = res?.data || {};
      const messages = Array.isArray(data.messages) ? data.messages.map(m => ({
        ...m,
        sender_id: idStr(m.sender_id),
        receiver_id: idStr(m.receiver_id),
      })) : [];
      currentMessages = messages;
      if (res?.data?.self?.full_name) {
        updateAnonFullNameFromSelf(res.data.self, 'fetchConversation');
      }
      if (res?.data?.profile) {
        const fullName = res.data.profile.full_name || anonProfile?.fullName || 'Anonyme';
        const existing = parents.find(p => p.id === id);
        if (existing) existing.full_name = fullName;
        else parents.push({ id, full_name: fullName });
        activeParent = parents.find(p => p.id === id) || { id, full_name: fullName };
      }
      renderMessages();
    } catch (e) {
      console.error('fetchConversation anon', e);
    }
    return;
  }
  const { data, error } = await supabase
    .from('messages')
    .select('id,sender_id,receiver_id,content,created_at')
    .or(`and(sender_id.eq.${user.id},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${user.id})`)
    .order('created_at', { ascending:true });
  if(error){ console.error('load messages', error); return; }
  currentMessages = (data||[]).map(m=>({ ...m, sender_id:idStr(m.sender_id), receiver_id:idStr(m.receiver_id) }));
  renderMessages();
}

function renderMessages(){
  const wrap = $('#conversation');
  wrap.innerHTML='';
  currentMessages.forEach(m=>{
    const mine = m.sender_id===user.id;
    const line = document.createElement('div');
    line.className = 'chat-line ' + (mine? 'user':'assistant');
    const otherName = displayNameForProfile(activeParent);
    const otherInitial = (otherName?.trim?.()[0] || '').toUpperCase();
    const meInitial = (myInitial||'').toUpperCase();
    line.innerHTML = `\n      <div class="avatar">${mine? meInitial : otherInitial}</div>\n      <div class="message"><div class="bubble ${mine?'user':'assistant'}">${escapeHTML(m.content)}</div></div>`;
    wrap.appendChild(line);
    const convo = document.getElementById("conversation");
    if (convo) convo.scrollTop = convo.scrollHeight;
  });
  wrap.scrollTop = wrap.scrollHeight;
}

$('#message-form').addEventListener('submit', async e=>{
  e.preventDefault();
  if(!activeParent) return;
  const textarea = $('#message-input');
  const content = textarea.value.trim();
  if(!content) return;
  textarea.value='';
  if (isAnon) {
    try {
      const res = await anonMessagesActionRequest('send', { otherId: idStr(activeParent.id), content });
      const data = res?.data || {};
      if (res?.data?.self?.full_name) {
        updateAnonFullNameFromSelf(res.data.self, 'sendMessage');
      }
      const saved = data.message;
      if (saved) {
        const msg = {
          ...saved,
          sender_id: idStr(saved.sender_id),
          receiver_id: idStr(saved.receiver_id),
        };
        currentMessages.push(msg);
        renderMessages();
        lastMessages.set(activeParent.id, msg);
        renderParentList();
      }
    } catch (err) {
      console.error('send message anon', err);
      alert('Envoi impossible pour le moment.');
    }
    return;
  }
  const { data, error } = await supabase
    .from('messages')
    .insert({ sender_id:user.id, receiver_id:idStr(activeParent.id), content })
    .select()
    .single();
  if(error){ console.error('send message', error); return; }
  const msg = {
    ...data,
    sender_id: idStr(data.sender_id),
    receiver_id: idStr(data.receiver_id)
  };
  currentMessages.push(msg);
  renderMessages();
  lastMessages.set(activeParent.id, msg);
  renderParentList();
});

function setupMessageSubscription(otherId){
  if (isAnon) { messagesChannel = null; return; }
  const id = idStr(otherId);
  if(messagesChannel) supabase.removeChannel(messagesChannel);
  messagesChannel = supabase
    .channel('room-'+id)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
      const m = payload.new;
      const sender = idStr(m.sender_id);
      const receiver = idStr(m.receiver_id);
      if((sender===user.id && receiver===id) || (sender===id && receiver===user.id)){
        // Dédupliquer : éviter les doublons lorsqu’un enregistrement local a déjà été ajouté
        if (currentMessages.some(x => String(x.id) === String(m.id))) return;
        const msg = { ...m, sender_id: sender, receiver_id: receiver };
        currentMessages.push(msg); renderMessages();
        lastMessages.set(id, msg); renderParentList();
        // Si un message arrive depuis l’interlocuteur actif, le marquer comme lu
        if (sender===id && receiver===user.id) { try { markSenderSeen(id); updateBadgeFromStore(); renderParentList(); } catch (e) {} }
      }
    })
    .subscribe();
}

// Notifications temps réel (messages reçus, réponses à mes sujets/commentaires)
function setupRealtimeNotifications(){
  try {
    stopAnonNotifPolling();
    if (isAnon) { startAnonNotifPolling(); return; }
    if (!supabase || !user?.id) return;
    // Nettoyer les anciens abonnements
    try { for(const ch of notifChannels) supabase.removeChannel(ch); } catch (e) {}
    notifChannels = [];
    // Messages qui me sont adressés
  const chMsg = supabase
    .channel('notify-messages-'+user.id)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`receiver_id=eq.${user.id}` }, async (payload) => {
      const row = payload.new || {}; const fromId = idStr(row.sender_id);
      let fromName = 'Un parent';
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id,full_name')
          .eq('id', fromId)
          .maybeSingle();
        if (!isAnon && data) {
          normalizeGoogleProfile(data, data?.id ?? fromId);
        }
        const name = sanitizeFullName(data?.full_name);
        if (name) fromName = name;
      } catch (e) {}
      const wasNew = addNotif({ id:`msg:${row.id}`, kind:'msg', fromId, fromName, createdAt: row.created_at });
      if (wasNew) {
        showNotification({ title:'Nouveau message', text:`Vous avez un nouveau message de ${fromName}`, actionHref:`messages.html?user=${fromId}`, actionLabel:'Ouvrir', onAcknowledge: () => { markNotifSeen(`msg:${row.id}`); setNotifLastNow('msg'); } });
        updateBadges();
      }
      // Rafraîchir la liste des conversations pour refléter les indicateurs de lecture
      try { renderParentList(); } catch (e) {}
    })
      .subscribe();
    notifChannels.push(chMsg);
    // Réponses aux sujets que je possède ou auxquels j’ai répondu
    const chRep = supabase
      .channel('notify-replies-'+user.id)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'forum_replies' }, async (payload) => {
        const r = payload.new || {}; if(!r?.topic_id) return; if (String(r.user_id)===String(user.id)) return;
        try {
          const { data: topic } = await supabase.from('forum_topics').select('id,user_id,title').eq('id', r.topic_id).maybeSingle();
          if (!topic) return;
          let isParticipant = String(topic.user_id)===String(user.id);
          if (!isParticipant) {
            const { count } = await supabase
              .from('forum_replies')
              .select('id', { count:'exact', head:true })
              .eq('topic_id', r.topic_id)
              .eq('user_id', user.id);
            isParticipant = (count||0) > 0;
          }
          if (!isParticipant) return;
          let who='Un parent'; try {
            const { data: prof } = await supabase
              .from('profiles')
              .select('id,full_name')
              .eq('id', r.user_id)
              .maybeSingle();
            if (!isAnon && prof) {
              normalizeGoogleProfile(prof, prof?.id ?? r.user_id);
            }
            const name = sanitizeFullName(prof?.full_name);
            if (name) who = name;
          } catch (e) {}
          const title=(topic.title||'').replace(/^\[(.*?)\]\s*/, '');
          const wasNew = addNotif({ id:`reply:${r.id}`, kind:'reply', who, title, topicId:r.topic_id, createdAt:r.created_at });
          if (wasNew) {
            showNotification({ title:'Nouvelle réponse', text:`${who} a répondu à votre publication${title?` « ${title} »`:''}`, actionHref:'/#/community', actionLabel:'Voir', onAcknowledge: () => { markNotifSeen(`reply:${r.id}`); setNotifLastNow('reply'); } });
            updateBadges();
          }
        } catch (e) {}
      })
      .subscribe();
    notifChannels.push(chRep);
  } catch (e) { console.warn('setupRealtimeNotifications error', e); }
}

init();
