/* The entities offered on the first screen, grouped by the same type names the
   filter checkboxes use, so a reader who clicks "GLP1R" here and later unticks
   "Gene" over there knows why it vanished.

   Each `q` is put through the ordinary search and the top hit is taken, so a
   label that resolves to the wrong entity is a silent lie. Every q below was
   checked against this corpus' index; tests/test_semantics.py re-checks them,
   because the index changes whenever the corpus is rebuilt.

   Not offered, deliberately: semaglutide, tirzepatide, liraglutide. They are the
   drugs this field is about and they are not entities in this graph. PubTator
   tagged semaglutide once in the 5,068 abstracts that write it, liraglutide
   three times in 5,272, tirzepatide never in 2,270. Searching for them reaches
   the abstract word counts instead, which says so. Exenatide is here because it
   is the one GLP-1 receptor agonist with a MeSH descriptor old enough to be
   tagged throughout. */
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
    { label: "exenatide", q: "Exenatide" },
    { label: "metformin", q: "Metformin" },
    { label: "sitagliptin", q: "Sitagliptin Phosphate" },
    { label: "glucose", q: "Glucose" },
    { label: "streptozocin", q: "Streptozocin" }]},
  { type: "Variant", items: [
    { label: "rs6923761", q: "rs6923761" },
    { label: "rs7903146", q: "rs7903146" }]}
];
