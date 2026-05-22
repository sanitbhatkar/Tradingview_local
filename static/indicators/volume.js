// Volume histogram in its own sub-pane, coloured green/red by candle direction.
function compute(c) {
  return c.map(x => ({
    time: x.time,
    value: x.volume || 0,
    color: x.close >= x.open ? "rgba(38,166,154,0.5)" : "rgba(239,83,80,0.5)",
  }));
}

export default {
  id: "volume",
  name: "Volume",
  category: "Volume",
  swatch: "#787b86",
  type: "lower",
  hasHist: true,
  histFormat: { type: "volume" },
  styles: { lines: {} },
  compute: c => ({ hist: compute(c) }),
};
