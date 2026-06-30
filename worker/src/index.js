// Cloudflare Worker that relays website feedback into a Telegram group chat,
// and lets you reply privately back to the submitter, kept as a chat thread.
//
// Secrets (wrangler secret put ...):
//   TELEGRAM_BOT_TOKEN   bot token from @BotFather
//   TELEGRAM_CHAT_ID     target group chat id (negative number)
//   TELEGRAM_WEBHOOK_SECRET  arbitrary string; set as the webhook secret_token
//
// Storage: a single Durable Object (FeedbackStore) holds all state with strong
// read-after-write consistency, which KV does not provide. KV's eventual
// consistency caused replies to appear many seconds late (a poll could read the
// thread before the webhook's write had propagated), so we use a DO instead.
//
//   thread:<visitorId> -> JSON { name, messages: [{ from, text, ts }], updatedAt }
//                         from is "visitor" (from the page) or "owner" (your reply)
//   msg:<message_id>   -> <visitor id>  (links a sent Telegram message to a visitor)
//
// Flow:
//   1. Browser POSTs { visitor_id, message }. We append it to the visitor's
//      thread, forward it to Telegram, and remember the sent message_id so a
//      reply to it can be matched back.
//   2. You REPLY to any message in the group. Telegram calls POST /webhook;
//      we match reply_to_message.message_id -> visitor and append your reply.
//   3. Browser polls GET /messages?visitor_id=<id> and renders the whole thread.

const MAX_MESSAGE_LENGTH = 2000;

// Origins allowed to call this Worker. Update if the site moves.
const ALLOWED_ORIGINS = [
  "https://usdebt.watch",
  "https://www.usdebt.watch",
  "https://nviennot.github.io",
  "http://localhost:5173",
  "http://localhost:5175",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function isValidVisitorId(v) {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(v);
}

// All state lives in one DO instance. Get a stub for it.
function store(env) {
  return env.FEEDBACK_STORE.get(env.FEEDBACK_STORE.idFromName("global"));
}

async function handleSubmit(request, env, origin) {
  let visitorId, name, message;
  try {
    ({ visitor_id: visitorId, name, message } = await request.json());
  } catch {
    return json({ error: "Invalid JSON" }, 400, origin);
  }

  if (!isValidVisitorId(visitorId)) {
    return json({ error: "Invalid visitor id" }, 400, origin);
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return json({ error: "Message is required" }, 400, origin);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: "Message too long" }, 400, origin);
  }

  const text = message.trim();
  const cleanName =
    typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : null;

  // Append the visitor's message to their thread (strongly consistent).
  const appendResp = await store(env).fetch("https://do/append-visitor", {
    method: "POST",
    body: JSON.stringify({ visitorId, text, name: cleanName }),
  });
  const { thread } = await appendResp.json();

  // Reply matching uses reply_to_message.message_id (see the msg: mapping),
  // so no id needs to appear in the message text.
  const tgText = thread.name ? `${thread.name}> ${text}` : text;
  const tgResp = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: tgText,
        disable_web_page_preview: true,
      }),
    }
  );

  if (!tgResp.ok) {
    return json({ error: "Failed to deliver message" }, 502, origin);
  }

  // Map the sent message id -> visitor so we can match your reply later.
  const sent = await tgResp.json();
  const messageId = sent?.result?.message_id;
  if (messageId != null) {
    await store(env).fetch("https://do/map-message", {
      method: "POST",
      body: JSON.stringify({ messageId, visitorId }),
    });
  }

  return json({ ok: true, messages: thread.messages }, 200, origin);
}

async function handleGetMessages(url, env, origin) {
  const visitorId = url.searchParams.get("visitor_id");
  if (!isValidVisitorId(visitorId)) {
    return json({ error: "Invalid visitor id" }, 400, origin);
  }
  const resp = await store(env).fetch(
    `https://do/thread?visitor_id=${encodeURIComponent(visitorId)}`
  );
  const { thread } = await resp.json();
  return json({ messages: thread.messages }, 200, origin);
}

// Telegram webhook: append your reply to the visitor's thread.
async function handleWebhook(request, env) {
  if (
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
    env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    // Return 200 so Telegram doesn't retry an unparseable payload with backoff.
    return new Response("OK", { status: 200 });
  }

  const msg = update.message;
  const repliedId = msg?.reply_to_message?.message_id;
  const replyText = msg?.text;
  if (repliedId != null && replyText) {
    await store(env).fetch("https://do/append-owner", {
      method: "POST",
      body: JSON.stringify({
        repliedId,
        replyText,
        newMessageId: msg.message_id ?? null,
      }),
    });
  }

  // Always 200 so Telegram doesn't retry.
  return new Response("OK", { status: 200 });
}

// Durable Object: single instance holding all threads and message mappings.
// Storage keys: thread:<visitorId> and msg:<messageId>.
export class FeedbackStore {
  constructor(state) {
    this.state = state;
  }

  async getThread(visitorId) {
    const thread = await this.state.storage.get(`thread:${visitorId}`);
    if (!thread) return { messages: [] };
    if (!Array.isArray(thread.messages)) thread.messages = [];
    return thread;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/thread") {
      const visitorId = url.searchParams.get("visitor_id");
      const thread = await this.getThread(visitorId);
      return Response.json({ thread });
    }

    if (url.pathname === "/append-visitor") {
      const { visitorId, text, name } = await request.json();
      const thread = await this.getThread(visitorId);
      if (!thread.name && name) thread.name = name;
      thread.messages.push({ from: "visitor", text, ts: Date.now() });
      thread.updatedAt = Date.now();
      await this.state.storage.put(`thread:${visitorId}`, thread);
      return Response.json({ thread });
    }

    if (url.pathname === "/map-message") {
      const { messageId, visitorId } = await request.json();
      await this.state.storage.put(`msg:${messageId}`, visitorId);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/append-owner") {
      const { repliedId, replyText, newMessageId } = await request.json();
      const visitorId = await this.state.storage.get(`msg:${repliedId}`);
      if (visitorId) {
        const thread = await this.getThread(visitorId);
        thread.messages.push({ from: "owner", text: replyText, ts: Date.now() });
        thread.updatedAt = Date.now();
        await this.state.storage.put(`thread:${visitorId}`, thread);
        // Map your reply's message id to the visitor too, so the conversation
        // can continue if they reply to your reply.
        if (newMessageId != null) {
          await this.state.storage.put(`msg:${newMessageId}`, visitorId);
        }
      }
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    if (url.pathname === "/messages" && request.method === "GET") {
      return handleGetMessages(url, env, origin);
    }

    if (url.pathname === "/" && request.method === "POST") {
      return handleSubmit(request, env, origin);
    }

    return json({ error: "Not found" }, 404, origin);
  },
};
