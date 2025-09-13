document.body.classList.remove('no-js');
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

let supabase, session, user;
let parents = [];
let lastMessages = new Map();
let activeParent = null;
let currentMessages = [];
let messagesChannel = null;
let navBtn, mainNav, navBackdrop;

// Normalize all user IDs to strings to avoid type mismatches
const idStr = id => String(id);

function escapeHTML(str){
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

function updateHeaderAuth(){
  $('#btn-login').hidden = !!session?.user;
  $('#btn-logout').hidden = !session?.user;
  $('#login-status').hidden = !session?.user;
}

function setupHeader(){
  $('#btn-logout')?.addEventListener('click', async e=>{
    const btn = e.currentTarget; if(btn.dataset.busy==='1') return; btn.dataset.busy='1'; btn.disabled=true;
    try{ await supabase?.auth.signOut(); } catch{}
    alert('Déconnecté.');
    location.href='/';
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
  } catch{}
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

// Soft pastel particles over entire page
let routeParticles = { cvs: null, ctx: null, parts: [], raf: 0, resize: null, W: 0, H: 0 };
function startRouteParticles(){
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cvs = document.createElement('canvas');
    cvs.className = 'route-canvas route-canvas-fixed';
    // Ensure background canvas never blocks interactions
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
  } catch{}
}

// Particles around page logo
let logoParticles = { cvs:null, ctx:null, parts:[], raf:0, resize:null, W:0, H:0 };
function startLogoParticles(){
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const wrap = document.querySelector('#page-logo .container');
    if(!wrap) return;
    const cvs = document.createElement('canvas');
    cvs.className='logo-canvas';
    // Canvas is decorative; it must not intercept clicks
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
  } catch{}
}

async function init(){
  try {
    const env = await fetch('/api/env').then(r=>r.json());
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    supabase = createClient(env.url, env.anonKey, { auth: { persistSession:true, autoRefreshToken:true } });
    const { data: { session:s } } = await supabase.auth.getSession();
    if(!s){ alert('Veuillez vous connecter.'); window.location.href='/'; return; }
    session = s;
    user = s.user;
    // force user ID to string to avoid type mismatches with DB numeric ids
    user.id = idStr(user.id);
    setupHeader();
    updateHeaderAuth();
    evaluateHeaderFit();
    document.getElementById('page-logo').hidden = false;
    startRouteParticles();
    startLogoParticles();
    await loadConversations();
    const pre = new URLSearchParams(location.search).get('user');
    if(pre){ await ensureConversation(pre); openConversation(pre); }
  } catch (e){ console.error('Init error', e); }
}

async function loadConversations(){
  const list = $('#parents-list');
  list.innerHTML = '<li>Chargement…</li>';
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
    const { data: profs } = await supabase.from('profiles').select('id,full_name,avatar_url').in('id', ids);
    profiles = (profs||[]).map(p=>({ ...p, id:idStr(p.id) }));
  }
  parents = profiles;
  // Some conversations may involve users without a profile entry.
  // Ensure those ids still appear in the list with a placeholder profile
  ids.forEach(id=>{
    if(!parents.some(p=>p.id===id)) parents.push({ id, full_name:'Parent', avatar_url:null });
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
    const snippet = last? escapeHTML(last.content.slice(0,50)) : 'Aucun message';
    const time = last? new Date(last.created_at).toLocaleString() : '';
    li.innerHTML = `
      <img src="${p.avatar_url||'/logo.png'}" alt="" class="avatar" width="32" height="32">
      <div class="meta">
        <div class="name">${escapeHTML(p.full_name||'Parent')}</div>
        <div class="last-msg">${snippet}${time?`<br><time>${time}</time>`:''}</div>
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
  let profile = { id, full_name:'Parent', avatar_url:null };
  const { data } = await supabase.from('profiles').select('id,full_name,avatar_url').eq('id', id).single();
  if(data) profile = { ...data, id:idStr(data.id) };
  parents.push(profile);
  lastMessages.set(id, null);
  renderParentList();
}

async function deleteConversation(otherId){
  const id = idStr(otherId);
  if(!confirm('Supprimer cette conversation ?')) return;
  try {
    const r = await fetch('/api/messages/delete-conversation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`
      },
      body: JSON.stringify({ otherId: id })
    });
    if(!r.ok){
      let info = '';
      try { const j = await r.json(); info = j?.error ? `${j.error}${j.details?` - ${j.details}`:''}` : (await r.text()); } catch{}
      throw new Error(`HTTP ${r.status}${info?`: ${info}`:''}`);
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
    if(messagesChannel) await supabase.removeChannel(messagesChannel);
    messagesChannel=null;
  }
  renderParentList();
}

async function openConversation(otherId){
  const id = idStr(otherId);
  await ensureConversation(id);
  activeParent = parents.find(p=>p.id===id);
  $$('#parents-list .parent-item').forEach(li=>li.classList.toggle('active', li.dataset.id===id));
  currentMessages = [];
  $('#conversation').innerHTML='';
  await fetchConversation(id);
  setupMessageSubscription(id);
}

async function fetchConversation(otherId){
  const id = idStr(otherId);
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
    line.innerHTML = `\n      <div class="avatar">${mine? 'Moi' : (activeParent?.full_name?.[0]||'')}</div>\n      <div class="message"><div class="bubble ${mine?'user':'assistant'}">${escapeHTML(m.content)}</div></div>`;
    wrap.appendChild(line);
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
  const id = idStr(otherId);
  if(messagesChannel) supabase.removeChannel(messagesChannel);
  messagesChannel = supabase
    .channel('room-'+id)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
      const m = payload.new;
      const sender = idStr(m.sender_id);
      const receiver = idStr(m.receiver_id);
      if((sender===user.id && receiver===id) || (sender===id && receiver===user.id)){
        const msg = { ...m, sender_id: sender, receiver_id: receiver };
        currentMessages.push(msg); renderMessages();
        lastMessages.set(id, msg); renderParentList();
      }
    })
    .subscribe();
}

init();
