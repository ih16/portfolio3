# Chat deployment on Vercel

The existing portfolio remains plain HTML/CSS/JavaScript. Vercel runs the two
Node.js functions in `api/`; Upstash Redis stores conversations, sessions and
pending notifications. The server-side `@upstash/redis` SDK is installed, with a reusable client in
`lib/redis.ts`. There is no frontend build command. The existing chat storage
adapter continues to use its tested Redis HTTP commands.

## Configured for this project

- Upstash database: `portfoliochat`, free plan, Singapore (`ap-southeast-1`).
- Vercel project: `portfolio3`, serving `https://ishtiaq.dev`.
- Function region: `sin1` (Singapore), pinned in `vercel.json`.
- Both local `.env` files are populated; all eight production variables are
  configured in Vercel. Secrets are excluded from Git.
- The source changes and region setting take effect on the next deployment.
  Do not rerun key generation to replace working keys unless you intend to
  rotate the inbox password and re-register push subscriptions.

## Before pushing

1. Create an **Upstash Redis** database, either through Vercel Marketplace or
   directly at Upstash. Choose a region close to your Vercel functions. Use a
   database dedicated to this app, with eviction disabled so memory pressure
   cannot silently remove messages. Note the database's **REST URL** and
   **REST token** (not a read-only token).
2. From this repository, run `node tools/chat-keys.js`. It prints a random
   inbox password, Web Push keys, a contact address and a cron secret. Save the
   password in your password manager. Keep the output private; do not commit it.
3. In **Vercel → Project → Settings → Environment Variables**, add all of:

   | Variable | Value |
   | --- | --- |
   | `CHAT_ORIGIN` | Your canonical origin, e.g. `https://ishtiaq.dev`, without a trailing slash |
   | `UPSTASH_REDIS_REST_URL` | Upstash database REST URL |
   | `UPSTASH_REDIS_REST_TOKEN` | Upstash database REST token |
   | `CHAT_OWNER_PASSWORD` | Generated inbox password |
   | `VAPID_PUBLIC_KEY` | Generated public key |
   | `VAPID_PRIVATE_JWK` | Generated JSON, as one line; paste without extra surrounding quotes |
   | `VAPID_SUBJECT` | `mailto:ih.tonmoy@gmail.com` |
   | `CRON_SECRET` | Generated cron secret |

   Set these for **Production**. Preview deployments need a separate test
   database and an origin matching the preview URL if you want working chat
   there. Do not point preview deployments at the production database.
4. Keep **Framework Preset: Other**, **Build Command: empty**, and no custom
   Output Directory. Select **Node.js 24.x** for Functions. The Vercel project
   root must contain `vercel.json`, `api/`, `chat/`, and `index.html`.
   This checkout is `/Users/iht/experiments/portfolioV3/portfolio`; that nested
   folder is the Git repository. Its contents are the repository root on GitHub,
   so do not add an extra `portfolio` Root Directory in Vercel for that repo.
5. Redirect other domains (such as `www`) to the canonical `CHAT_ORIGIN` through
   Vercel Domains. Write requests from a different origin are deliberately denied.
6. Commit and push this repository to the production branch. Vercel discovers
   the functions automatically. If you add/change environment variables after
   deployment, redeploy; existing deployments do not receive those changes.

Upstash setup: <https://upstash.com/docs/redis/features/restapi>
Vercel Node runtime: <https://vercel.com/docs/functions/runtimes/node-js>

## Activate your inbox

1. Open `https://ishtiaq.dev/chat/install` on your phone.
2. Install using the button where available. On iPhone/iPad, open in Safari and
   use **Share → Add to Home Screen** (requires iOS/iPadOS 16.4+ for Web Push).
3. Open the installed app. Sign in with `CHAT_OWNER_PASSWORD`.
4. Tap **Enable notifications**, then allow the browser/system prompt.
5. Open `/chat` in another browser, enter a name, and send a message. Check that
   the phone receives a notification with the app closed. Tap it, reply from
   the inbox, and confirm the visitor receives the reply.

No app-store account, native build or always-on server is needed. Install and
notification permission are separate actions. The owner can register up to five
notification devices. Signing out removes that device's push subscription.
Messages are still available if notification permission is denied.

## Delivery, retries and limits

- Visitors resume using a random session secret in local storage. Names are
  display labels, not authentication. The server stores only the secret's hash.
  Clearing browser storage loses access. Sessions last 90 days from creation.
- Owner sessions use an HttpOnly, SameSite=Strict, Secure production cookie and
  expire after 30 days. Keep the generated high-entropy password. To revoke all
  owner sessions, delete only keys matching `portfolio-chat:v1:owner:*` in this
  app's Redis database; rotating the password alone does not revoke sessions.
- Message history expires after 90 days without a new message in a conversation.
  There is a limit of 2,000 messages per conversation and 2,000 characters per
  message. The inbox loads 50 conversations at a time.
- The active chat fills the mobile viewport, with a fixed composer and only the
  message history scrolling. Short histories align to the bottom. The mobile
  inbox uses a conversation picker instead of a second scrolling list.
- Open pages poll every 10 seconds; hidden pages stop polling. Messages missed
  while closed are fetched on return. Visitors need to return to the same
  browser for replies; only the owner's devices receive push notifications.
- Sending a visitor message saves it and its notification job atomically, then
  attempts Web Push immediately. Retries reuse the client message ID so an
  interrupted response does not duplicate the message.
- Failed push jobs remain queued. New visitor sends process up to three due
  jobs, and a **daily Vercel cron** is included as a fallback compatible with
  Hobby scheduling. This daily fallback is not a timely retry guarantee.
  For prompt retries during a push outage, configure an external scheduler
  (or a supported Vercel plan) to call `GET /api/chat-cron` every minute with
  `Authorization: Bearer <CRON_SECRET>`. Do not put the secret in the URL.
- Push delivery is best effort. A provider accepting the request does not prove
  that a device displayed it. Notifications contain no visitor name or message
  text and open the inbox. Expired push subscriptions are removed automatically.
- Storage and API calls consume your provider quotas. Ten-second polling is
  intentionally simple for a small personal inbox; monitor Vercel/Upstash usage.
- The service worker caches only the public app shell. Private API responses
  and message history are never put in the service-worker cache. Offline drafts
  stay in the open page, but are not persisted across reloads or queued to send.
- This is server-mediated one-to-one chat, not WebRTC or end-to-end encryption.
  The backend and database can read message text.

## Local checks

Opening `index.html` directly still works for the portfolio. Chat requires an
HTTP server and configured storage. With a **separate development database**,
copy `.env.example` to `.env`, fill its values, set
`CHAT_ORIGIN=http://localhost:6768`, then run:

```sh
node --env-file=.env tools/dev-chat.js
```

Open `http://localhost:6768/chat`. Production keys should not be used locally.

For integration tests without an Upstash account, use disposable local Redis:

```sh
docker run --rm -d --name portfolio-chat-test-redis -p 127.0.0.1:16389:6379 redis:7-alpine redis-server --save '' --appendonly no
node --test tests/chat.test.js
docker stop portfolio-chat-test-redis
```

The test suite clears this app's key prefix in the **test Redis on port 16389**.
Never point it at production. It exercises the real Lua scripts and HTTP
handler, and intercepts push requests rather than contacting a real device.
For browser QA while the test container is running, `node tests/preview.js`
starts a localhost-only preview. Its inbox password is `local-preview-only`;
the preview is excluded from deployment and must not be exposed publicly.

## Troubleshooting

- **Chat is not configured yet:** one or more required environment variables
  are missing. Add them and redeploy. The portfolio remains available.
- **Origin not allowed:** `CHAT_ORIGIN` must exactly match the URL in the browser,
  including scheme and port for local development, without a trailing slash.
- **No notification:** open the installed inbox, check notification permission,
  and use Disable/Enable notifications to register again. Check OS focus modes.
  Changing VAPID keys requires unsubscribing and subscribing again on each device.
- **Messages work, push does not:** verify the VAPID values, the private key JSON,
  and a valid `mailto:` subject. Check for pending jobs in
  `portfolio-chat:v1:outbox` and the Vercel function logs.
- **Storage unavailable:** verify the REST URL/token, database state, and quotas.
- **Old content after an update:** open the app online to refresh its shell.
  The service worker uses network-first fetching. Increment its cache version
  when changing the shell's file list.

## Polling and thread deletion

Visible chats poll every 10 seconds after activity, backing off to 60 seconds
when unchanged. The owner inbox list refreshes at most once a minute during
polling. Returning to the app or reconnecting refreshes immediately. Hidden
or offline pages do not poll. Replies can take up to a minute to appear in
an idle open chat; Web Push delivery is unchanged.

The inbox opens on the conversation list. Tap a row to open a chat; Back returns
to the list without clearing its draft. Each row has a three-dot menu (also
available on right-click) for deleting that conversation.

The conversation menus include Delete conversation with a permanent
deletion confirmation. This removes messages, retry IDs, the inbox entry and
pending notification jobs. The visitor must start a new chat. Older sessions
created before this change expire normally but cannot access a deleted thread.
