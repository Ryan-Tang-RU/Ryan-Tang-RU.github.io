/* The query behind the current view, for the drawer.

   The local build shows Cypher because a Neo4j server answered it. Here the same
   panels are answered by SQL running in the browser, so the drawer shows that -
   the query that actually ran, not a translation of it into a language nothing
   here speaks. The names match the local build's so the store is unchanged. */
const fill = (name, params) => {
  const sql = (window.T1DSQL || {})[name] || "";
  return "-- " + name + "\n"
    + sql.replace(/\$(\w+)/g, (_, k) =>
        (k in params
          ? (typeof params[k] === "string" ? "'" + params[k] + "'" : params[k])
          : "$" + k)).trim();
};

window.T1DCypher = {
  neighbours: (eid, y0, y1) =>
    fill("neighbours", { eid: eid, y0: y0, y1: y1, minc: 3, limit: 30,
                         ex: "", types: "NULL" }),
  path: (a, b, hops, avoidHubs) =>
    fill("bfs_step", { frontier: a, seen: a, avoid: avoidHubs ? "<hubs>" : "",
                       y0: 1960, y1: 2025, minc: 3 })
    + "\n\n-- walked " + (hops || 4) + " hops from " + a + " to " + b,
  evidence: (a, b, y0, y1) =>
    fill("evidence_sentences", { a: a, b: b, y0: y0, y1: y1, scan: 400 }),
};
