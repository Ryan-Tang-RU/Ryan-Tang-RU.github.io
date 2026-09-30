/* Relation types: one place that decides their colour and their order.

   Both the connection list and the evidence panel drew these chips, and both had
   their own copy of the polarity test. They also listed them by count, which put
   "Association" - the type that says only that two things were discussed together -
   ahead of the two that say which way the finding went. A reader scanning an edge
   wants the signed claims first. */
window.T1DRel = (function () {
  const POLARITY = { Positive_Correlation: "pos", Negative_Correlation: "neg" };
  // Signed first, then the undirected ones, each group keeping the caller's order,
  // which is by count. Bind and Cotreatment are not signed, but they do name a
  // mechanism, so they sit above the bare association.
  const RANK = { Positive_Correlation: 0, Negative_Correlation: 1, Bind: 2,
                 Drug_Interaction: 3, Cotreatment: 4, Comparison: 5,
                 Association: 9 };

  function polarity(type) { return POLARITY[type] || "neutral"; }
  function rank(type) { return RANK[type] === undefined ? 6 : RANK[type]; }

  // A stable sort: equal ranks stay in the order they arrived, so a count
  // ordering inside a group survives.
  function order(list, typeOf) {
    const get = typeOf || (x => x);
    return list.map((x, i) => [x, i])
      .sort((a, b) => (rank(get(a[0])) - rank(get(b[0]))) || (a[1] - b[1]))
      .map(p => p[0]);
  }

  return { polarity, rank, order };
})();
