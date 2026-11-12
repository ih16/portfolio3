'use strict';
const $ = id => document.getElementById(id);
const page = document.body.dataset.page;
const owner = page === 'owner';
const sessionKey = 'ishtiaq-chat-session-v1';
let session, selected, sequence = 0, pollTimer, polling = false, sending = false, generation = 0;
let pendingMessage, registration, pushSubscription, inboxPages = 1, signedIn = false, inboxItems = [], inboxHasMore = false;
// The visual viewport follows the on-screen keyboard on iOS as well as Android.
function sizeChat() {
  if (!window.visualViewport || window.visualViewport.scale !== 1) return;
  document.documentElement.style.setProperty('--chat-height', `${window.visualViewport.height}px`);
}
window.visualViewport?.addEventListener('resize', sizeChat);
window.addEventListener('resize', sizeChat);
sizeChat();
const display = (id, visible) => { if ($(id)) $(id).hidden = !visible; };
const status = (id, text) => { if ($(id)) $(id).textContent = text; };

async function api(action, data, params = {}) {
  const query = new URLSearchParams({ action, ...params });
  if (owner) query.set('scope', 'owner');
  const headers = {};
  if (!owner && session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/chat?${query}`, {
    method: data === undefined ? 'GET' : 'POST', headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(25000)
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Chat is unavailable. Please try again.'); }
  if (!response.ok) { const error = new Error(result.error || 'Request failed.'); error.status = response.status; throw error; }
  return result;
}
function fail(error, target = 'connection') {
  status(target, navigator.onLine ? error.message : 'You’re offline. Your draft is still here. Reconnect to send.');
}
function showEntry() {
  signedIn = false;
  document.body.classList.remove('chat-active');
  display('mobile-conversations', false);
  generation++;
  clearTimeout(pollTimer);
  display('entry', true); display('workspace', false); display('owner-actions', false);
  status('connection', '');
}
function showWorkspace() {
  signedIn = true;
  document.body.classList.add('chat-active');
  display('mobile-conversations', owner);
  display('entry', false); display('workspace', true); display('owner-actions', owner); display('reset', !owner);
}
function setThread(item) {
  selected = item;
  status('thread-title', owner ? item.name : 'Chat with Ishtiaq');
  display('thread', true); display('block', owner);
  status('block', item.blocked ? 'Unblock visitor' : 'Block visitor');
  if (!owner) {
    $('message').disabled = item.blocked;
    $('send').disabled = item.blocked;
    if (item.blocked) status('send-status', 'This conversation is closed.');
  }
}
function appendMessages(messages) {
  const box = $('messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const first = sequence === 0;
  for (const message of messages) {
    if (message.sequence <= sequence) continue;
    display('empty', false);
    const article = document.createElement('article');
    article.className = 'chat-message' + ((owner ? message.sender === 'owner' : message.sender === 'visitor') ? ' chat-message--mine' : '');
    article.setAttribute('aria-label', message.sender === 'owner' ? 'Ishtiaq' : selected.name);
    const text = document.createElement('p'); text.textContent = message.text;
    const time = document.createElement('time'); time.dateTime = new Date(message.at).toISOString();
    time.textContent = new Date(message.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    article.append(text, time); box.append(article);
    sequence = message.sequence;
  }
  if (atBottom || first) box.scrollTop = box.scrollHeight;
}
async function loadMessages() {
  if (owner && !selected) return;
  const current = generation;
  let result;
  do {
    result = await api('messages', undefined, { after: String(sequence), ...(owner ? { conversation: selected.id } : {}) });
    if (current !== generation) return;
    setThread(result.conversation);
    appendMessages(result.messages);
  } while (result.more);
  if (owner && sequence && document.visibilityState === 'visible') {
    await api('read', { conversation: selected.id, sequence });
  }
}
function renderInbox(items) {
  inboxItems = items;
  const picker = $('conversation-picker');
  picker.replaceChildren();
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = item.name + (item.unread ? ' · Unread' : '') + (item.blocked ? ' · Blocked' : '');
    picker.append(option);
  }
  if (inboxHasMore) {
    const more = document.createElement('option'); more.value = '__more__'; more.textContent = 'Load more conversations…'; picker.append(more);
  }
  if (selected) picker.value = selected.id;
  const list = $('conversations');
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  list.replaceChildren();
  display('inbox-empty', items.length === 0);
  for (const item of items) {
    const button = document.createElement('button'); button.className = 'chat-conversation'; button.dataset.id = item.id;
    button.setAttribute('aria-current', String(selected?.id === item.id));
    const name = document.createElement('span'); name.textContent = item.name; button.append(name);
    if (item.unread) { const badge = document.createElement('strong'); badge.textContent = 'Unread'; button.append(badge); }
    const time = document.createElement('small'); time.textContent = (item.blocked ? 'Blocked · ' : '') + new Date(item.updated).toLocaleDateString(); button.append(time);
    button.addEventListener('click', () => chooseConversation(item));
    list.append(button);
    if (focused === item.id) button.focus();
  }
}
async function chooseConversation(item) {
  if (!item || selected?.id === item.id) return;
  if ($('message').value.trim() && !confirm('Discard the draft for this conversation?')) {
    $('conversation-picker').value = selected.id; return;
  }
  generation++; sequence = 0; pendingMessage = null; $('message').value = ''; status('send-status', '');
  $('messages').querySelectorAll('article').forEach(node => node.remove()); display('empty', true);
  setThread(item); renderInbox(inboxItems);
  try { await loadMessages(); } catch (error) { fail(error); }
}
$('conversation-picker')?.addEventListener('change', async event => {
  if (event.target.value === '__more__') {
    inboxPages++; try { await loadInbox(); } catch (error) { fail(error); } return;
  }
  chooseConversation(inboxItems.find(item => item.id === event.target.value));
});
async function loadInbox() {
  const current = generation;
  const items = [];
  let result;
  for (let p = 0; p < inboxPages; p++) {
    result = await api('inbox', undefined, { offset: String(p * 50) });
    items.push(...result.conversations);
    if (!result.more) break;
  }
  if (current !== generation) return;
  showWorkspace();
  inboxHasMore = result.more;
  display('more', result.more); renderInbox(items);
  if (!selected && items.length) { setThread(items[0]); renderInbox(items); }
}
async function poll() {
  clearTimeout(pollTimer);
  if (polling || document.visibilityState === 'hidden' || !signedIn) return;
  polling = true;
  try {
    if (owner) await loadInbox();
    await loadMessages();
    status('connection', 'Connected');
  } catch (error) {
    if (error.status === 401 || (!owner && error.status === 404)) {
      showEntry();
      if (!owner) { session = null; try { localStorage.removeItem(sessionKey); } catch {} }
      fail(error, 'entry-status');
    } else fail(error);
  } finally {
    polling = false;
    if (signedIn && document.visibilityState !== 'hidden') pollTimer = setTimeout(poll, 10000);
  }
}

$('join')?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try {
    // Check persistence before creating a session the visitor cannot resume.
    localStorage.setItem('chat-storage-check', '1'); localStorage.removeItem('chat-storage-check');
    session = await api('session', { name: $('name').value.trim() });
    localStorage.setItem(sessionKey, JSON.stringify(session));
    selected = null; sequence = 0; generation++;
    $('messages').querySelectorAll('article').forEach(node => node.remove()); display('empty', true);
    pendingMessage = null; $('message').value = ''; status('send-status', '');
    showWorkspace(); await poll();
  } catch (error) { fail(error.name === 'SecurityError' || error.name === 'QuotaExceededError' ? new Error('Allow browser storage to remember your chat, or contact me by email.') : error, 'entry-status'); }
  finally { button.disabled = false; }
});
$('login')?.addEventListener('submit', async event => {
  event.preventDefault(); event.submitter.disabled = true;
  try {
    await api('login', { password: $('password').value }); $('password').value = '';
    showWorkspace(); await poll(); if (await workerReady) await syncNotifications();
  } catch (error) { fail(error, 'entry-status'); }
  finally { event.submitter.disabled = false; }
});
$('compose')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !selected) return;
  const text = $('message').value.trim();
  if (!text) return;
  sending = true; $('send').disabled = true; status('send-status', 'Sending…');
  // Keep the ID after a timeout so an acknowledged-but-lost response cannot
  // create a duplicate when the visitor presses Send again.
  if (!pendingMessage || pendingMessage.text !== text || pendingMessage.conversation !== selected.id)
    pendingMessage = { id: crypto.randomUUID(), text, conversation: selected.id };
  const current = generation;
  try {
    await api('send', pendingMessage);
    if (current !== generation) return;
    if ($('message').value.trim() === text) $('message').value = '';
    pendingMessage = null; status('send-status', 'Sent.');
    await loadMessages();
  } catch (error) { fail(error, 'send-status'); }
  finally { sending = false; $('send').disabled = !owner && selected?.blocked; }
});
$('message')?.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('compose').requestSubmit(); }
});
$('reset')?.addEventListener('click', () => {
  if (!confirm('Start a new chat? You will lose access to this conversation in this browser.')) return;
  try { localStorage.removeItem(sessionKey); session = null; selected = null; showEntry(); display('reset', false); }
  catch (error) { fail(error); }
});
$('more')?.addEventListener('click', async () => { inboxPages++; try { await loadInbox(); } catch (error) { fail(error); } });
$('block')?.addEventListener('click', async () => {
  $('block').disabled = true;
  try { await api('block', { conversation: selected.id, blocked: !selected.blocked }); selected.blocked = !selected.blocked; setThread(selected); await loadInbox(); }
  catch (error) { fail(error); } finally { $('block').disabled = false; }
});
$('logout')?.addEventListener('click', async () => {
  try {
    // Remove this device before dropping the credential needed to unregister it.
    if (pushSubscription) {
      await api('unsubscribe', { endpoint: pushSubscription.endpoint });
      await pushSubscription.unsubscribe(); pushSubscription = null;
    }
    await api('logout', {}); selected = null; sequence = 0;
    $('messages').querySelectorAll('article').forEach(node => node.remove()); $('message').value = ''; showEntry();
  } catch (error) { fail(error); }
});

async function setupWorker() {
  if (!('serviceWorker' in navigator)) return;
  registration = await navigator.serviceWorker.register('/chat/sw.js', { scope: '/chat/' });
  if (owner) {
    registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => {
      setTimeout(() => reject(new Error('App installation is still pending. Reload to try notifications again.')), 8000);
    })]);
  }
}
async function syncNotifications() {
  if (!registration || !('PushManager' in window) || !('Notification' in window)) {
    status('notification-status', 'Notifications aren’t available here. On iPhone or iPad, install and open the app from your home screen.');
    display('notifications', false); return;
  }
  pushSubscription = await registration.pushManager.getSubscription();
  if (pushSubscription) await api('subscribe', { endpoint: pushSubscription.endpoint });
  status('notifications', pushSubscription ? 'Disable notifications' : 'Enable notifications');
  status('notification-status', pushSubscription ? 'Notifications are enabled on this device.' : 'Enable notifications to hear about new messages when the app is closed.');
}
$('notifications')?.addEventListener('click', async () => {
  $('notifications').disabled = true;
  try {
    if (!registration) throw new Error('The app is still getting ready. Try again in a moment.');
    if (pushSubscription) {
      await api('unsubscribe', { endpoint: pushSubscription.endpoint });
      await pushSubscription.unsubscribe(); pushSubscription = null;
    } else {
      // Ask directly from the tap; iOS requires a user gesture for permission.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser or device settings, then try again.');
      const { publicKey } = await api('config');
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
      pushSubscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      try { await api('subscribe', { endpoint: pushSubscription.endpoint }); }
      catch (error) { await pushSubscription.unsubscribe(); pushSubscription = null; throw error; }
    }
    await syncNotifications();
  } catch (error) { fail(error, 'notification-status'); }
  finally { $('notifications').disabled = false; }
});
let installPrompt;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; display('install', true);
});
$('install')?.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  const result = await installPrompt.userChoice;
  installPrompt = null; display('install', false);
  status('install-status', result.outcome === 'accepted' ? 'Installation requested. Open the app to sign in.' : 'You can install later from your browser menu.');
});
window.addEventListener('appinstalled', () => { display('install', false); status('install-status', 'App installed. Open your inbox to enable notifications.'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); else clearTimeout(pollTimer); });
window.addEventListener('online', poll);
window.addEventListener('offline', () => status('connection', 'You’re offline. Reconnect to send and receive messages.'));

// Chat does not wait for installation: a failed service worker must never block
// the visitor form or the owner's sign-in.
const workerReady = setupWorker().then(() => true).catch(() => {
  status('notification-status', 'App installation is unavailable. Chat still works while this page is open.');
  display('notifications', false);
  return false;
});
(async () => {
  if (page === 'install') {
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      display('install-help', false); status('install-status', 'You’re already using the installed app.');
    }
    return;
  }
  if (owner) {
    signedIn = true;
    await poll();
    if (signedIn && await workerReady) { try { await syncNotifications(); } catch (error) { fail(error, 'notification-status'); } }
  } else {
    try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch {}
    if (session?.token) { showWorkspace(); await poll(); } else showEntry();
  }
})();
