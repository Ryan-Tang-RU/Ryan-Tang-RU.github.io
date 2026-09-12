/* The entities offered on the first screen, grouped by the same type names the
   filter checkboxes use, so a reader who clicks "INS" here and later unticks
   "Gene" over there knows why it vanished.

   Each `q` is put through the ordinary search and the top hit is taken, so a
   label that resolves to the wrong entity is a silent lie - searching
   "Abatacept" returns the gene ABAT, not the drug. Every q below was checked
   against the live index; tests/test_semantics.py re-checks them, because the
   index changes whenever the corpus is rebuilt.

   `label` and `q` differ where the stored name is not what a reader would type:
   rs2476601 is stored under its HGVS spelling c.1858C>T. */
window.T1D_SEEDS = [
  { type: "Disease", items: [
    { label: "type 1 diabetes", q: "Diabetes Mellitus Type 1" },
    { label: "type 2 diabetes", q: "Diabetes Mellitus Type 2" },
    { label: "ketoacidosis", q: "Diabetic Ketoacidosis" },
    { label: "celiac disease", q: "Celiac Disease" },
    { label: "kidney disease", q: "Diabetic Nephropathies" }]},
  { type: "Gene", items: [
    { label: "INS", q: "INS" },
    { label: "HLA-DQB1", q: "HLA-DQB1" },
    { label: "PTPN22", q: "PTPN22" },
    { label: "CTLA4", q: "CTLA4" },
    { label: "GAD2", q: "GAD2" }]},
  { type: "Chemical", items: [
    { label: "insulin", q: "Insulin" },
    { label: "teplizumab", q: "teplizumab" },
    { label: "metformin", q: "Metformin" },
    { label: "streptozocin", q: "Streptozocin" },
    { label: "vitamin D", q: "Vitamin D" }]},
  { type: "Variant", items: [
    { label: "rs2476601", q: "rs2476601" },
    { label: "rs231775", q: "rs231775" },
    { label: "rs1990760", q: "rs1990760" }]}
];
