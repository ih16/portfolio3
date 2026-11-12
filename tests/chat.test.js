'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPairSync, randomUUID, verify } = require('node:crypto');
const { bridge, command } = require('./redis-bridge');
const handler = require('../api/chat');
const { validEndpoint, vapidAuthorization, drainOutbox } = require('../server/push');
const { key, redis } = require('../server/store');
let gateway, server, origin, cookie, alice, bob, signingKey;
const originalFetch = global.fetch;
const pushResults = [];
const storageCommands = [];
let pushStatus = 201, onPush;
before(async () => {
  gateway = await bridge();
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${gateway.address().port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'local-test';
  process.env.CHAT_OWNER_PASSWORD = 'test-only-owner-password';
  process.env.CRON_SECRET = 'test-only-cron-secret';
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); signingKey = pair.publicKey;
  const pub = pair.publicKey.export({ format: 'jwk' });
  process.env.VAPID_PRIVATE_JWK = JSON.stringify(pair.privateKey.export({ format: 'jwk' }));
  process.env.VAPID_PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  const keys = await command(['KEYS', key('*')]); if (keys.length) await command(['DEL', ...keys]);
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`; process.env.CHAT_ORIGIN = origin;
  global.fetch = async (url, options) => {
    if (String(url) === process.env.UPSTASH_REDIS_REST_URL) storageCommands.push(JSON.parse(options.body));
    if (String(url).startsWith('https://web.push.apple.com/')) { pushResults.push(options); if (onPush) await onPush(); return new Response(null, { status: pushStatus }); }
    return originalFetch(url, options);
  };
});
after(async () => {
  global.fetch = originalFetch;
  await Promise.all([server, gateway].filter(Boolean).map(s => new Promise(resolve => s.close(resolve))));
});
async function request(action, data, auth = {}, params = {}) {
  const query = new URLSearchParams({ action, ...params });
  if (auth.owner) query.set('scope', 'owner');
  const headers = { Origin: origin };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.owner && cookie) headers.Cookie = cookie;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  Object.assign(headers, auth.headers || {});
  const response = await fetch(`${origin}/api/chat?${query}`, { method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
test('separate sessions for identical names; anonymous access is denied', async () => {
  alice = (await request('session', { name: 'Alex' })).body;
  bob = (await request('session', { name: 'Alex' })).body;
  assert.notEqual(alice.token, bob.token);
  assert.notEqual(alice.conversation.id, bob.conversation.id);
  assert.equal((await request('messages')).status, 401);
  assert.equal((await request('inbox', undefined, { owner: true })).status, 401);
  assert.equal((await request('session', { name: '' })).status, 400);
});
test('cross-origin writes and malformed messages are rejected', async () => {
  assert.equal((await request('session', { name: 'X' }, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('send', { id: randomUUID(), text: 'x'.repeat(2001) }, alice)).status, 400);
  assert.equal((await request('send', { id: 'bad', text: 'Hello' }, alice)).status, 400);
});
test('concurrent retries save once and cannot cross conversation boundaries', async () => {
  const id = randomUUID();
  const results = await Promise.all(Array.from({ length: 4 }, () => request('send', { id, text: '<script>hello</script>', conversation: bob.conversation.id }, alice)));
  assert.ok(results.every(result => result.status === 200));
  assert.ok(results.every(result => result.body.message.sequence === 1));
  const own = await request('messages', undefined, alice, { conversation: bob.conversation.id });
  assert.equal(own.body.messages.length, 1);
  assert.equal(own.body.messages[0].text, '<script>hello</script>');
  assert.equal((await request('messages', undefined, bob)).body.messages.length, 0);
  assert.equal(Number(await redis('LLEN', key(`messages:${alice.conversation.id}`))), 1);
});
test('owner login, replies, unread acknowledgement and block enforcement', async () => {
  assert.equal((await request('login', { password: 'wrong' })).status, 401);
  const login = await request('login', { password: process.env.CHAT_OWNER_PASSWORD });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const inbox = await request('inbox', undefined, { owner: true });
  assert.equal(inbox.body.conversations[0].unread, true);
  const conversation = alice.conversation.id;
  assert.equal((await request('read', { conversation, sequence: 1 }, { owner: true })).status, 200);
  assert.equal((await request('inbox', undefined, { owner: true })).body.conversations[0].unread, false);
  assert.equal((await request('send', { conversation, id: randomUUID(), text: 'Hello Alex' }, { owner: true })).status, 200);
  const messages = await request('messages', undefined, alice, { after: '1' });
  assert.equal(messages.body.messages[0].sender, 'owner');
  await request('block', { conversation, blocked: true }, { owner: true });
  assert.equal((await request('send', { id: randomUUID(), text: 'Blocked' }, alice)).status, 403);
  await request('block', { conversation, blocked: false }, { owner: true });
});
test('owner presence lasts fifteen minutes and visitor reads cannot extend it', async () => {
  await redis('DEL', key('owner-online'));
  assert.equal((await request('messages', undefined, alice)).body.onlineUntil, 0);
  assert.equal((await request('inbox', undefined, { owner: true, headers: { Cookie: '' } })).status, 401);
  assert.equal(await redis('GET', key('owner-online')), null);
  await request('inbox', undefined, { owner: true });
  const until = Number(await redis('GET', key('owner-online')));
  assert.ok(until > Date.now() + 899000 && until <= Date.now() + 900000);
  assert.ok(await redis('TTL', key('owner-online')) <= 900);
  assert.equal((await request('messages', undefined, alice)).body.onlineUntil, until);
  assert.equal(Number(await redis('GET', key('owner-online'))), until);
  await redis('SET', key('owner-online'), Date.now() - 1, 'EX', 900);
  assert.equal((await request('messages', undefined, alice)).body.onlineUntil, 0);
});
test('VAPID uses a verifiable ES256 signature bound to the push origin', () => {
  const auth = vapidAuthorization('https://web.push.apple.com/test', JSON.parse(process.env.VAPID_PRIVATE_JWK), process.env.VAPID_PUBLIC_KEY, process.env.VAPID_SUBJECT);
  const token = auth.match(/t=([^,]+)/)[1]; const [header, claims, signature] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).aud, 'https://web.push.apple.com');
  assert.equal(verify('sha256', Buffer.from(`${header}.${claims}`), { key: signingKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  assert.equal(validEndpoint('https://web.push.apple.com.evil.example/foo'), false);
  assert.equal(validEndpoint('http://127.0.0.1/admin'), false);
  assert.equal(validEndpoint('https://web.push.apple.com:9999/foo'), false);
});
test('push failures preserve messages and retry jobs; dead subscriptions are removed', async () => {
  assert.equal((await request('subscribe', { endpoint: 'http://localhost/admin' }, { owner: true })).status, 400);
  assert.equal((await request('subscribe', { endpoint: 'https://web.push.apple.com/test' }, { owner: true })).status, 200);
  pushStatus = 503;
  const message = await request('send', { id: randomUUID(), text: 'Push test' }, alice);
  assert.equal(message.status, 200);
  assert.ok(pushResults.length > 0);
  assert.equal(pushResults[0].body, undefined);
  const jobs = await redis('ZRANGE', key('outbox'), 0, -1); assert.equal(jobs.length, 1);
  pushStatus = 410;
  await redis('ZADD', key('outbox'), 0, jobs[0]);
  await drainOutbox();
  assert.equal(await redis('ZCARD', key('outbox')), 0);
  assert.equal(await redis('HLEN', key('subscriptions')), 0);
  assert.equal((await request('messages', undefined, alice)).body.messages.length, 3);
});
test('unchanged polling skips message reads and inbox cleanup', async () => {
  storageCommands.length = 0;
  const result = await request('messages', undefined, alice, { after: '3' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.messages, []);
  assert.deepEqual(storageCommands.map(cmd => cmd[0]), ['MGET', 'HGETALL']);
  storageCommands.length = 0;
  await request('inbox', undefined, { owner: true });
  assert.ok(!storageCommands.some(cmd => cmd[0] === 'ZREMRANGEBYSCORE'));
});
test('thread summaries count unread visitor messages and survive partial reads and legacy backfill', async () => {
  const { saveMessage, conversation } = require('../server/store');
  const session = (await request('session', { name: 'Summary test' })).body;
  const id = session.conversation.id;
  const first = { id: randomUUID(), sender: 'visitor', text: 'First', at: Date.now() };
  await saveMessage(id, first);
  await saveMessage(id, first);
  await saveMessage(id, { id: randomUUID(), sender: 'owner', text: 'My reply', at: Date.now() });
  await saveMessage(id, { id: randomUUID(), sender: 'visitor', text: 'Latest message', at: Date.now() });
  let summary = await conversation(id);
  assert.equal(summary.unreadCount, 2);
  assert.equal(summary.latestText, 'Latest message');
  assert.equal(summary.latestSender, 'visitor');
  await request('read', { conversation: id, sequence: 1 }, { owner: true });
  assert.equal((await conversation(id)).unreadCount, 1);
  await request('read', { conversation: id, sequence: 0 }, { owner: true });
  assert.equal((await conversation(id)).unreadCount, 1);
  await redis('HDEL', key(`conversation:${id}`), 'unreadCount', 'latestText', 'latestSender');
  summary = await conversation(id);
  assert.equal(summary.unreadCount, 1);
  assert.equal(summary.latestText, 'Latest message');
  storageCommands.length = 0;
  await conversation(id);
  assert.deepEqual(storageCommands.map(cmd => cmd[0]), ['HGETALL']);
  await request('read', { conversation: id, sequence: 3 }, { owner: true });
  assert.equal((await conversation(id)).unreadCount, 0);
  await saveMessage(id, { id: randomUUID(), sender: 'owner', text: 'Latest reply', at: Date.now() });
  summary = await conversation(id);
  assert.equal(summary.unreadCount, 0);
  assert.equal(summary.latestSender, 'owner');
  assert.equal(summary.latestText, 'Latest reply');
});
test('visitor details are owner-only, captured from requests and excluded from messages', async () => {
  const visitor = (await request('session', { name: 'Details test' }, { headers: { 'User-Agent': 'Preview browser', 'X-Vercel-Ip-City': 'Spoofed' } })).body;
  const params = { conversation: visitor.conversation.id };
  assert.equal((await request('visitor', undefined, visitor, params)).status, 403);
  assert.equal((await request('visitor', undefined, {}, params)).status, 401);
  const details = (await request('visitor', undefined, { owner: true }, params));
  assert.equal(details.status, 200);
  assert.equal(details.body.info.userAgent, 'Preview browser');
  assert.equal(details.body.info.ip, '127.0.0.1');
  assert.equal(details.body.info.city, '');
  assert.ok(details.body.created > 0);
  const result = await request('messages', undefined, visitor);
  assert.equal(JSON.stringify(result.body).includes('127.0.0.1'), false);
  assert.equal(JSON.stringify(result.body).includes('Preview browser'), false);
  await request('send', { id: randomUUID(), text: 'New connection' }, { ...visitor, headers: { 'User-Agent': 'Updated browser' } });
  await request('send', { id: randomUUID(), text: 'Reply', conversation: visitor.conversation.id }, { owner: true });
  assert.equal((await request('visitor', undefined, { owner: true }, params)).body.info.userAgent, 'Updated browser');
  await redis('HDEL', key(`conversation:${visitor.conversation.id}`), 'visitorInfo', 'created');
  const legacy = (await request('visitor', undefined, { owner: true }, params)).body;
  assert.equal(legacy.info, null);
  assert.equal(legacy.created, null);
});
test('Vercel visitor metadata decodes city names and validates addresses', () => {
  const { visitorInfo } = require('../server/visitor');
  const previous = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    const headers = { 'x-vercel-forwarded-for': '203.0.113.10', 'x-vercel-ip-city': 'New%20York', 'x-vercel-ip-country-region': 'NY', 'x-vercel-ip-country': 'US' };
    const info = visitorInfo({ headers }, 123);
    assert.equal(info.city, 'New York');
    assert.equal(info.ip, '203.0.113.10');
    assert.equal(info.country, 'US');
    assert.equal(info.at, 123);
    assert.equal(visitorInfo({ headers: { ...headers, 'x-vercel-forwarded-for': 'not-an-ip', 'x-vercel-ip-city': '%broken' } }).ip, '');
    assert.equal(visitorInfo({ headers: { ...headers, 'x-vercel-ip-city': '%broken' } }).city, '');
  } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});
test('only the owner can delete a thread; deletion removes messages, session and pending pushes', async () => {
  const conversation = alice.conversation.id;
  assert.equal((await request('delete', { conversation }, alice)).status, 403);
  assert.equal((await request('delete', { conversation })).status, 401);
  assert.equal((await request('delete', { conversation }, { owner: true, headers: { Origin: 'https://evil.example' } })).status, 403);
  const { saveMessage } = require('../server/store');
  const id = randomUUID();
  await saveMessage(conversation, { id, sender: 'visitor', text: 'Pending push', at: Date.now() });
  assert.equal(await redis('EXISTS', key(`job:${conversation}:${id}`)), 1);
  assert.equal((await request('delete', { conversation }, { owner: true })).status, 200);
  for (const name of [`conversation:${conversation}`, `messages:${conversation}`, `ids:${conversation}`, `job:${conversation}:${id}`]) {
    assert.equal(await redis('EXISTS', key(name)), 0);
  }
  assert.equal(await redis('ZSCORE', key('outbox'), `${conversation}:${id}`), null);
  assert.equal((await request('messages', undefined, alice)).status, 401);
  assert.equal((await request('send', { id, text: 'Retry' }, alice)).status, 401);
  assert.ok(!(await request('inbox', undefined, { owner: true })).body.conversations.some(item => item.id === conversation));
  assert.equal((await request('messages', undefined, bob)).status, 200);
  assert.equal((await request('delete', { conversation }, { owner: true })).status, 200);
});
test('an in-flight failed push cannot recreate a deleted thread job', async () => {
  const { saveMessage, deleteConversation } = require('../server/store');
  const conversation = bob.conversation.id;
  // Older conversations have no reverse session reference.
  await redis('HDEL', key(`conversation:${conversation}`), 'session');
  const id = randomUUID();
  await request('subscribe', { endpoint: 'https://web.push.apple.com/test' }, { owner: true });
  await saveMessage(conversation, { id, sender: 'visitor', text: 'Race', at: Date.now() });
  pushStatus = 503;
  onPush = () => deleteConversation(conversation);
  try { await drainOutbox(); } finally { onPush = null; }
  assert.equal(await redis('EXISTS', key(`job:${conversation}:${id}`)), 0);
  assert.equal(await redis('ZSCORE', key('outbox'), `${conversation}:${id}`), null);
  assert.equal((await request('messages', undefined, bob)).status, 404);
  assert.equal((await request('send', { id: randomUUID(), text: 'Old session' }, bob)).status, 404);
});
test('cron is authenticated; logout revokes the session', async () => {
  assert.equal((await request('cron')).status, 401);
  assert.equal((await request('cron', undefined, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })).status, 200);
  assert.equal((await request('logout', {}, { owner: true })).status, 200);
  assert.equal((await request('inbox', undefined, { owner: true })).status, 401);
});
