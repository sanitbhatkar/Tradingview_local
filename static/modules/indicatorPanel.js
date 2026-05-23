/* ======================================================================
   indicatorPanel.js — the TradingView-style search panel per pane
   ----------------------------------------------------------------------
   Renders the indicator list with a search box; toggling a checkbox
   adds/removes the indicator on that pane via the engine. Pure UI; it
   reads the registry and calls the engine, nothing else.
   ====================================================================== */

import { INDICATOR_DEFS } from "./indicatorRegistry.js";
import { addIndicator, removeIndicator } from "./indicatorEngine.js";
import { PANES, saveState } from "./state.js";

export function buildPanel(pane) {
  const p = pane.panelEl;
  p.innerHTML = "";

  const search = document.createElement("div");
  search.className = "ind-search";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search indicators…";
  input.oninput = () => renderIndList(pane);
  input.onclick = (e) => e.stopPropagation();
  search.appendChild(input);
  p.appendChild(search);

  const list = document.createElement("div");
  list.className = "ind-list";
  p.appendChild(list);

  pane.panelInput = input;
  pane.panelList = list;
  renderIndList(pane);
}

export function renderIndList(pane) {
  const list = pane.panelList;
  if (!list) return;
  const q = (pane.panelInput.value || "").trim().toLowerCase();
  list.innerHTML = "";

  const matches = INDICATOR_DEFS.filter(def =>
    !q ||
    (def.name || def.id).toLowerCase().includes(q) ||
    (def.category || "").toLowerCase().includes(q));

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "ind-empty";
    empty.textContent = INDICATOR_DEFS.length ? "No matches" : "No indicators found";
    list.appendChild(empty);
    return;
  }

  let lastCat = null;
  matches.forEach(def => {
    if (def.category && def.category !== lastCat) {
      lastCat = def.category;
      const title = document.createElement("div");
      title.className = "ind-group-title";
      title.textContent = def.category;
      list.appendChild(title);
    }
    const active = pane.activeIndicators.includes(def.id);
    const row = document.createElement("label");
    row.className = "ind-row" + (active ? " active" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.dataset.id = def.id; cb.checked = active;
    cb.onchange = () => {
      if (cb.checked) addIndicator(pane, def.id);
      else removeIndicator(pane, def.id);
      row.classList.toggle("active", cb.checked);
      saveState();
    };
    const sw = document.createElement("span");
    sw.className = "ind-swatch"; sw.style.background = def.swatch || "#787b86";
    const txt = document.createElement("span");
    txt.textContent = def.name || def.id;
    row.appendChild(cb); row.appendChild(sw); row.appendChild(txt);
    list.appendChild(row);
  });
}

export function syncPanelChecks(pane) {
  renderIndList(pane);
}

export function togglePanel(pane) {
  const willOpen = pane.panelEl.hidden;
  PANES.forEach(p => { if (p !== pane) { p.panelEl.hidden = true; p.indBtn.classList.remove("active"); } });
  pane.panelEl.hidden = !willOpen;
  pane.indBtn.classList.toggle("active", willOpen);
  if (willOpen && pane.panelInput) {
    pane.panelInput.value = "";
    renderIndList(pane);
    setTimeout(() => pane.panelInput.focus(), 0);
  }
}

// Click anywhere outside a panel closes all open panels. Installed once.
export function installPanelGlobalClose() {
  document.addEventListener("click", () => {
    PANES.forEach(p => { p.panelEl.hidden = true; p.indBtn.classList.remove("active"); });
  });
}
