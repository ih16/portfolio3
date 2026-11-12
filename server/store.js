'use strict';

const PREFIX = 'portfolio-chat:v1:';
const RETENTION = 90 * 24 * 60 * 60;
const key = value => PREFIX + value;

async function redis(...command) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Storage unavailable');
  const result = await response.json();
  if (result.error) throw new Error('Storage command failed');
  return result.result;
}

const rateScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

// Backfill existing threads once; normal inbox refreshes read only the hash.
const summaryScript = `
if redis.call('HEXISTS', KEYS[1], 'unreadCount') == 0 then
  local read = tonumber(redis.call('HGET', KEYS[1], 'read') or '0')
  local unread = 0
  for _, raw in ipairs(redis.call('LRANGE', KEYS[2], read, -1)) do
    if cjson.decode(raw).sender == 'visitor' then unread = unread + 1 end
  end
  local raw = redis.call('LINDEX', KEYS[2], -1)
  local latest = raw and cjson.decode(raw) or {text='', sender=''}
  redis.call('HSET', KEYS[1], 'unreadCount', unread, 'latestText', latest.text, 'latestSender', latest.sender)
end
`;

// The acknowledgement, message sequence and notification job share one commit.
// A retried client ID returns the original message without another push job.
const messageScript = `
local existing = redis.call('HGET', KEYS[3], ARGV[1])
if existing then return existing end
if redis.call('EXISTS', KEYS[1]) == 0 then return 'missing' end
if ARGV[2] == 'visitor' and redis.call('HGET', KEYS[1], 'blocked') == '1' then return 'blocked' end
local count = tonumber(redis.call('HGET', KEYS[1], 'sequence') or '0')
if count >= 2000 then return 'full' end
${summaryScript}
local seq = redis.call('HINCRBY', KEYS[1], 'sequence', 1)
local message = cjson.encode({id=ARGV[1], sender=ARGV[2], text=ARGV[3], at=tonumber(ARGV[4]), sequence=seq})
redis.call('RPUSH', KEYS[2], message)
redis.call('HSET', KEYS[3], ARGV[1], message)
redis.call('HSET', KEYS[1], 'updated', ARGV[4], 'latestText', ARGV[3], 'latestSender', ARGV[2])
if ARGV[2] == 'visitor' then
  redis.call('HSET', KEYS[1], 'lastVisitor', seq)
  redis.call('HINCRBY', KEYS[1], 'unreadCount', 1)
  redis.call('SET', KEYS[5], '{}', 'EX', ARGV[6])
  redis.call('ZADD', KEYS[6], ARGV[4], ARGV[7])
end
redis.call('ZADD', KEYS[4], ARGV[4], ARGV[5])
for i = 1, 3 do redis.call('EXPIRE', KEYS[i], ARGV[6]) end
return message
`;

const readScript = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local seq = math.min(tonumber(ARGV[1]), tonumber(redis.call('HGET', KEYS[1], 'sequence') or '0'))
local old = tonumber(redis.call('HGET', KEYS[1], 'read') or '0')
if seq > old then
  local unread = 0
  if seq < tonumber(redis.call('HGET', KEYS[1], 'lastVisitor') or '0') then
    for _, raw in ipairs(redis.call('LRANGE', KEYS[2], seq, -1)) do
      if cjson.decode(raw).sender == 'visitor' then unread = unread + 1 end
    end
  end
  redis.call('HSET', KEYS[1], 'read', seq, 'unreadCount', unread)
end
return 1
`;

// Messages and their retry IDs are bounded to 2,000 per conversation.
// Delete atomically with sending so a concurrent send cannot recreate the thread.
const deleteScript = `
local ids = redis.call('HKEYS', KEYS[3])
for _, id in ipairs(ids) do
  local job = ARGV[1] .. ':' .. id
  redis.call('DEL', ARGV[2] .. 'job:' .. job)
  redis.call('ZREM', KEYS[5], job)
end
local session = redis.call('HGET', KEYS[1], 'session')
if session then redis.call('DEL', ARGV[2] .. 'session:' .. session) end
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
redis.call('ZREM', KEYS[4], ARGV[1])
return 1
`;
async function deleteConversation(id) {
  return redis('EVAL', deleteScript, 5, key(`conversation:${id}`), key(`messages:${id}`),
    key(`ids:${id}`), key('conversations'), key('outbox'), id, PREFIX);
}

async function rate(identity, limit, seconds) {
  return Number(await redis('EVAL', rateScript, 1, key(`rate:${identity}`), seconds)) <= limit;
}
async function conversation(id) {
  const values = await redis('HGETALL', key(`conversation:${id}`));
  if (!values?.length) return null;
  const item = {};
  for (let i = 0; i < values.length; i += 2) item[values[i]] = values[i + 1];
  if (item.unreadCount === undefined) {
    await redis('EVAL', `if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end ${summaryScript} return 1`,
      2, key(`conversation:${id}`), key(`messages:${id}`));
    return conversation(id);
  }
  return { id, name: item.name, updated: Number(item.updated), sequence: Number(item.sequence || 0),
    unread: Number(item.unreadCount) > 0, unreadCount: Number(item.unreadCount),
    latestText: item.latestText || '', latestSender: item.latestSender || '', blocked: item.blocked === '1' };
}
async function saveMessage(id, message) {
  const job = `${id}:${message.id}`;
  return redis('EVAL', messageScript, 6, key(`conversation:${id}`), key(`messages:${id}`),
    key(`ids:${id}`), key('conversations'), key(`job:${job}`), key('outbox'),
    message.id, message.sender, message.text, message.at, id, RETENTION, job);
}
module.exports = { deleteConversation, redis, key, rate, conversation, saveMessage, readScript, RETENTION, messageScript };
