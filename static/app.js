/* ======================================================================
   app.js — application entry point (ES module)
   ----------------------------------------------------------------------
   This used to be a 700-line "god file". It is now a thin bootstrap that
   wires the modules together. Everything lives under static/modules/:

     core      state.js  util.js  validate.js  api.js
     services  indicatorRegistry.js  hyperliquid.js  marketStatus.js  ticker.js
     charts    pane.js  grid.js  indicatorEngine.js  indicatorPanel.js

   Loaded as <script type="module">, so imports resolve natively in the
   browser — no bundler or build step.
   ====================================================================== */

import { setSources, STATE } from "./modules/state.js";
import { fetchSources } from "./modules/api.js";
import { loadIndicators } from "./modules/indicatorRegistry.js";
import { HL } from "./modules/hyperliquid.js";
import { updateMarketStatus } from "./modules/marketStatus.js";
import { rebuildGrid } from "./modules/grid.js";
import { installPanelGlobalClose } from "./modules/indicatorPanel.js";

async function boot() {
  const grid = document.getElementById("grid");

  // 1) data sources
  let sources = [];
  try {
    sources = await fetchSources();
  } catch (e) {
    grid.innerHTML = '<p style="padding:24px;color:#787b86">Could not reach the backend. Is <code>python app.py</code> running?</p>';
    console.error("[boot] /api/sources failed", e);
    return;
  }
  if (!sources.length) {
    grid.innerHTML = '<p style="padding:24px;color:#787b86">No data sources available.</p>';
    return;
  }
  setSources(sources);

  // 2) discover + import indicator modules before any pane is built
  await loadIndicators();

  // 3) market badges + click-to-close for indicator panels
  updateMarketStatus();
  setInterval(updateMarketStatus, 30000);
  installPanelGlobalClose();

  // 4) chart-count selector (persisted)
  const countSel = document.getElementById("chartCount");
  countSel.value = String(STATE.count || 4);
  countSel.onchange = () => rebuildGrid(parseInt(countSel.value, 10));

  // 5) connect the shared crypto socket + build the grid
  HL.connect();
  rebuildGrid(parseInt(countSel.value, 10));
}

boot();
