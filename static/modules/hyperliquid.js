/* ======================================================================
   hyperliquid.js — one shared, ref-counted, auto-reconnecting websocket
   ----------------------------------------------------------------------
   All crypto panes multiplex over a single Hyperliquid socket keyed by
   (coin, interval). Ref counting (#12) means N panes on the same feed
   share one subscription, and the last to leave tears it down.
   ====================================================================== */

import { SOURCES } from "./state.js";

export const HL = {
  ws: null,
  ready: false,
  subs: new Map(),       // "COIN|INTERVAL" -> { refs, handlers:Set }
  reconnectMs: 1000,

  url() {
    const s = SOURCES.find(x => x.realtime && x.realtime.type === "hyperliquid_ws");
    return (s && s.realtime.url) || "wss://api.hyperliquid.xyz/ws";
  },

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    setHlStatus("connecting");
    const ws = new WebSocket(this.url());
    this.ws = ws;

    ws.onopen = () => {
      this.ready = true;
      this.reconnectMs = 1000;
      setHlStatus("live");
      for (const key of this.subs.keys()) this._send("subscribe", key);   // resubscribe on reconnect
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.channel !== "candle" || !msg.data) return;
      const d = msg.data;
      const entry = this.subs.get(`${d.s}|${d.i}`);
      if (!entry) return;
      const bar = {
        time: Math.floor(d.t / 1000),
        open: +d.o, high: +d.h, low: +d.l, close: +d.c, volume: +d.v || 0,
      };
      entry.handlers.forEach(fn => {
        try { fn(bar); } catch (e) { console.warn("[hl] handler error", e); }
      });
    };
    ws.onclose = () => {
      this.ready = false;
      setHlStatus("down");
      setTimeout(() => this.connect(), this.reconnectMs);
      this.reconnectMs = Math.min(this.reconnectMs * 2, 15000);          // exponential backoff
    };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  },

  _send(method, key) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const [coin, interval] = key.split("|");
    this.ws.send(JSON.stringify({ method, subscription: { type: "candle", coin, interval } }));
  },

  subscribe(coin, interval, handler) {
    const key = `${coin}|${interval}`;
    let entry = this.subs.get(key);
    if (!entry) {
      entry = { refs: 0, handlers: new Set() };
      this.subs.set(key, entry);
      this._send("subscribe", key);
    }
    entry.refs++;
    entry.handlers.add(handler);
    return () => this.unsubscribe(coin, interval, handler);
  },

  unsubscribe(coin, interval, handler) {
    const key = `${coin}|${interval}`;
    const entry = this.subs.get(key);
    if (!entry) return;
    entry.handlers.delete(handler);
    entry.refs--;
    if (entry.refs <= 0) {
      this._send("unsubscribe", key);
      this.subs.delete(key);
    }
  },
};

export function setHlStatus(kind) {
  const el = document.getElementById("hlStatus");
  if (!el) return;
  el.classList.remove("live", "down");
  if (kind === "live") { el.classList.add("live"); el.lastChild.textContent = " HL live"; }
  else if (kind === "down") { el.classList.add("down"); el.lastChild.textContent = " HL offline"; }
  else el.lastChild.textContent = " HL connecting";
}
