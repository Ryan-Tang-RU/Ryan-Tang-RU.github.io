/* Who publishes this, in the two places that ask it: an entity and an edge.

   One component, because the answer has the same shape either way and the caveats
   have to travel with it. Two of them:

   - The count is of papers where the person is the *last author*. That is the usual
     stand-in for the lab, and it is a convention rather than something the data
     states, so the panel says it in words rather than leaving a reader to assume
     the graph knows who ran the study.
   - PubMed records an affiliation for every author only from about 2014. Before
     that it kept the first author's, so institutions are under-counted for older
     work. The denominator is printed next to the list rather than described. */
Vue.component("people-list", {
  props: { data: Object, loading: Boolean, scope: String },
  computed: {
    people() { return (this.data && this.data.people) || []; },
    orgs() { return (this.data && this.data.orgs) || []; },
    // What to narrow the PubMed search with: the words the papers use for the
    // entities this panel is about, which the query returns alongside the people.
    terms() { return (this.data && this.data.terms) || []; },
    papers() { return (this.data && this.data.papers) || 0; },
    withOrg() { return (this.data && this.data.papers_with_org) || 0; },
    orgPct() {
      return this.papers ? Math.round((this.withOrg / this.papers) * 100) : 0;
    }
  },
  methods: {
    years(r) {
      if (!r.y_first) return "";
      return r.y_first === r.y_last ? String(r.y_first)
                                    : r.y_first + "–" + r.y_last;
    },
    // PubMed indexes an author as surname first: "Badenhoop K", never
    // "K Badenhoop", which is how this panel writes the name and how the link
    // used to ask for it - and a reversed name matches nothing at all rather than
    // matching loosely, so every one of these links returned an empty page.
    // The surname is taken from the grouping key, which was built from PubMed's
    // own last-name field, and its spelling is read back out of the display name
    // so the reader sees the name cased the way the papers case it.
    auTerm(p) {
      const k = String(p.key || "").split("|");
      const last = (k[0] || "").trim(), ini = (k[1] || "").trim();
      const disp = String(p.display || "").trim();
      if (!last) return disp;
      const at = disp.toLowerCase().lastIndexOf(last);
      const surname = at >= 0 ? disp.slice(at, at + last.length)
                              : last.replace(/(^|[\s'-])([a-z])/g,
                                             (m, a, b) => a + b.toUpperCase());
      return ini ? surname + " " + ini.toUpperCase() : surname;
    },
    // An ORCID is the person, not a string that happens to match a name. Where the
    // papers carry one it is the link; otherwise the reader gets the search that
    // comes closest, scoped to what they were looking at so the homonyms fall away.
    personUrl(p) {
      if (p.orcid) return "https://orcid.org/" + p.orcid;
      // A study group is a corporate author. [Author] does not hold those at all:
      // "FinnDiane Study Group"[Author] is zero papers, [cn] is a hundred and ninety.
      if (p.is_group) return this.search('"' + p.display + '"[cn]');
      return this.search('"' + this.auTerm(p) + '"[Author]');
    },
    personTitle(p) {
      if (p.orcid) return "ORCID " + p.orcid;
      const who = p.is_group ? p.display : this.auTerm(p);
      return "Search PubMed for " + who + ", within " + (this.scope || "the corpus");
    },
    orgUrl(o) { return this.search('"' + o.org + '"[Affiliation]'); },
    search(term) {
      // Narrowed by how the papers write these entities, not by what the graph
      // calls them. Scoping the insulin gene as "INS" cut a search of forty five
      // thousand papers down to five hundred and some labs down to none at all.
      const by = this.terms.map(t => '"' + t + '"').join(" AND ");
      const q = by ? term + " AND " + by : (this.scope ? term + " AND " + this.scope : term);
      return "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent(q);
    }
  },
  template: `
  <div class="who">
    <p class="hint" v-if="loading">reading the author lists&hellip;</p>
    <template v-else-if="people.length">
      <label class="seclbl top">Labs
        <span class="lblplain">by last author, the usual stand-in for the lab</span></label>
      <ul class="ilist plain">
        <li v-for="p in people" :key="p.key" class="nocursor">
          <a :href="personUrl(p)" target="_blank" rel="noopener" :title="personTitle(p)"
             class="wholink">{{ p.display }}<span class="orcid" v-if="p.orcid"
             aria-label="has an ORCID">&#9673;</span></a>
          <span class="pill neutral" v-if="p.is_group">group</span>
          <span class="n">{{ p.n.toLocaleString() }}<span class="dim"
            v-if="years(p)"> &middot; {{ years(p) }}</span></span>
        </li>
      </ul>

      <label class="seclbl top">Institutions
        <span class="lblplain">from the last author's affiliation</span></label>
      <ul class="ilist plain" v-if="orgs.length">
        <li v-for="o in orgs" :key="o.key" class="nocursor">
          <a :href="orgUrl(o)" target="_blank" rel="noopener"
             title="Search PubMed for this affiliation" class="wholink">{{ o.org }}</a>
          <span class="n">{{ o.n.toLocaleString() }}</span>
        </li>
      </ul>
      <p class="hint" v-else>No affiliation is on record for these papers.</p>
      <p class="hint">An affiliation is on record for {{ withOrg.toLocaleString() }}
        of these {{ papers.toLocaleString() }} papers ({{ orgPct }}%). PubMed keeps
        one for every author only from about 2014, so older work is counted in the
        names above and not in the institutions.</p>
    </template>
    <p class="hint" v-else>No papers in this year range, so nobody to name.</p>
  </div>`
});
