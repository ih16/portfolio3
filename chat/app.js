'use strict';
const $ = id => document.getElementById(id);
const page = document.body.dataset.page;
const owner = page === 'owner';
const sessionKey = 'ishtiaq-chat-session-v1';
let session, selected, sequence = 0, pollTimer, polling = false, sending = false, generation = 0;
let idlePolls = 0, lastInboxLoad = 0, presenceTimer;
let pendingMessage, registration, pushSubscription, inboxPages = 1, signedIn = false, inboxItems = [];
// Keep the shell inside the visible area when a mobile keyboard pans or resizes it.
let stickToBottom = true, viewportFrame;
function jumpToLatest() {
  const box = $('messages');
  if (!box) return;
  box.scrollTop = box.scrollHeight; stickToBottom = true;
  display('latest', false);
}
function sizeComposer() {
  const input = $('message');
  if (!input) return;
  input.style.height = '44px';
  input.style.height = `${Math.min(input.scrollHeight, 144, innerHeight * .25)}px`;
  $('send').disabled = sending || !selected || (!owner && selected.blocked) || !input.value.trim();
}
function sizeChat() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const view = window.visualViewport;
    if (view && view.scale !== 1) return;
    document.documentElement.style.setProperty('--chat-height', `${view?.height ?? innerHeight}px`);
    document.documentElement.style.setProperty('--chat-top', `${view?.offsetTop ?? 0}px`);
    document.body.classList.toggle('chat-keyboard', !!view && innerHeight - view.height > 120);
    sizeComposer();
    if (stickToBottom) jumpToLatest();
  });
}
window.visualViewport?.addEventListener('resize', sizeChat);
window.visualViewport?.addEventListener('scroll', sizeChat);
window.addEventListener('resize', sizeChat);
const display = (id, visible) => { if ($(id)) $(id).hidden = !visible; };
const status = (id, text) => {
  if (!$(id)) return;
  $(id).textContent = text;
  if (id === 'connection') $(id).classList.toggle('chat-online', text === 'Online');
  if (id === 'connection' && $('thread-connection')) $('thread-connection').textContent = text;
  if (id === 'send-status') $(id).dataset.error = 'false';
};
$('messages')?.addEventListener('scroll', () => {
  const box = $('messages');
  stickToBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  display('latest', !stickToBottom);
}, { passive: true });
$('latest')?.addEventListener('click', jumpToLatest);
if ($('messages')) new ResizeObserver(() => {
  if (stickToBottom) jumpToLatest();
}).observe($('messages'));
$('message')?.addEventListener('input', sizeComposer);
// Sending with a touch must not dismiss an already-open keyboard.
$('send')?.addEventListener('pointerdown', event => {
  if (document.activeElement === $('message')) event.preventDefault();
});
document.addEventListener('click', event => {
  document.querySelectorAll('.chat-menu[open]').forEach(menu => {
    if (!menu.contains(event.target) || event.target.closest('button, a')) menu.open = false;
  });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.chat-menu[open]').forEach(menu => { menu.open = false; (menu.closest('.chat-conversation-row')?.querySelector('.chat-conversation') || menu.querySelector('summary')).focus(); });
});
sizeChat();

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
  if (!owner && error.status === 401) {
    session = null;
    try { localStorage.removeItem(sessionKey); } catch {}
    showEntry(); status('entry-status', '');
    return;
  }
  status(target, navigator.onLine ? error.message : 'You’re offline. Your draft is still here. Reconnect to send.');
  if (target === 'send-status') $('send-status').dataset.error = 'true';
}
let toastTimer;
function dismissToast() {
  clearTimeout(toastTimer);
  display('inbox-toast', false);
  status('toast-message', '');
}
function showToast(message) {
  clearTimeout(toastTimer);
  display('inbox-toast', true);
  status('toast-message', message);
  toastTimer = setTimeout(dismissToast, 3500);
}
$('toast-dismiss')?.addEventListener('click', dismissToast);
function showEntry() {
  dismissToast();
  $('visitor-dialog')?.close();
  clearTimeout(presenceTimer);
  lastInboxLoad = 0; document.body.classList.remove('chat-thread-open');
  signedIn = false;
  document.body.classList.remove('chat-active');
  generation++;
  clearTimeout(pollTimer);
  display('entry', true); display('workspace', false); display('owner-actions', false);
  status('connection', '');
}
function showWorkspace() {
  signedIn = true;
  document.body.classList.add('chat-active');
  display('entry', false); display('workspace', true); display('owner-actions', owner); display('reset', !owner);
}
function setThread(item) {
  selected = item;
  status('avatar', owner ? item.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() : 'IH');
  sizeComposer();
  status('thread-title', owner ? item.name : 'Chat with Ishtiaq');
  display('thread', !owner || document.body.classList.contains('chat-thread-open')); display('block', owner);
  status('block', item.blocked ? 'Unblock visitor' : 'Block visitor');
  if (!owner) {
    $('message').disabled = item.blocked;
    sizeComposer();
    if (item.blocked) { status('send-status', 'This conversation is closed.'); $('send-status').dataset.error = 'true'; }
  }
}
function appendMessages(messages) {
  const box = $('messages');
  const atBottom = stickToBottom;
  const first = sequence === 0;
  for (const message of messages) {
    if (message.sequence <= sequence) continue;
    display('empty', false);
    const date = new Date(message.at);
    const day = date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    if (box.lastElementChild?.dataset.day !== day) {
      const divider = document.createElement('div'); divider.className = 'chat-day'; divider.textContent = day; divider.dataset.day = day; box.append(divider);
    }
    const article = document.createElement('article');
    article.dataset.day = day;
    article.className = 'chat-message' + ((owner ? message.sender === 'owner' : message.sender === 'visitor') ? ' chat-message--mine' : '');
    article.setAttribute('aria-label', message.sender === 'owner' ? 'Ishtiaq' : selected.name);
    const text = document.createElement('p'); text.textContent = message.text;
    const time = document.createElement('time'); time.dateTime = new Date(message.at).toISOString();
    time.textContent = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    time.title = date.toLocaleString();
    article.append(text, time); box.append(article);
    sequence = message.sequence;
  }
  if (atBottom || first) jumpToLatest();
  else display('latest', true);
}
function showPresence(until) {
  clearTimeout(presenceTimer);
  const remaining = until - Date.now();
  status('connection', remaining > 0 ? 'Online' : '');
  if (remaining > 0) presenceTimer = setTimeout(() => {
    if ($('connection').textContent === 'Online') status('connection', '');
  }, remaining);
}
async function loadMessages() {
  if (owner && (!selected || !document.body.classList.contains('chat-thread-open'))) return;
  const current = generation;
  let result;
  do {
    result = await api('messages', undefined, { after: String(sequence), ...(owner ? { conversation: selected.id } : {}) });
    if (current !== generation) return;
    if (!owner) showPresence(result.onlineUntil);
    setThread(result.conversation);
    appendMessages(result.messages);
  } while (result.more);
  if (owner) {
    inboxItems = inboxItems.map(item => item.id === selected.id ? { ...selected } : item);
    renderInbox(inboxItems);
  }
  if (owner && sequence && result.conversation.unread && document.visibilityState === 'visible') {
    await api('read', { conversation: selected.id, sequence });
    if (current !== generation) return;
    selected.unread = false; selected.unreadCount = 0;
    inboxItems = inboxItems.map(item => item.id === selected.id ? { ...selected, unread: false, unreadCount: 0 } : item);
    renderInbox(inboxItems);
  }
}
function renderInbox(items) {
  items = [...items].sort((a, b) => b.updated - a.updated);
  inboxItems = items;
  const list = $('conversations');
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
  const openMenu = list.querySelector('details[open]')?.dataset.id;
  list.replaceChildren();
  display('inbox-empty', items.length === 0);
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'chat-conversation-row'; row.classList.toggle('has-unread', item.unreadCount > 0);
    const button = document.createElement('button'); button.className = 'chat-conversation'; button.dataset.id = item.id; button.dataset.focus = item.id;
    button.setAttribute('aria-current', String(selected?.id === item.id));
    const heading = document.createElement('span'); heading.className = 'chat-conversation-heading';
    const name = document.createElement('span'); name.className = 'chat-conversation-name'; name.textContent = item.name;
    const date = new Date(item.updated);
    const time = document.createElement('time'); time.dateTime = date.toISOString(); time.title = date.toLocaleString();
    time.textContent = date.toDateString() === new Date().toDateString()
      ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
    heading.append(name, time);
    const detail = document.createElement('span'); detail.className = 'chat-conversation-detail';
    const preview = document.createElement('span'); preview.className = 'chat-conversation-preview';
    preview.textContent = (item.blocked ? 'Blocked · ' : '') + (item.latestSender === 'owner' ? 'You: ' : '') + (item.latestText || 'No messages yet');
    detail.append(preview);
    if (item.unreadCount > 0) {
      const badge = document.createElement('strong'); badge.className = 'chat-unread-count'; badge.textContent = String(item.unreadCount);
      badge.setAttribute('aria-label', `${item.unreadCount} unread ${item.unreadCount === 1 ? 'message' : 'messages'}`); detail.append(badge);
    }
    const avatar = document.createElement('button'); avatar.type = 'button'; avatar.className = 'chat-avatar chat-avatar-button'; avatar.dataset.focus = `visitor:${item.id}`; avatar.setAttribute('aria-label', `View details for ${item.name}`);
    avatar.addEventListener('click', () => showVisitor(item));
    avatar.textContent = item.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
    const copy = document.createElement('span'); copy.className = 'chat-conversation-copy'; copy.append(heading, detail);
    button.append(copy);
    button.addEventListener('click', () => chooseConversation(item));
    const menu = document.createElement('details'); menu.className = 'chat-menu'; menu.dataset.id = item.id; menu.open = openMenu === item.id;
    const trigger = document.createElement('summary'); trigger.textContent = '⋯'; trigger.setAttribute('aria-label', `Options for ${item.name}`); trigger.dataset.focus = `menu:${item.id}`;
    const content = document.createElement('div'); content.className = 'chat-menu-content';
    const remove = document.createElement('button'); remove.className = 'chat-menu-item'; remove.textContent = 'Delete conversation'; remove.dataset.focus = `delete:${item.id}`;
    remove.addEventListener('click', () => deleteThread(item, remove));
    content.append(remove); menu.append(trigger, content); row.append(avatar, button, menu); list.append(row);
    let pressTimer, pressX, pressY, suppressClick = false;
    const cancelPress = () => clearTimeout(pressTimer);
    const openContext = () => {
      document.querySelectorAll('.chat-menu[open]').forEach(other => { if (other !== menu) other.open = false; });
      menu.open = true; remove.focus({ preventScroll: true });
    };
    row.addEventListener('contextmenu', event => { event.preventDefault(); cancelPress(); openContext(); });
    row.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openContext(); }
    });
    row.addEventListener('pointerdown', event => {
      cancelPress(); suppressClick = false;
      if (event.pointerType === 'mouse' || !event.isPrimary || menu.contains(event.target)) return;
      pressX = event.clientX; pressY = event.clientY;
      pressTimer = setTimeout(() => {
        if (!row.isConnected) return;
        suppressClick = true; openContext();
      }, 550);
    });
    row.addEventListener('pointermove', event => {
      if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 10) cancelPress();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) row.addEventListener(type, cancelPress);
    // A completed long press must not also navigate into the conversation.
    row.addEventListener('click', event => {
      if (suppressClick && !menu.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
    }, true);
    for (const control of [avatar, button, trigger, remove]) if (focused === control.dataset.focus) control.focus({ preventScroll: true });
  }
}
let visitorRequest = 0;
async function showVisitor(item) {
  const current = ++visitorRequest;
  const dialog = $('visitor-dialog');
  status('visitor-title', item.name);
  status('visitor-status', 'Loading visitor details…');
  $('visitor-details').replaceChildren();
  dialog.showModal();
  try {
    const result = await api('visitor', undefined, { conversation: item.id });
    if (current !== visitorRequest || !dialog.open) return;
    status('visitor-status', result.info ? 'Latest recorded connection' : 'No connection details recorded yet. They will be available after the visitor sends another message.');
    const info = result.info || {};
    const fields = [
      ['IP address', info.ip],
      ['Approximate location', [info.city, info.region, info.country].filter(Boolean).join(', ')],
      ['Browser information', info.userAgent],
      ['Chat started', result.created ? new Date(result.created).toLocaleString() : ''],
      ['Connection recorded', info.at ? new Date(info.at).toLocaleString() : '']
    ];
    for (const [label, value] of fields) {
      const term = document.createElement('dt'); term.textContent = label;
      const detail = document.createElement('dd'); detail.textContent = value || 'Not available';
      $('visitor-details').append(term, detail);
    }
  } catch (error) { if (current === visitorRequest && dialog.open) fail(error, 'visitor-status'); }
}
$('visitor-close')?.addEventListener('click', () => $('visitor-dialog').close());
$('visitor-dialog')?.addEventListener('close', () => { visitorRequest++; $('visitor-details').replaceChildren(); });
if (owner) $('avatar')?.addEventListener('click', () => { if (selected) showVisitor(selected); });
async function chooseConversation(item) {
  if (!item) return;
  if (selected?.id === item.id) { openThread(); try { await loadMessages(); } catch (error) { fail(error); } return; }
  if ($('message').value.trim() && !confirm('Discard the draft for this conversation?')) {
    return;
  }
  idlePolls = 0;
  generation++; sequence = 0; pendingMessage = null; $('message').value = ''; status('send-status', '');
  $('messages').querySelectorAll('article, .chat-day').forEach(node => node.remove()); display('empty', true);
  setThread(item); openThread(); renderInbox(inboxItems);
  try { await loadMessages(); } catch (error) { fail(error); }
}
function openThread() {
  document.body.classList.add('chat-thread-open');
  display('thread', true);
  $('back-to-inbox').focus({ preventScroll: true });
  sizeChat();
}
function backToInbox() {
  // Keep the draft and loaded messages when returning to the list.
  generation++;
  $('message').blur();
  document.body.classList.remove('chat-thread-open');
  display('thread', false);
  document.querySelectorAll('.chat-menu[open]').forEach(menu => { menu.open = false; });
  const row = [...$('conversations').querySelectorAll('.chat-conversation')].find(button => button.dataset.id === selected?.id);
  row?.focus({ preventScroll: true });
}
$('back-to-inbox')?.addEventListener('click', backToInbox);
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
  lastInboxLoad = Date.now();
  showWorkspace();
  display('more', result.more); renderInbox(items);
}
async function poll(force = false) {
  clearTimeout(pollTimer);
  if (polling || document.visibilityState === 'hidden' || !navigator.onLine || !signedIn) return;
  polling = true;
  if ($('refresh-inbox')) {
    $('refresh-inbox').disabled = true;
    $('refresh-inbox').setAttribute('aria-busy', 'true');
  }
  if (force) { lastInboxLoad = 0; idlePolls = 0; status('connection', 'Refreshing…'); }
  try {
    const before = sequence;
    if (owner && Date.now() - lastInboxLoad >= 60000) await loadInbox();
    await loadMessages();
    idlePolls = sequence === before ? idlePolls + 1 : 0;
    if (owner) {
      status('connection', '');
      if (force) showToast('Inbox refreshed');
    }
  } catch (error) {
    if (error.status === 401 || (!owner && error.status === 404)) {
      showEntry();
      if (!owner) { session = null; try { localStorage.removeItem(sessionKey); } catch {} }
      if (owner) fail(error, 'entry-status'); else status('entry-status', '');
    } else if (owner && error.status === 404) {
      clearThread(); lastInboxLoad = 0;
      try { await loadInbox(); } catch (refreshError) { fail(refreshError); }
    } else { idlePolls++; fail(error); }
  } finally {
    polling = false;
    if ($('refresh-inbox')) {
      $('refresh-inbox').disabled = false;
      $('refresh-inbox').setAttribute('aria-busy', 'false');
    }
    if (signedIn && document.visibilityState !== 'hidden') pollTimer = setTimeout(poll, Math.min(60000, 10000 * (idlePolls + 1)));
  }
}

$('refresh-inbox')?.addEventListener('click', () => {
  if (!navigator.onLine) { status('connection', 'You’re offline. Reconnect to refresh.'); return; }
  poll(true);
});

$('join')?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try {
    // Check persistence before creating a session the visitor cannot resume.
    localStorage.setItem('chat-storage-check', '1'); localStorage.removeItem('chat-storage-check');
    session = await api('session', { name: $('name').value.trim() });
    localStorage.setItem(sessionKey, JSON.stringify(session));
    selected = null; sequence = 0; generation++;
    $('messages').querySelectorAll('article, .chat-day').forEach(node => node.remove()); display('empty', true);
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
  idlePolls = 0; lastInboxLoad = 0;
  sending = true; $('send').disabled = true; $('compose').setAttribute('aria-busy', 'true'); status('send-status', 'Sending…');
  // Keep the ID after a timeout so an acknowledged-but-lost response cannot
  // create a duplicate when the visitor presses Send again.
  if (!pendingMessage || pendingMessage.text !== text || pendingMessage.conversation !== selected.id)
    pendingMessage = { id: crypto.randomUUID(), text, conversation: selected.id };
  const current = generation;
  try {
    await api('send', pendingMessage);
    if (current !== generation) return;
    if ($('message').value.trim() === text) $('message').value = '';
    pendingMessage = null; sizeComposer(); stickToBottom = true; status('send-status', 'Sent.');
    await loadMessages();
    clearTimeout(pollTimer); pollTimer = setTimeout(poll, 10000);
  } catch (error) { if (current === generation) fail(error, 'send-status'); }
  finally { sending = false; $('compose').setAttribute('aria-busy', 'false'); sizeComposer(); }
});
$('message')?.addEventListener('keydown', event => {
  if (!event.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('compose').requestSubmit(); }
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
function clearThread() {
  document.body.classList.remove('chat-thread-open');
  generation++; selected = null; sequence = 0; pendingMessage = null;
  $('messages').querySelectorAll('article, .chat-day').forEach(node => node.remove());
  $('message').value = ''; status('send-status', '');
  display('thread', false); display('empty', true); display('latest', false);
  stickToBottom = true;
}
async function deleteThread(item, button) {
  if (!item || sending || !confirm(`Permanently delete the conversation with ${item.name}? All messages will be removed for both of you. This cannot be undone.`)) return;
  const id = item.id;
  button.disabled = true;
  try {
    await api('delete', { conversation: id });
    if (selected?.id === id) clearThread();
    lastInboxLoad = 0; await loadInbox();
  } catch (error) { fail(error); }
  finally { button.disabled = false; }
}
$('delete-thread')?.addEventListener('click', () => deleteThread(selected, $('delete-thread')));
$('logout')?.addEventListener('click', async () => {
  try {
    // Remove this device before dropping the credential needed to unregister it.
    if (pushSubscription) {
      await api('unsubscribe', { endpoint: pushSubscription.endpoint });
      await pushSubscription.unsubscribe(); pushSubscription = null;
    }
    await api('logout', {}); lastInboxLoad = 0; selected = null; sequence = 0;
    $('messages').querySelectorAll('article, .chat-day').forEach(node => node.remove()); $('message').value = ''; showEntry();
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
function resumePolling() { idlePolls = 0; lastInboxLoad = 0; poll(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumePolling(); else clearTimeout(pollTimer); });
window.addEventListener('online', resumePolling);
window.addEventListener('offline', () => { clearTimeout(pollTimer); status('connection', 'You’re offline. Reconnect to send and receive messages.'); });

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
