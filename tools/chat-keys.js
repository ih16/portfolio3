#!/usr/bin/env node
'use strict';
// Run locally and put these values in Vercel's encrypted environment settings.
// Keep the password in your password manager; never commit this output.
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicJWK = publicKey.export({ format: 'jwk' });
const publicBytes = Buffer.concat([Buffer.from([4]), Buffer.from(publicJWK.x, 'base64url'), Buffer.from(publicJWK.y, 'base64url')]);
console.log(`CHAT_OWNER_PASSWORD=${randomBytes(24).toString('base64url')}`);
console.log(`VAPID_PUBLIC_KEY=${publicBytes.toString('base64url')}`);
console.log(`VAPID_PRIVATE_JWK=${JSON.stringify(privateKey.export({ format: 'jwk' }))}`);
console.log('VAPID_SUBJECT=mailto:ih.tonmoy@gmail.com');
console.log(`CRON_SECRET=${randomBytes(32).toString('hex')}`);
