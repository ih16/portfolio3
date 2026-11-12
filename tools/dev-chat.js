#!/usr/bin/env node
'use strict';
// No build tooling: serves the files and the same function Vercel executes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('../api/chat');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 6768);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/chat') return handler(req, res);
  let name;
  try { name = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (name === '/') name = '/index.html';
  if (name === '/chat' || name === '/chat/') name = '/chat/index.html';
  if (['/chat/inbox', '/chat/install'].includes(name)) name += '.html';
  // Only public assets are served. Server code, tests and credentials stay private.
  if (name.includes('..') || !(/^\/(chat|work)\/[^/]+\.(html|css|js|png|webmanifest)$/.test(name) || /^\/(index\.html|styles\.css|script\.js|pet\.js|[^/]+\.pdf)$/.test(name))) {
    res.writeHead(404); res.end(); return;
  }
  try {
    const content = await fs.promises.readFile(path.join(root, name));
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(content);
  } catch { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Chat preview: http://localhost:${port}`));
