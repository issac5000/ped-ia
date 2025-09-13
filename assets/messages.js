document.body.classList.remove('no-js');
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

let supabase, session, user;
let parents = [];
let lastMessages = new Map();
let activeParent = null;
let currentMessages = [];
let messagesChannel = null;
let notifChannel = null;
let notifications = [];

// Normalize all user IDs to strings to avoid type mismatches
const idStr = id => String(id);

function escapeHTML(str){
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
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
    await loadConversations();
    const pre = new URLSearchParams(location.search).get('user');
    if(pre){ await ensureConversation(pre); openConversation(pre); }
    await loadNotifications();
    setupNotifButton();
    setupSubscriptions();
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
      </div>`;
    li.addEventListener('click', ()=>openConversation(p.id));
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

async function openConversation(otherId){
  const id = idStr(otherId);
  await ensureConversation(id);
  activeParent = parents.find(p=>p.id===id);
  $$('#parents-list .parent-item').forEach(li=>li.classList.toggle('active', li.dataset.id===id));
  currentMessages = [];
  $('#conversation').innerHTML='';
  await fetchConversation(id);
  setupMessageSubscription(id);
  await markNotificationsRead(id);
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
  await supabase
    .from('notifications')
    .insert({ user_id: idStr(activeParent.id), type: 'message', reference_id: data.id, is_read: false });
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

async function loadNotifications(){
  const { data, error } = await supabase
    .from('notifications')
    .select('id,is_read,reference_id,created_at,messages(id,sender_id,content,profiles(full_name,avatar_url))')
    .eq('user_id', user.id)
    .order('created_at', { ascending:false });
  if(!error){ notifications = data||[]; renderNotifications(); }
}

function renderNotifications(){
  const count = notifications.filter(n=>!n.is_read).length;
  $('#notif-count').textContent = count ? String(count) : '';
  const list = $('#notif-list');
  list.innerHTML='';
  notifications.forEach(n=>{
    const msg = n.messages;
    const sender = msg?.profiles?.full_name || 'Parent';
    const snippet = msg?.content?.slice(0,50) || '';
    const item = document.createElement('div');
    item.className='notif-item '+(n.is_read?'read':'unread');
    item.dataset.id=n.id;
    item.dataset.sender=msg?.sender_id;
    item.innerHTML = `<strong>${sender}</strong><div class="notif-snippet">${escapeHTML(snippet)}</div>`;
    item.addEventListener('click', async ()=>{
      await supabase.from('notifications').update({ is_read:true }).eq('id', n.id);
      await loadNotifications();
      openConversation(item.dataset.sender);
      $('#notif-list').hidden = true;
    });
    list.appendChild(item);
  });
  if(!notifications.length) list.textContent='Aucune notification';
}

function setupNotifButton(){
  $('#notif-btn').addEventListener('click', e=>{
    e.preventDefault();
    const panel = $('#notif-list');
    panel.hidden = !panel.hidden;
  });
}

async function markNotificationsRead(otherId){
  const id = idStr(otherId);
  const ids = currentMessages.filter(m=>m.sender_id===id).map(m=>m.id);
  if(!ids.length) return;
  await supabase
    .from('notifications')
    .update({ is_read:true })
    .eq('user_id', user.id)
    .eq('type','message')
    .in('reference_id', ids);
  loadNotifications();
}

function setupSubscriptions(){
  notifChannel = supabase
    .channel('notif-'+user.id)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:`user_id=eq.${user.id}` }, ()=>{ loadNotifications(); loadConversations(); })
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'notifications', filter:`user_id=eq.${user.id}` }, ()=>{ loadNotifications(); loadConversations(); })
    .subscribe();
}

init();
