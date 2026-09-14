/* Outbound links, keyed on the identifier scheme PubTator actually returns:
   NCBI Gene numbers, MESH: and OMIM: prefixes, NCBI taxids, Cellosaurus CVCL ids and
   dbSNP rs numbers. PanKbase gene pages follow the HuGeAMP pattern
   (pankbase.org/gene.html?gene=SYMBOL), verified to resolve. */
window.T1DLinks = function entityLinks(node) {
  const out = [];
  const id = node.id || "";
  const enc = encodeURIComponent;
  if (node.type === "Gene") {
    const first = id.split(";")[0];
    if (/^\d+$/.test(first))
      out.push(["NCBI Gene", "https://www.ncbi.nlm.nih.gov/gene/" + first]);
    if (node.gene_symbol) {
      out.push(["PanKbase", "https://pankbase.org/gene.html?gene=" + enc(node.gene_symbol)]);
      out.push(["GeneCards", "https://www.genecards.org/cgi-bin/carddisp.pl?gene=" + enc(node.gene_symbol)]);
    }
    if (node.ensembl_gene_id)
      out.push(["Ensembl", "https://ensembl.org/Homo_sapiens/Gene/Summary?g=" + node.ensembl_gene_id]);
  } else if (node.type === "Disease" || node.type === "Chemical") {
    const mesh = id.match(/^MESH:([CD]\d+)$/);
    if (mesh) out.push(["MeSH", "https://meshb.nlm.nih.gov/record/ui?ui=" + mesh[1]]);
    const omim = id.match(/^OMIM:(\d+)$/);
    if (omim) out.push(["OMIM", "https://omim.org/entry/" + omim[1]]);
  } else if (node.type === "Species" && /^\d+$/.test(id)) {
    out.push(["NCBI Taxonomy",
      "https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=" + id]);
  } else if (node.type === "CellLine") {
    const cvcl = id.match(/^CVCL:(\S+)$/);
    if (cvcl) out.push(["Cellosaurus", "https://www.cellosaurus.org/CVCL_" + cvcl[1]]);
  } else if (node.type === "Variant") {
    const rs = id.match(/^rs(\d+)/) || id.match(/RS#:?(\d+)/);
    if (rs) {
      out.push(["dbSNP", "https://www.ncbi.nlm.nih.gov/snp/rs" + rs[1]]);
      out.push(["LitVar", "https://www.ncbi.nlm.nih.gov/research/litvar2/docsum?text=rs" + rs[1]]);
    }
  }
  return out;
};
