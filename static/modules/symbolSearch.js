/* ======================================================================
   symbolSearch.js — TradingView-style symbol picker for a pane
   ----------------------------------------------------------------------
   Replaces the fixed symbol dropdown with a type-ahead box backed by the
   backend /api/search endpoint. Empty query shows the source's curated
   default symbols (so the pane always has something, even if search is
   down — the chosen fallback behaviour). Selecting a result sets
   pane.symbol and reloads the pane.
   ====================================================================== */

import { fetchSearch } from "./api.js";
import { SOURCES, saveState } from "./state.js";
import { debounce } from "./util.js";

export function attachSymbolPicker(pane) {
  const input = pane.symbolInput;
  const results = pane.symbolResults;
  if (!input || !results) return;

  const meta = () => SOURCES.find(s => s.name === pane.source) || {};

  function close() { results.hidden = true; results.innerHTML = ""; }

  function choose(sym) {
    sym = (sym || "").trim();
    if (!sym) return;
    input.value = sym;
    pane.symbol = sym;
    close();
    pane.reloadPane();
    saveState();
  }

  function render(items) {
    results.innerHTML = "";
    if (!items || !items.length) { close(); return; }
    items.slice(0, 30).forEach(it => {
      const row = document.createElement("div");
      row.className = "symbol-result";
      const sym = document.createElement("span"); sym.className = "sr-sym"; sym.textContent = it.symbol;
      const lbl = document.createElement("span"); lbl.className = "sr-label"; lbl.textContent = it.label || "";
      const exch = document.createElement("span"); exch.className = "sr-exch"; exch.textContent = it.exchange || "";
      row.appendChild(sym); row.appendChild(lbl); row.appendChild(exch);
      // mousedown (not click) so it fires before the input's blur closes the list
      row.addEventListener("mousedown", (e) => { e.preventDefault(); choose(it.symbol); });
      results.appendChild(row);
    });
    results.hidden = false;
  }

  const defaultsAsItems = () =>
    (meta().symbols || []).map(s => ({ symbol: s, label: "", exchange: "" }));

  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { render(defaultsAsItems()); return; }                 // curated fallback
    if (meta().searchable === false) {
      render((meta().symbols || [])
        .filter(s => s.toLowerCase().includes(q.toLowerCase()))
        .map(s => ({ symbol: s })));
      return;
    }
    const wantSource = pane.source;
    try {
      const items = await fetchSearch(pane.source, q);
      if (pane.destroyed || pane.source !== wantSource) return;    // stale response guard
      render(items);
    } catch (_) {
      render(defaultsAsItems());                                   // search down -> defaults
    }
  }, 220);

  input.addEventListener("focus", run);
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = results.querySelector(".symbol-result .sr-sym");
      choose(first ? first.textContent : input.value);
    } else if (e.key === "Escape") {
      close(); input.blur();
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("click", (e) => e.stopPropagation());
  results.addEventListener("click", (e) => e.stopPropagation());
}
