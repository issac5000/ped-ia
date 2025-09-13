document.body.classList.remove('no-js');
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

let supabase, session, user;
let parents = [];
let activeParent = null;
let currentMessages = [];
let messagesChannel = null;
let notifChannel = null;
let notifications = [];

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
    session = s; user = s.user;
    await loadParents();
    await loadNotifications();
    setupNotifButton();
    setupSubscriptions();
  } catch (e){ console.error('Init error', e); }
}

async function loadParents(){
  const list = $('#parents-list');
  list.innerHTML = '<li>Chargement…</li>';
  const { data, error } = await supabase.from('profiles').select('id,full_name,avatar_url').neq('id', user.id);
  if(error){ list.innerHTML = '<li>Erreur.</li>'; return; }
  parents = data || [];
  list.innerHTML='';
  parents.forEach(p=>{
    const li = document.createElement('li');
    li.className='parent-item';
    li.dataset.id = p.id;
    li.innerHTML = `<img src="${p.avatar_url||'/logo.png'}" alt="" class="avatar" width="32" height="32"> <span>${p.full_name||'Parent'}</span>`;
    li.addEventListener('click', ()=>openConversation(p.id));
    list.appendChild(li);
  });
}

async function openConversation(otherId){
  activeParent = parents.find(p=>p.id===otherId);
  $$('#parents-list .parent-item').forEach(li=>li.classList.toggle('active', li.dataset.id===otherId));
  currentMessages = [];
  $('#conversation').innerHTML='';
  await fetchConversation(otherId);
  setupMessageSubscription(otherId);
  await markNotificationsRead(otherId);
}

async function fetchConversation(otherId){
  const { data, error } = await supabase
    .from('messages')
    .select('id,sender_id,receiver_id,content,created_at')
    .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${user.id})`)
    .order('created_at', { ascending:true });
  if(error){ console.error('load messages', error); return; }
  currentMessages = data || [];
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
    .insert({ sender_id:user.id, receiver_id:activeParent.id, content })
    .select()
    .single();
  if(error){ console.error('send message', error); return; }
  currentMessages.push(data);
  renderMessages();
  await supabase.from('notifications').insert({ user_id:activeParent.id, type:'message', reference_id:data.id, is_read:false });
});

function setupMessageSubscription(otherId){
  if(messagesChannel) supabase.removeChannel(messagesChannel);
  messagesChannel = supabase
    .channel('room-'+otherId)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
      const m = payload.new;
      if((m.sender_id===user.id && m.receiver_id===otherId) || (m.sender_id===otherId && m.receiver_id===user.id)){
        currentMessages.push(m); renderMessages();
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
  const ids = currentMessages.filter(m=>m.sender_id===otherId).map(m=>m.id);
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
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:`user_id=eq.${user.id}` }, loadNotifications)
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'notifications', filter:`user_id=eq.${user.id}` }, loadNotifications)
    .subscribe();
}

init();
