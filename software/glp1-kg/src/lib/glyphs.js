/* Entity type to colour and shape.

   The four coloured types are validated as a categorical palette: lightness band,
   chroma floor, CVD separation (OKLab dE >= 8, min of protan and deutan),
   normal-vision floor (>= 15) and 3:1 contrast against the surface, checked on ALL
   pairs because in a node-link diagram any two colours can end up adjacent. Nine
   types cannot pass all-pairs at any stepping, so the rest fold into one grey and
   type is also carried by shape, which keeps identity off colour alone. */
window.T1DGlyphs = (function () {
  const SLOT = { Gene: "gene", Disease: "disease", Chemical: "chemical",
                 Species: "species" };
  const SHAPE = { Gene: "circle", Disease: "square", Chemical: "diamond",
                  Species: "triangle" };
  const cssVar = n =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function color(type) { return cssVar("--t-" + (SLOT[type] || "other")); }
  function path(type, r) {
    switch (SHAPE[type] || "dot") {
      case "square":   return "M" + (-r) + "," + (-r) + "h" + 2 * r + "v" + 2 * r + "h" + (-2 * r) + "z";
      case "diamond":  return "M0," + (-r * 1.3) + "L" + r * 1.3 + ",0L0," + r * 1.3 + "L" + (-r * 1.3) + ",0Z";
      case "triangle": return "M0," + (-r * 1.3) + "L" + r * 1.15 + "," + r + "L" + (-r * 1.15) + "," + r + "Z";
      case "dot":      return "M0," + (-r * 0.7) + "a" + r * 0.7 + "," + r * 0.7 + " 0 1,0 .01,0z";
      default:         return "M0," + (-r) + "a" + r + "," + r + " 0 1,0 .01,0z";
    }
  }
  const TYPES = ["Gene", "Disease", "Chemical", "Species", "Variant", "CellLine",
                 "Chromosome", "RefSeq", "GenomicRegion"];
  return { color, path, cssVar, TYPES };
})();
