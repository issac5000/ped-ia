import { ensureReactGlobals } from './react-shim.js';
import { getSupabaseClient } from './supabase-client.js';
import { startViewportBubbles, startLogoBubbles, stopBubbles } from './canvas-bubbles.js';

document.body.classList.remove('no-js');
try {
  const maybePromise = ensureReactGlobals();
  if (maybePromise && typeof maybePromise.then === 'function') {
    maybePromise.catch(err => {
      console.warn('Optional React globals failed to load', err);
    });
  }
} catch (err) {
  console.warn('Optional React globals failed to load', err);
}
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
let supabase=null, authSession=null;
const SESSION_KEY = 'pedia_session';
let anonSession=null;

function refreshAnonSession(){
  try{
    const raw = localStorage.getItem(SESSION_KEY);
    if(!raw){ anonSession=null; return anonSession; }
    const data = JSON.parse(raw);
    if(data && typeof data === 'object'){
      if(!data.code && data.code_unique) data.code = data.code_unique;
      anonSession = data;
    } else {
      anonSession = null;
    }
  }catch(e){ anonSession=null; }
  return anonSession;
}

function clearAnonSession(){
  try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
  anonSession=null;
}

function isAnonLoggedIn(){
  const sess = anonSession;
  if(!sess || sess.type !== 'anon') return false;
  if(sess.loggedIn !== true) return false;
  const code = typeof sess.code === 'string' ? sess.code.trim() : '';
  if(!code) return false;
  if(sess.id == null) return false;
  return true;
}

function updateHeaderAuth(){
  const logged = !!authSession?.user || isAnonLoggedIn();
  const status = $('#login-status');
  $('#btn-login').hidden = logged;
  $('#btn-logout').hidden = !logged;
  if(status){
    status.hidden = !logged;
    const viaCode = !authSession?.user && isAnonLoggedIn();
    const label = logged ? (viaCode ? 'Connecté avec un code' : 'Connecté') : 'Déconnecté';
    status.setAttribute('aria-label', label);
    status.setAttribute('title', label);
  }
}

refreshAnonSession();
updateHeaderAuth();

async function signInGoogle(){
  try{
    if(!supabase){
      supabase = await getSupabaseClient();
    }
    if(!supabase) throw new Error('Supabase indisponible');
    await supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: location.origin } });
  }catch(e){ alert('Connexion Google indisponible'); }
}

function setupHeader(){
  const navBtn = $('#nav-toggle');
  const mainNav = $('#main-nav');
  const navBackdrop = $('#nav-backdrop');
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
    const btn=e.currentTarget; if(btn.dataset.busy==='1') return; btn.dataset.busy='1'; btn.disabled=true;
    try{ await supabase?.auth.signOut(); } catch{}
    clearAnonSession();
    authSession=null;
    updateHeaderAuth();
    alert('Déconnecté.');
    delete btn.dataset.busy;
    btn.disabled=false;
  });
  navBtn?.addEventListener('click', ()=>{
    const isOpen = mainNav?.classList.toggle('open');
    navBtn.setAttribute('aria-expanded', String(!!isOpen));
    if(isOpen) navBackdrop?.classList.add('open'); else navBackdrop?.classList.remove('open');
  });
  $$('#main-nav .nav-link').forEach(a=>a.addEventListener('click', ()=>{
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

async function initAuth(){
  try{
    if(!supabase){
      supabase = await getSupabaseClient();
    }
    if(!supabase) return;
    const { data:{ session } } = await supabase.auth.getSession();
    authSession = session;
    updateHeaderAuth();
    supabase.auth.onAuthStateChange((_e, sess)=>{ authSession=sess; updateHeaderAuth(); });
  }catch(e){ console.warn('Auth init failed', e); }
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
  }catch(e){}
}

function onViewportChange(){
  if(window.innerWidth >= 900) document.body.classList.remove('force-mobile');
  evaluateHeaderFit();
  const isMobile = document.body.classList.contains('force-mobile');
  const mainNav = $('#main-nav');
  const navBtn = $('#nav-toggle');
  const navBackdrop = $('#nav-backdrop');
  if(!isMobile){
    mainNav?.classList.remove('open');
    navBtn?.setAttribute('aria-expanded','false');
    navBackdrop?.classList.remove('open');
    if(mainNav) mainNav.style.removeProperty('display');
  }
}

window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);
let resizeRaf=null;
window.addEventListener('resize', ()=>{
  if(resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(onViewportChange);
});
window.addEventListener('load', evaluateHeaderFit);
window.addEventListener('storage', evt=>{
  if(!evt.key || evt.key === SESSION_KEY){
    refreshAnonSession();
    updateHeaderAuth();
  }
});

// Particules pastel douces sur toute la page
let routeBubbles = null;
function startRouteParticles(force = false){
  const assign = (ctrl) => {
    if (!ctrl) return;
    routeBubbles = ctrl;
  };
  if (routeBubbles && !force) {
    const canvas = routeBubbles.canvas;
    if (canvas && canvas.isConnected) return;
  }
  if (routeBubbles) {
    try { stopBubbles(routeBubbles); }
    catch {}
    routeBubbles = null;
  }
  const immediate = startViewportBubbles({ onReady: assign });
  if (immediate) assign(immediate);
}
function stopRouteParticles(){
  if (!routeBubbles) return;
  stopBubbles(routeBubbles);
  routeBubbles = null;
}

const ensureRouteParticlesAfterLoad = () => {
  startRouteParticles(true);
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureRouteParticlesAfterLoad, { once: true });
} else {
  queueMicrotask?.(ensureRouteParticlesAfterLoad) ?? setTimeout(ensureRouteParticlesAfterLoad, 0);
}
window.addEventListener('load', () => {
  ensureRouteParticlesAfterLoad();
  setTimeout(() => startRouteParticles(true), 0);
});

// Particules autour du logo de page
let logoBubbles = null;
function startLogoParticles(){
  const wrap = document.querySelector('#page-logo .container');
  if (!wrap) return;
  if (logoBubbles && logoBubbles.target === wrap) return;
  stopBubbles(logoBubbles);
  logoBubbles = startLogoBubbles(wrap);
}
function stopLogoParticles(){
  if (!logoBubbles) return;
  stopBubbles(logoBubbles);
  logoBubbles = null;
}

async function init(){
  setupHeader();
  refreshAnonSession();
  updateHeaderAuth();
  evaluateHeaderFit();
  const yEl = document.getElementById('y');
  if(yEl) yEl.textContent = new Date().getFullYear();
  const pl = document.getElementById('page-logo');
  if(pl) pl.hidden = false;
  startRouteParticles();
  startLogoParticles();
  await initAuth();
  startRouteParticles();
  startLogoParticles();
}

window.addEventListener('load', init);

