/* The entities offered on the first screen, grouped by the same type names the
   filter checkboxes use, so a reader who clicks "GLP1R" here and later unticks
   "Gene" over there knows why it vanished.

   Each `q` is put through the ordinary search and the top hit is taken, so a
   label that resolves to the wrong entity is a silent lie. Every q below was
   checked against this corpus' index; tests/test_semantics.py re-checks them,
   because the index changes whenever the corpus is rebuilt.

   Semaglutide and tirzepatide are here, and they did not come from PubTator:
   its entity list does not contain them, so src/s2d_drugs.py matched the names
   against the same passage text. Those nodes carry co-mention edges and no
   extracted assertions, and the panel says so when one is opened. Offering them
   anyway, because a GLP-1 graph whose first screen omits the two drugs the field
   is about teaches the reader something false about the field. */
window.T1D_SEEDS = [
  { type: "Disease", items: [
    { label: "type 2 diabetes", q: "Diabetes Mellitus Type 2" },
    { label: "obesity", q: "Obesity" },
    { label: "weight loss", q: "Weight Loss" },
    { label: "insulin resistance", q: "Insulin Resistance" },
    { label: "heart failure", q: "Heart Failure" }]},
  { type: "Gene", items: [
    { label: "GLP1R", q: "GLP1R" },
    { label: "GCG", q: "GCG" },
    { label: "INS", q: "INS" },
    { label: "GIP", q: "GIP" },
    { label: "DPP4", q: "DPP4" }]},
  { type: "Chemical", items: [
    { label: "semaglutide", q: "Semaglutide" },
    { label: "tirzepatide", q: "Tirzepatide" },
    { label: "liraglutide", q: "Liraglutide" },
    { label: "exenatide", q: "Exenatide" },
    { label: "metformin", q: "Metformin" }]},
  { type: "Variant", items: [
    { label: "rs6923761", q: "rs6923761" },
    { label: "rs7903146", q: "rs7903146" }]}
];
