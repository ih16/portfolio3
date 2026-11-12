'use strict';
const { createPrivateKey, sign, randomBytes, createHash } = require('node:crypto');
const { redis, key } = require('./store');

function validEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) ||
        url.hostname.endsWith('.notify.windows.com')) && endpoint.length < 2048;
  } catch { return false; }
}
function vapidAuthorization(endpoint, privateJWK, publicKey, subject) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ typ: 'JWT', alg: 'ES256' });
  const claims = encode({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 3600, sub: subject });
  const input = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(input), {
    key: createPrivateKey({ key: privateJWK, format: 'jwk' }), dsaEncoding: 'ieee-p1363'
  }).toString('base64url');
  return `vapid t=${input}.${signature}, k=${publicKey}`;
}
const subscriptionId = endpoint => createHash('sha256').update(endpoint).digest('hex');
async function sendPush(endpoint) {
  if (!validEndpoint(endpoint)) return 410;
  // An empty Web Push message carries no visitor data and needs no payload cipher.
  // The service worker always shows a generic notification and opens the inbox.
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
    headers: { TTL: '86400', Urgency: 'normal', 'Content-Length': '0',
      Authorization: vapidAuthorization(endpoint, JSON.parse(process.env.VAPID_PRIVATE_JWK),
        process.env.VAPID_PUBLIC_KEY, process.env.VAPID_SUBJECT) }
  });
  return response.status;
}
async function drainOutbox() {
  const lock = randomBytes(16).toString('hex');
  if (!await redis('SET', key('push-lock'), lock, 'NX', 'EX', 45)) return;
  try {
    const jobs = await redis('ZRANGEBYSCORE', key('outbox'), '-inf', Date.now(), 'LIMIT', 0, 3);
    const subscriptions = await redis('HGETALL', key('subscriptions'));
    const devices = [];
    for (let i = 0; i < subscriptions.length; i += 2) devices.push([subscriptions[i], subscriptions[i + 1]]);
    for (const job of jobs) {
      const stored = await redis('GET', key(`job:${job}`));
      if (!stored) { await redis('ZREM', key('outbox'), job); continue; }
      const done = JSON.parse(stored);
      let failed = false;
      await Promise.all(devices.map(async ([id, endpoint]) => {
        if (done[id]) return;
        try {
          const status = await sendPush(endpoint);
          if (status === 404 || status === 410) await redis('HDEL', key('subscriptions'), id);
          if ((status >= 200 && status < 300) || status === 404 || status === 410) done[id] = true;
          else failed = true;
        } catch { failed = true; }
      }));
      if (failed) {
        await redis('SET', key(`job:${job}`), JSON.stringify(done), 'KEEPTTL');
        await redis('ZADD', key('outbox'), Date.now() + 60000, job);
      } else {
        await redis('ZREM', key('outbox'), job);
        await redis('DEL', key(`job:${job}`));
      }
    }
  } finally {
    await redis('EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, key('push-lock'), lock);
  }
}
module.exports = { validEndpoint, vapidAuthorization, subscriptionId, drainOutbox };
