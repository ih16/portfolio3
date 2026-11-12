'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const app = readFileSync(require.resolve('../chat/app.js'), 'utf8');
function client(preference, permission = 'granted') {
  const values = new Map(preference ? [['ishtiaq-chat-notifications-v1', preference]] : []);
  const calls = [], nodes = new Map();
  let current = null, prompts = 0, subscriptions = 0;
  const notification = { permission, async requestPermission() { prompts++; return notification.permission; } };
  const manager = {
    async getSubscription() { return current; },
    async subscribe() { subscriptions++; current = { endpoint: 'https://web.push.apple.com/local-test', async unsubscribe() { current = null; } }; return current; }
  };
  const context = vm.createContext({
    window: { PushManager: {}, Notification: notification }, Notification: notification,
    registration: { pushManager: manager }, signedIn: true, pushSubscription: null,
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    $: id => { if (!nodes.has(id)) nodes.set(id, { addEventListener() {} }); return nodes.get(id); },
    api: async (action, body) => { calls.push({ action, body }); return action === 'config' ? { publicKey: 'AQID' } : {}; },
    status: (id, text) => { if (!nodes.has(id)) nodes.set(id, {}); nodes.get(id).text = text; },
    display: (id, visible) => { if (!nodes.has(id)) nodes.set(id, {}); nodes.get(id).visible = visible; },
    fail() {}, showToast() {}, atob, Uint8Array
  });
  vm.runInContext(app.slice(app.indexOf('const notificationPreferenceKey'), app.indexOf('let session,')) + '\n' +
    app.slice(app.indexOf('function notificationControls('), app.indexOf('let installPrompt;')), context);
  return { context, calls, values, nodes, get prompts() { return prompts; }, get subscriptions() { return subscriptions; },
    async sync() { await vm.runInContext('syncNotifications()', context); },
    async toggle(enabled) { vm.runInContext(`changeNotifications(${enabled})`, context); await vm.runInContext('notificationTask', context); },
    disconnect() { current = null; context.pushSubscription = null; } };
}
test('enabled by default: existing permission restores push without a permission prompt', async () => {
  const app = client(); await app.sync();
  assert.equal(app.subscriptions, 1);
  assert.equal(app.prompts, 0);
  assert.ok(app.calls.some(call => call.action === 'subscribe'));
  app.disconnect(); await app.sync();
  assert.equal(app.subscriptions, 2);
});
test('disabled preference survives reload and manual enable/disable is remembered', async () => {
  const app = client('disabled'); await app.sync();
  assert.equal(app.subscriptions, 0);
  await app.toggle(true);
  assert.equal(app.values.get('ishtiaq-chat-notifications-v1'), 'enabled');
  assert.equal(app.subscriptions, 1);
  await app.toggle(false);
  assert.equal(app.values.get('ishtiaq-chat-notifications-v1'), 'disabled');
  assert.ok(app.calls.some(call => call.action === 'unsubscribe'));
  await app.sync(); assert.equal(app.subscriptions, 1);
});
test('first-time permission offers a button, never prompts automatically', async () => {
  const app = client(undefined, 'default'); await app.sync();
  assert.equal(app.prompts, 0);
  assert.equal(app.subscriptions, 0);
  assert.equal(app.nodes.get('notification-prompt').visible, true);
});
test('signed-out devices cannot register notifications', async () => {
  const app = client(); app.context.signedIn = false; await app.sync();
  assert.equal(app.calls.length, 0);
  assert.equal(app.subscriptions, 0);
});
