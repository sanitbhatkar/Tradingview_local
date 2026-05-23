/* ======================================================================
   ticker.js — the colour-coded price bar on each pane
   ----------------------------------------------------------------------
   Flashes green/red on every price change and shows change-from-open.
   Operates on a pane instance's DOM + bookkeeping fields.
   ====================================================================== */

import { formatPrice } from "./util.js";

export function updateTicker(pane, price) {
  if (price == null || !isFinite(price)) return;
  const dir = pane.prevPrice == null ? 0 : Math.sign(price - pane.prevPrice);
  pane.prevPrice = price;

  let chgStr = "";
  if (pane.refOpen) {
    const diff = price - pane.refOpen;
    const pct = (diff / pane.refOpen) * 100;
    const sign = diff >= 0 ? "+" : "";
    chgStr = `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
  }
  setTicker(pane, pane.symbol, price, dir, chgStr);
}

export function setTicker(pane, sym, price, dir, chgStr) {
  const t = pane.node.querySelector(".ticker");
  if (!t) return;
  pane.node.querySelector(".ticker-sym").textContent = sym;
  pane.node.querySelector(".ticker-price").textContent = price == null ? "--" : formatPrice(price);
  pane.node.querySelector(".ticker-chg").textContent = chgStr || "";
  if (dir === 0 || dir == null) return;
  t.classList.remove("ticker-up", "ticker-down");
  t.classList.add(dir > 0 ? "ticker-up" : "ticker-down");
  clearTimeout(pane.flashTimer);
  pane.flashTimer = setTimeout(() => t.classList.remove("ticker-up", "ticker-down"), 600);
}
