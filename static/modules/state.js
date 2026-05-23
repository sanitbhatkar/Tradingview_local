/* ======================================================================
   state.js — the single place app-wide state lives
   ----------------------------------------------------------------------
   Keeps the moving pieces (data sources, live panes, persisted settings)
   in one module instead of scattered globals, and owns versioned, fault-
   tolerant persistence (#13). Other modules import these live bindings.
   ====================================================================== */

const LS_KEY = "mcd:v2:state";   // bumped from v1 -> v2 (added `version`)
const VERSION = 2;

// ---- data sources (filled once at boot) -------------------------------
export let SOURCES = [];
export function setSources(list) { SOURCES = Array.isArray(list) ? list : []; }

// ---- live panes (mutated in place; never reassigned) ------------------
export const PANES = [];

// ---- persisted settings -----------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === VERSION && typeof s.count === "number" && Array.isArray(s.panes)) {
        return s;
      }
      console.warn("[state] discarding incompatible saved layout (version mismatch)");
    }
  } catch (e) {
    console.warn("[state] saved layout unreadable, starting fresh", e);
  }
  return { version: VERSION, count: 4, panes: [] };
}

export const STATE = loadState();

// Snapshot the current panes into STATE and persist. Never throws.
export function saveState() {
  try {
    STATE.version = VERSION;
    STATE.count = PANES.length;
    STATE.panes = PANES.map(p => ({
      source: p.source,
      symbol: p.symbol,
      timeframe: p.timeframe,
      indicators: [...p.activeIndicators],
    }));
    localStorage.setItem(LS_KEY, JSON.stringify(STATE));
  } catch (e) {
    console.warn("[state] could not persist layout", e);
  }
}
