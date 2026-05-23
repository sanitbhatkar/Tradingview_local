/* ======================================================================
   marketStatus.js — NYSE + NSE open/closed badges (timezone-aware)
   ----------------------------------------------------------------------
   Hours only, not holiday-aware. Crypto (Hyperliquid) is 24/7 and has its
   own badge driven by the websocket connection state.
   ====================================================================== */

function marketOpen(tz, openMin, closeMin) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value;
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0;                       // some engines emit 24 at midnight
  const mins = hh * 60 + parseInt(get("minute"), 10);
  const weekday = !["Sat", "Sun"].includes(get("weekday"));
  return weekday && mins >= openMin && mins < closeMin;
}

function setMarketBadge(id, open, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("open", "closed");
  el.classList.add(open ? "open" : "closed");
  el.lastChild.textContent = ` ${label} ${open ? "open" : "closed"}`;
}

export function updateMarketStatus() {
  setMarketBadge("usStatus", marketOpen("America/New_York", 9 * 60 + 30, 16 * 60), "US market");
  setMarketBadge("inStatus", marketOpen("Asia/Kolkata", 9 * 60 + 15, 15 * 60 + 30), "IN market");
}
