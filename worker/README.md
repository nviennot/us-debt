# Feedback Worker

A Cloudflare Worker that relays suggestion-box submissions from the static site
into a Telegram **group chat**, and lets you reply privately back to the
submitter so the reply shows up on their page. The bot token never lives in
client-side JavaScript.

```
Submit:  Browser → POST / → Worker → Telegram sendMessage
Reply:   You reply in Telegram → POST /webhook → Worker stores reply in a Durable Object
Show:    Browser → GET /reply?visitor_id=… → Worker returns the reply
```

Each browser generates a random **visitor id** once and keeps it in
`localStorage`. Submissions carry that id. The Worker stores it in a Durable
Object and remembers which Telegram message maps to it. When you **reply to that
message** in the group, Telegram's webhook delivers your reply, which the Worker
files under the visitor id. The page polls `GET /reply` and displays the reply
privately to that visitor only. A Durable Object is used instead of KV because
it gives strong read-after-write consistency, so replies appear on the next poll
rather than after KV's eventual-consistency lag.

## One-time Telegram setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Create your Telegram group and add the bot as a member.
3. Disable the bot's privacy mode so it can read your replies in the group:
   @BotFather → `/setprivacy` → select the bot → **Disable**.
4. Get the group's chat id (a **negative** number, e.g. `-1001234567890`):
   send any message in the group, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
   `result[].message.chat.id`.

## Deploy

Requires [wrangler](https://developers.cloudflare.com/workers/wrangler/).

```sh
cd worker
npm install -g wrangler   # or: npx wrangler ...
wrangler login

# The Durable Object is created automatically on first `wrangler deploy`
# (see [[durable_objects.bindings]] and [[migrations]] in wrangler.toml).

# Store secrets (never committed):
wrangler secret put TELEGRAM_BOT_TOKEN       # paste the BotFather token
wrangler secret put TELEGRAM_CHAT_ID         # paste the negative group chat id
wrangler secret put TELEGRAM_WEBHOOK_SECRET  # any random string you pick

wrangler deploy
```

`wrangler deploy` prints the Worker URL. Then register the Telegram webhook so
replies reach the Worker (using the same secret you set above):

```sh
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=<WORKER_URL>/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Point the frontend at the Worker via `VITE_FEEDBACK_URL` (see `web/src/App.jsx`),
and add the site's origin to `ALLOWED_ORIGINS` in `src/index.js` if it differs.

This Worker deploys independently of the GitHub Pages site; the Pages workflow
is unchanged.

## Replying

In the group, **reply** to the bot's message for a given submission and type your
answer. Only a reply (not a new message) is matched, via `reply_to_message`.
Visitor ids and replies auto-expire after 30 days.
