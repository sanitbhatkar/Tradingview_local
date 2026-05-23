/* ======================================================================
   grid.js — build and reshape the pane grid
   ----------------------------------------------------------------------
   Owns the CSS grid layout class and the create/destroy of panes when the
   chart count changes. Destroying panes goes through Pane.destroy() so
   nothing leaks between layouts.
   ====================================================================== */

import { PANES, STATE, SOURCES, saveState } from "./state.js";
import { Pane } from "./pane.js";

export function setGridLayout(count) {
  document.getElementById("grid").className = `grid grid-${count}`;
}

export function rebuildGrid(count) {
  while (PANES.length) PANES.pop().destroy();        // explicit lifecycle teardown
  setGridLayout(count);
  const saved = STATE.panes || [];
  for (let i = 0; i < count; i++) {
    PANES.push(new Pane(saved[i] || defaultPaneConfig(i)));
  }
  saveState();
}

function defaultPaneConfig(i) {
  const src = SOURCES[i % SOURCES.length];
  return { source: src.name, symbol: src.symbols[0], timeframe: src.timeframes[0], indicators: [] };
}
