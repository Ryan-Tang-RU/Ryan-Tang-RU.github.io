/* The queries, in one place, as named SQL with $named parameters.

   They live here rather than inside api.js so the same strings can be run outside
   the browser: tests/test_publish_sql.py loads this file, substitutes parameters
   and executes each query against the published parquet, comparing the answers to
   the local server's. Without that, the only way to know whether a port of eleven
   endpoints is faithful would be to click through the page.

   Every table is a view over one parquet file, registered by api.js. Entity keys
   are Step 7a's canonical eids throughout. */
// Lists arrive as one string separated by chr(31), split in SQL. duckdb-wasm binds
// scalars reliably and arrays not at all, and the text has to be identical on both
// sides for tests/test_publish_sql.py to be worth anything. chr(31) rather than
// '\x1f': DuckDB's ordinary strings do not process backslash escapes, so that
// literal is four characters and nothing ever matched it.
// Every sum is cast to BIGINT. DuckDB's sum() over INTEGER returns HUGEINT, whose
// Arrow representation is four 32-bit words - which arrived in the browser as the
// array [73, 0, 0, 0] and rendered as "73,0,0,0" in the partner list, while
// Number([120,0,0,0]) is NaN and showed the corpus paper count as 0.
window.T1DSQL = {

  // ---- sentences containing a word, near an entity ---------------------
  /* Lexical retrieval, anchored. A scan of all 262,226 passages for a word would
     pull most of a 55 MB file over range requests; anchoring on an entity first
     cuts the candidates to that entity's newest papers, which `mentions` prunes
     to about one row group. It is word matching, not meaning: "aetiology" will
     not find "etiology", and the tool says so, because a reader who thinks this
     is semantic search will read absence as evidence. */
  text_search: `
    WITH cand AS (
      SELECT pmid, year FROM mentions
      WHERE eid = $eid AND year BETWEEN $y0 AND $y1
      GROUP BY 1, 2
      ORDER BY year DESC, pmid DESC
      LIMIT $scan
    )
    SELECT c.pmid, c.year, pg.text
    FROM cand c JOIN passages pg ON pg.pmid = c.pmid
    WHERE contains(lower(pg.text), $word)
    ORDER BY c.year DESC, c.pmid DESC
    LIMIT $limit`,

  // ---- how often a word occurs in the abstracts ------------------------
  // Asked only when the entity search found nothing, to separate "this graph has
  // no node for it" from "the literature does not mention it". The two look the
  // same to a reader and are not the same thing: the whole GLP-1 class is written
  // in hundreds of abstracts here and tagged in none of them.
  vocab: `
    SELECT tok, n_papers FROM vocab
    WHERE tok IN (SELECT unnest(string_split($toks, chr(31))))
    ORDER BY n_papers DESC`,

  // ---- search: names and the words people actually write ----------------
  search: `
    WITH scored AS (
      SELECT eid, type, name, n_papers, species_name, term, is_name, c,
             CASE
               WHEN norm = $q AND is_name THEN 100
               WHEN norm = $q THEN 92
               WHEN list_sort(string_split(norm, ' '))
                    = list_sort(string_split($q, ' ')) THEN 88
               WHEN starts_with(norm, $q) AND is_name THEN 84
               WHEN starts_with(norm, $q) THEN 76
               WHEN contains(norm, $q) AND is_name THEN 68
               WHEN contains(norm, $q) THEN 60
               WHEN len(list_filter(string_split($toks, chr(31)),
                        t -> NOT contains(norm, t))) = 0 THEN 52
               ELSE 40 + 10 * jaro_winkler_similarity(norm, $q)
             END AS score,
             CASE WHEN is_name THEN n_papers ELSE c END AS ev
      FROM search
      WHERE contains(norm, $q)
         OR len(list_filter(string_split($toks, chr(31)), t -> NOT contains(norm, t))) = 0
         -- A near-spelling, not a different word. At 0.88 the fallback answered
               -- "abatacept" with the gene ABAT and "tirzepatide" with Teriparatide -
               -- confidently wrong, and worse than nothing, because a reader cannot
               -- tell an approximate hit from an exact one. Real typos score far
               -- higher: teplizumb/teplizumab 0.980, metfomin/metformin 0.978,
               -- diabetis/diabetes 0.950, against 0.889 and 0.893 for those two. The
               -- length guard catches the other shape, a short name swallowed by a
               -- long query: ABAT is 4 characters against abatacept's 9.
         OR (length($q) >= 4 AND jaro_winkler_similarity(norm, $q) >= 0.92
             AND length(norm) BETWEEN length($q) * 0.75 AND length($q) * 1.34)
    ), best AS (
      SELECT eid, any_value(type) AS type, any_value(name) AS name,
             any_value(n_papers) AS n_papers,
             any_value(species_name) AS species_name,
             max(score) AS score, max(ev) AS ev,
             arg_max(term, score) AS term, arg_max(is_name, score) AS is_name
      FROM scored GROUP BY eid
    ), grouped AS (
      -- One row per name, not one per identifier. PubTator gives every species its
      -- own gene id, so "ins" matched twenty entities all shown as INS: human with
      -- 27,778 papers, then dog 160, pig 91, cattle 65, rabbit 24. The largest is
      -- the answer; the rest are a count.
      --
      -- The typed spelling wins the group only when the reader used a capital,
      -- which is the signal that the case was deliberate: "CD4" is the human gene
      -- and "Cd4" the mouse one. Applied to every query, an all-lowercase "ins"
      -- put a zebrafish gene literally named "ins" - 9 papers - first.
      SELECT *,
             row_number() OVER (PARTITION BY type, lower(name)
                                ORDER BY CASE WHEN name = $raw
                                                AND $raw <> lower($raw)
                                              THEN 0 ELSE 1 END,
                                         score DESC, ev DESC, n_papers DESC,
                                         eid) AS rn,
             count(*) OVER (PARTITION BY type, lower(name)) AS same
      FROM best
    )
    SELECT eid, type, split_part(eid, '|', 2) AS id, name, n_papers,
           CASE WHEN type = 'Species' THEN NULL ELSE species_name END AS species,
           CASE WHEN is_name THEN NULL ELSE term END AS via,
           (same - 1)::BIGINT AS others
    FROM grouped WHERE rn = 1
    ORDER BY score DESC, ev DESC, n_papers DESC, length(name), name, eid
    LIMIT $limit`,

  // ---- the neighbourhood -------------------------------------------------
  // One row per partner, weighted by papers in the window. The MIN_COMENTION
  // filter is applied per year, after canonicalisation - doing it the other way
  // round is what cost rs2476601 eleven of its partners.
  neighbours: `
    WITH e AS (
      SELECT CASE WHEN a = $eid THEN b ELSE a END AS other, year, n
      FROM pair_year
      WHERE ($eid IN (a, b)) AND year BETWEEN $y0 AND $y1 AND n >= $minc
    ), agg AS (
      SELECT other, sum(n)::BIGINT AS papers, min(year) AS y_first, max(year) AS y_last,
             count(*) AS years
      FROM e GROUP BY 1
    ), rel AS (
      SELECT CASE WHEN a = $eid THEN b ELSE a END AS other,
             count(*) AS n_relations, max(score) AS rel_score_max,
             list_distinct(list(rel)) AS relation_types
      FROM relations
      WHERE ($eid IN (a, b)) AND year BETWEEN $y0 AND $y1
      GROUP BY 1
    )
    SELECT g.other AS eid, en.type, en.name, en.n_papers AS total_papers,
           g.papers, g.y_first, g.y_last, g.years,
           coalesce(r.n_relations, 0) AS n_relations,
           r.rel_score_max,
           coalesce(r.relation_types, []) AS relation_types
    FROM agg g JOIN entities en ON en.eid = g.other
    LEFT JOIN rel r ON r.other = g.other
    WHERE NOT list_contains(string_split($ex, chr(31)), g.other)
      AND ($types IS NULL OR list_contains(string_split($types, chr(31)), en.type))
    -- Two orders, because they answer different questions: of type 1 diabetes' 30
    -- strongest partners by papers only 10 carry a relation, since the largest
    -- co-mention counts are the pair types that can never have one. By relations it
    -- is 30 of 30. eid last, so equal weights do not fall to scan order.
    ORDER BY CASE WHEN $rank = 'relations' THEN coalesce(r.n_relations, 0)
                  ELSE 0 END DESC,
             g.papers DESC, g.other
    LIMIT $limit`,

  // Per-partner distribution over relation types. The bare set of types is what
  // made a large edge look self-contradictory: INS - type 1 diabetes carries 3,916
  // Association, 2,450 Negative_Correlation and 1 Positive_Correlation.
  neighbours_dist: `
    WITH d AS (
      SELECT CASE WHEN a = $eid THEN b ELSE a END AS other, rel, count(*) AS c
      FROM relations
      WHERE ($eid IN (a, b)) AND year BETWEEN $y0 AND $y1
      GROUP BY 1, 2
    )
    SELECT other, list(rel ORDER BY c DESC)[1:4] AS types,
           list(c ORDER BY c DESC)[1:4] AS counts, sum(c)::BIGINT AS total
    FROM d GROUP BY 1`,

  neighbours_total: `
    SELECT count(DISTINCT CASE WHEN a = $eid THEN b ELSE a END) AS total
    FROM pair_year
    WHERE ($eid IN (a, b)) AND year BETWEEN $y0 AND $y1 AND n >= $minc`,

  neighbours_remaining: `
    SELECT en.type, count(DISTINCT g.other) AS n
    FROM (SELECT DISTINCT CASE WHEN a = $eid THEN b ELSE a END AS other
          FROM pair_year
          WHERE ($eid IN (a, b)) AND year BETWEEN $y0 AND $y1 AND n >= $minc) g
    JOIN entities en ON en.eid = g.other
    WHERE NOT list_contains(string_split($ex, chr(31)), g.other)
      AND ($types IS NULL OR list_contains(string_split($types, chr(31)), en.type))
    GROUP BY 1`,

  // ---- edges among a given node set --------------------------------------
  subgraph: `
    WITH pr AS (
      SELECT a, b, sum(n)::BIGINT AS papers, min(year) AS y_first, max(year) AS y_last
      FROM pair_year
      WHERE list_contains(string_split($eids, chr(31)), a) AND list_contains(string_split($eids, chr(31)), b)
        AND year BETWEEN $y0 AND $y1 AND n >= $minc
      GROUP BY 1, 2
    ), rel AS (
      SELECT a, b, count(*) AS n_relations, max(score) AS rel_score_max,
             list_distinct(list(rel)) AS relation_types
      FROM relations
      WHERE list_contains(string_split($eids, chr(31)), a) AND list_contains(string_split($eids, chr(31)), b)
        AND year BETWEEN $y0 AND $y1
      GROUP BY 1, 2
    )
    SELECT pr.a, pr.b, pr.papers, pr.y_first, pr.y_last,
           coalesce(r.n_relations, 0) AS n_relations, r.rel_score_max,
           coalesce(r.relation_types, []) AS relation_types
    FROM pr LEFT JOIN rel r ON r.a = pr.a AND r.b = pr.b`,

  // The same distribution for edges between canvas nodes. Most edges on a full
  // canvas come from the subgraph query, not from the neighbour query, so without
  // this they all read as "co-mention only".
  subgraph_dist: `
    WITH d AS (
      SELECT a, b, rel, count(*) AS c FROM relations
      WHERE list_contains(string_split($eids, chr(31)), a)
        AND list_contains(string_split($eids, chr(31)), b)
        AND year BETWEEN $y0 AND $y1
      GROUP BY 1, 2, 3
    )
    SELECT a, b, list(rel ORDER BY c DESC)[1:4] AS types,
           list(c ORDER BY c DESC)[1:4] AS counts, sum(c)::BIGINT AS total
    FROM d GROUP BY 1, 2`,

  // ---- one step of a breadth-first search --------------------------------
  // Cypher has shortestPath; DuckDB does not, and a recursive CTE over 1.8M pair
  // rows is not something to run in a browser. The frontier is expanded one hop at
  // a time instead, which is four small queries for a four-hop search.
  bfs_step: `
    WITH f AS (SELECT unnest(string_split($frontier, chr(31))) AS eid),
         seen AS (SELECT unnest(string_split($seen, chr(31))) AS eid),
         avoid AS (SELECT unnest(string_split($avoid, chr(31))) AS eid),
         step AS (
           SELECT DISTINCT
             CASE WHEN p.a IN (SELECT eid FROM f) THEN p.b ELSE p.a END AS next,
             CASE WHEN p.a IN (SELECT eid FROM f) THEN p.a ELSE p.b END AS from_eid
           FROM pair_year p
           WHERE (p.a IN (SELECT eid FROM f) OR p.b IN (SELECT eid FROM f))
             AND p.year BETWEEN $y0 AND $y1 AND p.n >= $minc)
    SELECT next, min(from_eid) AS from_eid FROM step
    WHERE next NOT IN (SELECT eid FROM seen)
      AND next NOT IN (SELECT eid FROM avoid)
    GROUP BY 1`,


  // ---- relations for one pair --------------------------------------------
  relations: `
    SELECT rel AS relation_type, year, pmid, score
    FROM relations
    WHERE a = $a AND b = $b AND year BETWEEN $y0 AND $y1
    ORDER BY score DESC, year DESC
    LIMIT $cap`,

  // The distribution over the whole pair. Counting types in the 200 rows the list
  // shows described the top of the score ranking instead: INS - type 1 diabetes has
  // 6,614 assertions, of which Positive_Correlation is 2.
  relation_summary: `
    SELECT rel AS relation_type, count(*) AS n
    FROM relations
    WHERE a = $a AND b = $b AND year BETWEEN $y0 AND $y1
    GROUP BY 1 ORDER BY n DESC, relation_type`,

  relations_total: `
    SELECT count(*) AS total FROM relations
    WHERE a = $a AND b = $b AND year BETWEEN $y0 AND $y1`,

  // Why an empty list is empty: a pair type the extractor never covers, or a
  // covered type with nothing asserted here. Species is in 0 of 262,510 relations.
  pair_type_totals: `
    SELECT least(split_part(a, '|', 1), split_part(b, '|', 1)) AS t1,
           greatest(split_part(a, '|', 1), split_part(b, '|', 1)) AS t2,
           count(*) AS n
    FROM relations GROUP BY 1, 2`,

  // ---- one entity's facts ------------------------------------------------
  node: `
    SELECT e.eid, e.type, split_part(e.eid, '|', 2) AS id, e.name,
           e.n_papers AS n_papers_corpus, e.first_year, e.last_year,
           CASE WHEN e.type = 'Species' THEN NULL ELSE e.species_name END AS species,
           e.caveat
    FROM entities e WHERE e.eid = $eid`,

  entities_by_ids: `
    SELECT eid, type, name, n_papers FROM entities
    WHERE list_contains(string_split($eids, chr(31)), eid)`,

  // Same set, with the size, ordered: the burst tool ranks by how much literature
  // is behind an entity, so "what surged" is not led by a node with four papers.
  entities_sized: `
    SELECT eid, type, name, n_papers FROM entities
    WHERE list_contains(string_split($eids, chr(31)), eid)
    ORDER BY n_papers DESC, eid`,

  // `mentions` carries the year, so this touches one file. Joining `papers` for
  // it cost about 320 ms of HTTP round trips on every entity opened.
  node_window: `
    SELECT count(DISTINCT pmid) AS n
    FROM mentions
    WHERE eid = $eid AND year BETWEEN $y0 AND $y1`,

  node_partners: `
    SELECT count(DISTINCT CASE WHEN a = $eid THEN b ELSE a END) AS n
    FROM pair_year WHERE ($eid IN (a, b)) AND year BETWEEN $y0 AND $y1`,

  // What text actually produced this node. The cheapest defence against a wrong
  // normalisation: NOD resolves to Myoclonic Epilepsies, A1C to a substitution.
  node_forms: `
    SELECT text, count(*) AS n FROM mentions
    WHERE eid = $eid GROUP BY 1 ORDER BY n DESC, text LIMIT 4`,

  // ---- the year series ---------------------------------------------------
  corpus: `SELECT year, n_papers, n_papers_annotated_any FROM corpus_year
           WHERE year BETWEEN $y0 AND $y1 ORDER BY year`,

  entity_series: `SELECT year, n FROM entity_year WHERE eid = $eid`,

  pair_series: `SELECT year, n FROM pair_year WHERE a = $a AND b = $b`,

  // The A1 denominator: papers carrying an identified mention of that type. Gene
  // coverage runs from 14% in 1970 to 48% in 2010, which moves INS's peak by two
  // decades depending on which denominator is used.
  cov_entity: `SELECT year, n FROM coverage WHERE type = $type ORDER BY year`,

  // Papers carrying both types - the denominator a pair could have been observed in
  cov_pair: `
    SELECT p.year, count(DISTINCT p.pmid) AS n
    FROM papers p
    WHERE p.year BETWEEN $y0 AND $y1
      AND EXISTS (SELECT 1 FROM mentions m WHERE m.pmid = p.pmid AND m.type = $ta)
      AND EXISTS (SELECT 1 FROM mentions m WHERE m.pmid = p.pmid AND m.type = $tb)
    GROUP BY 1 ORDER BY 1`,

  pair_polarity: `
    SELECT year,
           sum(CASE WHEN rel = 'Positive_Correlation' THEN 1 ELSE 0 END)::BIGINT AS pos,
           sum(CASE WHEN rel = 'Negative_Correlation' THEN 1 ELSE 0 END)::BIGINT AS neg,
           count(*) AS n
    FROM relations WHERE a = $a AND b = $b GROUP BY 1`,

  // ---- rankings ----------------------------------------------------------
  // Distinct partners, not (partner, year) rows: counting rows answers "partner
  // years" and reported INS as 8,115 against 825 real partners.
  degree: `
    WITH e AS (
      SELECT a AS eid, b AS other, year, n FROM pair_year
      WHERE year BETWEEN $y0 AND $y1 AND n >= $minc
      UNION ALL
      SELECT b AS eid, a AS other, year, n FROM pair_year
      WHERE year BETWEEN $y0 AND $y1 AND n >= $minc
    )
    SELECT e.eid, en.type, en.name,
           count(DISTINCT e.other) AS degree,
           count(*) AS partner_years,
           sum(e.n)::BIGINT AS edge_paper_sum,
           en.n_papers
    FROM e JOIN entities en ON en.eid = e.eid
    WHERE ($etype IS NULL OR en.type = $etype)
    GROUP BY e.eid, en.type, en.name, en.n_papers
    ORDER BY degree DESC, en.n_papers DESC, e.eid
    LIMIT $limit`,

  hubs: `
    WITH e AS (
      SELECT a AS eid, b AS other FROM pair_year WHERE n >= $minc
      UNION ALL
      SELECT b AS eid, a AS other FROM pair_year WHERE n >= $minc
    )
    SELECT e.eid, en.name, count(DISTINCT e.other) AS degree
    FROM e JOIN entities en ON en.eid = e.eid
    GROUP BY 1, 2 ORDER BY degree DESC, e.eid LIMIT $limit`,

  // ---- evidence ----------------------------------------------------------
  // The paper count is its own exact query. Deriving it from the rows scanned for
  // sentences reported 577 papers out of 17,576 for Glucose - type 1 diabetes.
  evidence_count: `
    SELECT coalesce(sum(n), 0)::BIGINT AS n FROM pair_year
    WHERE a = $a AND b = $b AND year BETWEEN $y0 AND $y1`,

  evidence_papers: `
    SELECT p.pmid, p.year, p.title
    FROM papers p
    JOIN mentions ma ON ma.pmid = p.pmid AND ma.eid = $a
    JOIN mentions mb ON mb.pmid = p.pmid AND mb.eid = $b
    WHERE p.year BETWEEN $y0 AND $y1
    GROUP BY 1, 2, 3
    ORDER BY p.year DESC, p.pmid DESC
    LIMIT $limit`,

  // Bounded by papers, not by join rows: ordering 106,848 mention-passage rows and
  // then cutting cost six seconds a click.
  // One row per passage, with each side's offsets collected, rather than one row
  // per pair of offsets. The pair form repeated the whole abstract once for every
  // combination, so a single click had to materialise 8.27 MB of text for INS -
  // type 1 diabetes of which 0.70 MB was distinct, and 11.59 MB for HLA-DQB1 - an
  // 18x amplification, to display eight sentences. Every pair survives: the client
  // builds them from the two lists, and the sentences and the same-sentence paper
  // set are identical, checked pair by pair on five edges.
  //
  // The offsets are deliberately not truncated to the closest pair. That was the
  // obvious shortcut and it is wrong - keeping only the nearest lost 24 of 243
  // same-sentence papers on INS and 26 of 194 on HLA-DQB1, because two mentions can
  // sit close together across a sentence boundary while a farther pair falls inside
  // one sentence.
  evidence_sentences: `
    WITH cand AS (
      SELECT ma.pmid, ma.year
      FROM mentions ma
      JOIN mentions mb ON mb.pmid = ma.pmid AND mb.eid = $b
      WHERE ma.eid = $a AND ma.year BETWEEN $y0 AND $y1
      GROUP BY 1, 2
      ORDER BY ma.year DESC, ma.pmid DESC
      LIMIT $scan
    ),
    pg AS (
      SELECT c.pmid, c.year, p."offset" AS po, p.text AS ptext
      FROM cand c JOIN passages p ON p.pmid = c.pmid
    ),
    am AS (SELECT DISTINCT pmid, "offset" AS o, "length" AS l
           FROM mentions WHERE eid = $a),
    bm AS (SELECT DISTINCT pmid, "offset" AS o, "length" AS l
           FROM mentions WHERE eid = $b),
    ai AS (SELECT pg.pmid, pg.po,
                  list(a.o ORDER BY a.o, a.l) AS oas,
                  list(a.l ORDER BY a.o, a.l) AS las
           FROM pg JOIN am a ON a.pmid = pg.pmid
                AND a.o >= pg.po AND a.o < pg.po + length(pg.ptext)
           GROUP BY 1, 2),
    bi AS (SELECT pg.pmid, pg.po,
                  list(b.o ORDER BY b.o, b.l) AS obs,
                  list(b.l ORDER BY b.o, b.l) AS lbs
           FROM pg JOIN bm b ON b.pmid = pg.pmid
                AND b.o >= pg.po AND b.o < pg.po + length(pg.ptext)
           GROUP BY 1, 2)
    SELECT pg.pmid, pg.year, pg.po, pg.ptext,
           ai.oas, ai.las, bi.obs, bi.lbs
    FROM pg JOIN ai USING (pmid, po) JOIN bi USING (pmid, po)
    ORDER BY pg.year DESC, pg.pmid DESC, pg.po`,
};
