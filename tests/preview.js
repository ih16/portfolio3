'use strict';
const { generateKeyPairSync } = require('node:crypto');
const { bridge } = require('./redis-bridge');
(async () => {
  const gateway = await bridge();
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  Object.assign(process.env, {
    CHAT_ORIGIN: 'http://localhost:6768', CHAT_OWNER_PASSWORD: 'local-preview-only',
    UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${gateway.address().port}`, UPSTASH_REDIS_REST_TOKEN: 'test',
    VAPID_PRIVATE_JWK: JSON.stringify(privateKey.export({ format: 'jwk' })),
    VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url'),
    VAPID_SUBJECT: 'mailto:test@example.com', CRON_SECRET: 'preview-only'
  });
  require('../tools/dev-chat');
})();
