import { useCallback, useEffect, useRef, useState } from "react";

const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.74v20.52C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.74V1.74C24 .78 23.2 0 22.22 0z" />
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.21.7.82.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
  </svg>
);

const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M23.95 4.57l-3.62 17.09c-.27 1.2-.99 1.5-2 .93l-5.52-4.07-2.66 2.56c-.3.3-.55.55-1.12.55l.4-5.65L19.4 6.18c.45-.4-.1-.62-.7-.22L6.4 13.7.78 11.94c-1.22-.38-1.24-1.22.26-1.8L22.37 2.8c1.02-.38 1.9.23 1.58 1.77z" />
  </svg>
);

// URL of the Cloudflare Worker that relays feedback to the Telegram group.
// Override per-environment with VITE_FEEDBACK_URL.
const FEEDBACK_URL = "https://bot.usdebt.watch";

// Stable per-browser id used to privately match a reply back to this visitor.
// Read the persisted id without creating one. Returns null until the visitor
// has sent their first message.
function getVisitorId() {
  return localStorage.getItem("visitorId");
}

// Create the visitor id on first use (the first feedback message) and persist
// it for future replies. Subsequent calls return the same id.
function getOrCreateVisitorId() {
  let id = localStorage.getItem("visitorId");
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    id = btoa(String.fromCharCode(...bytes));
    localStorage.setItem("visitorId", id);
  }
  return id;
}

// Short two-tone chime via Web Audio, so no asset file is needed.
function playReplySound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {
    // ignore audio failures
  }
}

// Turn a fetch failure into a more useful, debuggable message.
// Browsers hide low-level network codes (e.g. net::ERR_NAME_NOT_RESOLVED)
// from JS: a network-layer failure always surfaces as "TypeError: Failed
// to fetch" with no detail. We can still narrow it down from context.
function describeFetchError(err) {
  // Server errors already carry a status/body message (thrown above).
  if (err instanceof Error && !(err instanceof TypeError)) {
    return err.message;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You appear to be offline. Check your internet connection.";
  }
  // TypeError from fetch: DNS failure, connection refused, CORS, or the
  // host being unreachable. The browser does not expose which one.
  return "Could not reach the server.";
}

function SuggestionBox() {
  const [name, setName] = useState(() => localStorage.getItem("visitorName") || "");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | error
  const [errorDetail, setErrorDetail] = useState("");
  const [messages, setMessages] = useState([]);
  const threadRef = useRef(null);
  // Number of owner replies last seen; used to detect new ones for the sound.
  // null until the first thread load completes, so existing replies (and a
  // remount/hot-reload that repopulates the thread) don't chime.
  const ownerCountRef = useRef(null);

  // Play a chime when a new owner reply arrives (not on the first load).
  useEffect(() => {
    // Wait for the initial thread to load before establishing a baseline.
    // The first render has an empty `messages`, so treating that as the
    // baseline would make the subsequent load look like new replies.
    if (messages.length === 0) return;
    const ownerCount = messages.filter((m) => m.from === "owner").length;
    if (ownerCountRef.current === null) {
      ownerCountRef.current = ownerCount;
      return;
    }
    if (ownerCount > ownerCountRef.current) playReplySound();
    ownerCountRef.current = ownerCount;
  }, [messages]);

  // Fetch the latest thread from the Worker. No-op until the visitor has an id
  // (i.e. has sent their first message).
  const refresh = useCallback(async () => {
    const visitorId = getVisitorId();
    if (!visitorId) return;
    try {
      const resp = await fetch(
        `${FEEDBACK_URL}/messages?visitor_id=${encodeURIComponent(visitorId)}`
      );
      const data = await resp.json();
      if (Array.isArray(data.messages)) {
        // Never let a lagging server response drop optimistic local messages.
        setMessages((local) =>
          data.messages.length >= local.length ? data.messages : local
        );
      }
    } catch {
      // ignore transient errors
    }
  }, []);

  // Load the existing thread once on mount, but only for returning visitors
  // who already have an id. New visitors get one when they first send.
  useEffect(() => {
    if (getVisitorId()) refresh();
  }, [refresh]);

  // Poll only while we're waiting on a reply: i.e. the latest message is from
  // the visitor. Poll every 3s for the first minute after that message, then
  // every 10s. Don't poll at all before the first message or once the owner
  // has replied.
  const last = messages[messages.length - 1];
  useEffect(() => {
    if (last?.from !== "visitor") return;
    const fast = Date.now() - (last.ts ?? 0) < 60000;
    const id = setInterval(refresh, fast ? 3000 : 10000);
    return () => clearInterval(id);
  }, [refresh, last?.from, last?.ts]);

  // Keep the thread scrolled to the latest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim() || status === "sending") return;
    if (messages.length === 0 && !name.trim()) return;
    setStatus("sending");

    const visitorId = getOrCreateVisitorId();
    const text = message.trim();
    const visitorName = name.trim();
    if (visitorName) localStorage.setItem("visitorName", visitorName);
    // Optimistically show the message right away.
    const optimistic = { from: "visitor", text, ts: Date.now() };
    setMessages((m) => [...m, optimistic]);
    setMessage("");

    try {
      const resp = await fetch(FEEDBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_id: visitorId,
          name: visitorName,
          message: text,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(
          `Server responded ${resp.status} ${resp.statusText}` +
            (body ? `: ${body.slice(0, 200)}` : "")
        );
      }
      const data = await resp.json();
      if (Array.isArray(data.messages)) setMessages(data.messages);
      setStatus("idle");
    } catch (err) {
      // Purge the optimistic message from the local cache so it reflects
      // the server, and restore the text so the visitor can retry.
      setMessages((m) => m.filter((msg) => msg !== optimistic));
      setMessage(text);
      setErrorDetail(describeFetchError(err));
      setStatus("error");
    }
  }

  return (
    <div className="suggestion-box">
      <div className="suggestion-title">Suggestions & feedback</div>
      <div className="suggestion-chat">
        {messages.length > 0 && (
          <div className="suggestion-thread" ref={threadRef}>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`chat-line ${
                  m.from === "owner" ? "chat-line-owner" : "chat-line-visitor"
                }`}
              >
                <span className="chat-prefix">
                  {m.from === "owner" ? "Nico" : name || "You"}&gt;
                </span>{" "}
                {m.text}
              </div>
            ))}
            {messages[messages.length - 1]?.from === "visitor" && (
              <div className="chat-awaiting">Nico will respond soon</div>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className={`suggestion-row${messages.length === 0 ? " suggestion-row-initial" : ""}`}>
            {messages.length === 0 && (
              <input
                type="text"
                className="name-input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (status === "error") setStatus("idle");
                }}
                placeholder="Your name"
                maxLength={60}
              />
            )}
            <input
              type="text"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              placeholder={messages.length > 0 ? "" : "Message"}
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={
                status === "sending" ||
                !message.trim() ||
                (messages.length === 0 && !name.trim())
              }
            >
              {status === "sending" ? "Sending…" : "Send"}
            </button>
          </div>
          {status === "error" && (
            <span className="suggestion-status suggestion-error">
              Something went wrong. Please try again.
              {errorDetail ? ` (${errorDetail})` : ""}
            </span>
          )}
        </form>
      </div>
    </div>
  );
}

export default function ChatFooter() {
  return (
    <div className="footer-area">
      <SuggestionBox />

      <footer className="site-footer">
        <span>Made by Nicolas Viennot</span>
        <span className="footer-links">
          <a href="https://www.linkedin.com/in/nviennot" target="_blank" rel="noreferrer" aria-label="LinkedIn"><LinkedInIcon /></a>
          <a href="https://github.com/nviennot" target="_blank" rel="noreferrer" aria-label="GitHub"><GitHubIcon /></a>
          <a href="https://t.me/nviennot" target="_blank" rel="noreferrer" aria-label="Telegram"><TelegramIcon /></a>
        </span>
      </footer>
    </div>
  );
}
