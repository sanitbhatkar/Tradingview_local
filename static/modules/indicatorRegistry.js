/* ======================================================================
   indicatorRegistry.js — discover + load indicator modules
   ----------------------------------------------------------------------
   Asks the backend which indicator files exist, dynamically import()s
   each, and exposes the loaded defs. No central registry to maintain:
   drop a file in static/indicators/ and it appears here automatically.
   ====================================================================== */

import { fetchIndicatorList } from "./api.js";

export let INDICATOR_DEFS = [];     // sorted [def, ...]  (live binding)
export const DEF_BY_ID = new Map(); // id -> def

export async function loadIndicators() {
  let files = [];
  try {
    files = await fetchIndicatorList();
  } catch (e) {
    console.warn("[indicators] could not list modules", e);
    return;
  }

  const defs = [];
  await Promise.all(files.map(async (file) => {
    try {
      const mod = await import(`/static/indicators/${file}`);
      const def = mod.default;
      if (def && def.id && typeof def.compute === "function") {
        def._file = file;
        defs.push(def);
      } else {
        console.warn(`[indicators] "${file}" has no valid default export`);
      }
    } catch (e) {
      console.warn(`[indicators] failed to load "${file}"`, e);
    }
  }));

  defs.sort((a, b) =>
    (a.category || "").localeCompare(b.category || "") ||
    (a.name || a.id).localeCompare(b.name || b.id));

  INDICATOR_DEFS = defs;
  DEF_BY_ID.clear();
  defs.forEach(d => DEF_BY_ID.set(d.id, d));
  console.log(`[indicators] loaded ${defs.length}`);
}
