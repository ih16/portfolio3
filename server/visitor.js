'use strict';
const { isIP } = require('node:net');

function visitorInfo(req, at = Date.now()) {
  const header = name => typeof req.headers[name] === 'string' ? req.headers[name].slice(0, 512) : '';
  // Trust geolocation and proxy headers only behind Vercel's managed edge.
  const onVercel = process.env.VERCEL === '1';
  const address = (onVercel ? header('x-vercel-forwarded-for') : req.socket?.remoteAddress || '').split(',')[0].trim();
  const geo = name => onVercel ? header(name).slice(0, 120) : '';
  let city = geo('x-vercel-ip-city');
  try { city = decodeURIComponent(city); } catch { city = ''; }
  return { at, ip: isIP(address) ? address : '', city,
    region: geo('x-vercel-ip-country-region'), country: geo('x-vercel-ip-country'),
    userAgent: header('user-agent') };
}
module.exports = { visitorInfo };
