'use strict';
const { visitorInfo } = require('../server/visitor');
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { deleteConversation, redis, key, rate, conversation, saveMessage, readScript, RETENTION } = require('../server/store');
const { validEndpoint, subscriptionId, drainOutbox } = require('../server/push');
const hash = text => createHash('sha256').update(text).digest('hex');
const equal = (a, b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function requireValue(condition, status, message) { if (!condition) throw new HttpError(status, message); }
async function body(req) {
  requireValue((req.headers['content-type'] || '').startsWith('application/json'), 415, 'Send JSON.');
  let value = req.body;
  if (value === undefined) {
    let data = '';
    for await (const chunk of req) { data += chunk; requireValue(Buffer.byteLength(data) <= 8192, 413, 'Request is too large.'); }
    value = data;
  }
  requireValue(Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)) <= 8192, 413, 'Request is too large.');
  try { if (typeof value === 'string') value = JSON.parse(value); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 400, 'Invalid request.');
  return value;
}
async function identity(req, owner) {
  if (owner) {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('chat_owner='))?.slice(11);
    requireValue(token && /^[a-f0-9]{64}$/.test(token), 401, 'Sign in to your inbox.');
    requireValue(await redis('GET', key(`owner:${hash(token)}`)), 401, 'Sign in to your inbox.');
    return { owner: true, token };
  }
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  requireValue(/^[a-f0-9]{64}$/.test(token), 401, 'Your session has expired. Start a new chat.');
  const [id, onlineUntil] = await redis('MGET', key(`session:${hash(token)}`), key('owner-online'));
  requireValue(id, 401, 'Your session has expired. Start a new chat.');
  return { owner: false, id, onlineUntil: Number(onlineUntil || 0) };
}
function cookie(token, req, expired = false) {
  const secure = process.env.CHAT_ORIGIN.startsWith('https:') ? '; Secure' : '';
  return `chat_owner=${token}; HttpOnly${secure}; SameSite=Strict; Path=/api/chat; Max-Age=${expired ? 0 : 2592000}`;
}
async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const respond = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
  try {
    const required = ['CHAT_ORIGIN', 'CHAT_OWNER_PASSWORD', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_JWK', 'VAPID_SUBJECT'];
    requireValue(required.every(name => process.env[name]), 503, 'Chat is not configured yet. Please email ih.tonmoy@gmail.com.');
    const url = new URL(req.url, process.env.CHAT_ORIGIN);
    const action = url.searchParams.get('action');
    requireValue(req.method === 'GET' || req.method === 'POST', 405, 'Method not allowed.');
    if (req.method === 'POST') requireValue(req.headers.origin === process.env.CHAT_ORIGIN, 403, 'Origin not allowed.');
    if (action === 'config' && req.method === 'GET') return respond(200, { publicKey: process.env.VAPID_PUBLIC_KEY });
    if (action === 'cron' && req.method === 'GET') {
      requireValue(process.env.CRON_SECRET && equal(req.headers.authorization || '', `Bearer ${process.env.CRON_SECRET}`), 401, 'Unauthorised.');
      await drainOutbox();
      await redis('ZREMRANGEBYSCORE', key('conversations'), '-inf', Date.now() - RETENTION * 1000);
      return respond(200, { ok: true });
    }
    const data = req.method === 'POST' ? await body(req) : {};
    const ip = hash((req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim());
    if (action === 'session' && req.method === 'POST') {
      requireValue(typeof data.name === 'string' && data.name.trim().length >= 1 && data.name.trim().length <= 60, 400, 'Use a name between 1 and 60 characters.');
      requireValue(await rate(`session:${ip}`, 10, 3600), 429, 'Too many new chats. Try again in an hour.');
      requireValue(await rate('sessions-global', 500, 86400), 429, 'Chat is busy today. Please email me instead.');
      const token = randomBytes(32).toString('hex');
      const id = randomUUID();
      const now = Date.now();
      await redis('EVAL', `redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4]); redis.call('HSET', KEYS[2], 'name', ARGV[2], 'updated', ARGV[3], 'sequence', 0, 'session', ARGV[5], 'created', ARGV[3], 'visitorInfo', ARGV[6]); redis.call('EXPIRE', KEYS[2], ARGV[4]); return 1`,
        2, key(`session:${hash(token)}`), key(`conversation:${id}`), id, data.name.trim(), now, RETENTION, hash(token), JSON.stringify(visitorInfo(req, now)));
      return respond(201, { token, conversation: { id, name: data.name.trim() } });
    }
    if (action === 'login' && req.method === 'POST') {
      requireValue(await rate(`login:${ip}`, 10, 900), 429, 'Too many sign-in attempts. Try again in 15 minutes.');
      requireValue(typeof data.password === 'string' && equal(data.password, process.env.CHAT_OWNER_PASSWORD), 401, 'Incorrect password.');
      const token = randomBytes(32).toString('hex');
      await redis('SET', key(`owner:${hash(token)}`), '1', 'EX', 2592000);
      res.setHeader('Set-Cookie', cookie(token, req));
      return respond(200, { ok: true });
    }
    const user = await identity(req, url.searchParams.get('scope') === 'owner');
    if (action === 'logout' && req.method === 'POST' && user.owner) {
      await redis('DEL', key(`owner:${hash(user.token)}`));
      res.setHeader('Set-Cookie', cookie('', req, true));
      return respond(200, { ok: true });
    }
    if (action === 'inbox' && req.method === 'GET' && user.owner) {
      const offset = Number(url.searchParams.get('offset') || 0);
      requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000, 400, 'Invalid offset.');
      await redis('SET', key('owner-online'), Date.now() + 15 * 60 * 1000, 'EX', 900);
      const ids = await redis('ZREVRANGEBYSCORE', key('conversations'), '+inf', `(${Date.now() - RETENTION * 1000}`, 'LIMIT', offset, 50);
      const items = (await Promise.all(ids.map(conversation))).filter(Boolean);
      return respond(200, { conversations: items, more: ids.length === 50 });
    }
    if (action === 'subscribe' && req.method === 'POST' && user.owner) {
      requireValue(typeof data.endpoint === 'string' && validEndpoint(data.endpoint), 400, 'This push service is not supported.');
      const id = subscriptionId(data.endpoint);
      const result = await redis('EVAL', `if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= 5 then return 0 end redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]); return 1`, 1, key('subscriptions'), id, data.endpoint);
      requireValue(result, 409, 'Five devices are already registered. Disable notifications on another device first.');
      return respond(200, { ok: true });
    }
    if (action === 'unsubscribe' && req.method === 'POST' && user.owner) {
      requireValue(typeof data.endpoint === 'string', 400, 'Missing subscription.');
      await redis('HDEL', key('subscriptions'), subscriptionId(data.endpoint));
      return respond(200, { ok: true });
    }
    const id = user.owner ? (data.conversation || url.searchParams.get('conversation')) : user.id;
    requireValue(uuid(id), 400, 'Choose a conversation.');
    if (action === 'delete' && req.method === 'POST') {
      requireValue(user.owner, 403, 'Only the owner can delete conversations.');
      await deleteConversation(id);
      return respond(200, { ok: true });
    }
    if (action === 'visitor' && req.method === 'GET') {
      requireValue(user.owner, 403, 'Only the owner can view visitor details.');
      const [name, created, info] = await redis('HMGET', key(`conversation:${id}`), 'name', 'created', 'visitorInfo');
      requireValue(name !== null, 404, 'This conversation has expired.');
      return respond(200, { name, created: created ? Number(created) : null, info: info ? JSON.parse(info) : null });
    }
    const item = await conversation(id);
    requireValue(item, 404, 'This conversation has expired. Start a new chat.');
    if (action === 'messages' && req.method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0);
      requireValue(Number.isSafeInteger(after) && after >= 0 && after <= 2000, 400, 'Invalid message cursor.');
      const messages = after < item.sequence ? await redis('LRANGE', key(`messages:${id}`), after, after + 99) : [];
      return respond(200, { conversation: item, onlineUntil: user.onlineUntil > Date.now() ? user.onlineUntil : 0, messages: messages.map(JSON.parse), more: after + messages.length < item.sequence });
    }
    if (action === 'read' && req.method === 'POST' && user.owner) {
      requireValue(Number.isSafeInteger(data.sequence) && data.sequence >= 0, 400, 'Invalid read position.');
      await redis('EVAL', readScript, 2, key(`conversation:${id}`), key(`messages:${id}`), data.sequence);
      return respond(200, { ok: true });
    }
    if (action === 'block' && req.method === 'POST' && user.owner) {
      requireValue(typeof data.blocked === 'boolean', 400, 'Invalid block status.');
      const updated = await redis('EVAL', `if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
        redis.call('HSET', KEYS[1], 'blocked', ARGV[1]); return 1`, 1, key(`conversation:${id}`), data.blocked ? '1' : '0');
      requireValue(updated, 404, 'This conversation has expired.');
      return respond(200, { ok: true });
    }
    if (action === 'send' && req.method === 'POST') {
      requireValue(uuid(data.id) && typeof data.text === 'string' && data.text.trim().length > 0 && data.text.trim().length <= 2000, 400, 'Messages must contain 1–2,000 characters.');
      requireValue(await rate(`send:${user.owner ? 'owner' : id}`, user.owner ? 120 : 20, 60), 429, 'Please wait a minute before sending more.');
      const message = await saveMessage(id, { id: data.id, text: data.text.trim(), sender: user.owner ? 'owner' : 'visitor', at: Date.now(), info: user.owner ? null : visitorInfo(req) });
      requireValue(message !== 'blocked', 403, 'This conversation is closed.');
      requireValue(message !== 'missing', 404, 'This conversation has expired.');
      requireValue(message !== 'full', 409, 'This conversation has reached its limit. Please continue by email.');
      if (!user.owner) {
        // Saving succeeded even when a push provider is unavailable. The outbox
        // keeps failures for the next send or the scheduled retry endpoint.
        try { await drainOutbox(); } catch { console.error('Chat push deferred; message is saved.'); }
      }
      return respond(200, { message: JSON.parse(message) });
    }
    throw new HttpError(404, 'Unknown chat action.');
  } catch (error) {
    if (!error.status) console.error('Chat request failed:', error.name);
    return respond(error.status || 503, { error: error.status ? error.message : 'Chat is temporarily unavailable. Please try again.' });
  }
}
module.exports = handler;
