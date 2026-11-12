'use strict';
// Test-only adapter: exercises the production HTTP Redis client against real
// Redis/Lua without requiring an Upstash account or a Redis client dependency.
const net = require('node:net');
const http = require('node:http');
function parse(buffer, offset = 0) {
  const end = buffer.indexOf('\r\n', offset);
  if (end < 0) return null;
  const type = String.fromCharCode(buffer[offset]);
  const value = buffer.toString('utf8', offset + 1, end);
  let next = end + 2;
  if (type === '+') return { value, next };
  if (type === '-') return { error: value, next };
  if (type === ':') return { value: Number(value), next };
  const length = Number(value);
  if (length === -1) return { value: null, next };
  if (type === '$') {
    if (buffer.length < next + length + 2) return null;
    return { value: buffer.toString('utf8', next, next + length), next: next + length + 2 };
  }
  if (type === '*') {
    const items = [];
    for (let i = 0; i < length; i++) { const item = parse(buffer, next); if (!item) return null; items.push(item.value); next = item.next; }
    return { value: items, next };
  }
  throw new Error('Unknown Redis frame');
}
function command(args) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(process.env.TEST_REDIS_PORT || 16389), '127.0.0.1');
    let data = Buffer.alloc(0);
    socket.setTimeout(5000, () => socket.destroy(new Error('Redis timed out')));
    socket.on('error', reject);
    socket.on('connect', () => {
      const parts = [`*${args.length}\r\n`];
      for (const arg of args) { const text = String(arg); parts.push(`$${Buffer.byteLength(text)}\r\n`, text, '\r\n'); }
      socket.write(parts.join(''));
    });
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]); const result = parse(data);
      if (result) { socket.end(); result.error ? reject(new Error(result.error)) : resolve(result.value); }
    });
  });
}
async function bridge() {
  const server = http.createServer(async (req, res) => {
    let input = ''; for await (const chunk of req) input += chunk;
    try { res.end(JSON.stringify({ result: await command(JSON.parse(input)) })); }
    catch (error) { res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}
module.exports = { command, bridge };
