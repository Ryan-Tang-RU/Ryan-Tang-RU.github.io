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
    // An ORCID is the person, not a string that happens to match a name. Where the
    // papers carry one it is the link; otherwise the reader gets the search that
    // comes closest, scoped to what they were looking at so the homonyms fall away.
    personUrl(p) {
      if (p.orcid) return "https://orcid.org/" + p.orcid;
      return this.search('"' + p.display + '"[Author]');
    },
    personTitle(p) {
      return p.orcid ? "ORCID " + p.orcid
                     : "Search PubMed for this name, within " + (this.scope || "the corpus");
    },
    orgUrl(o) { return this.search('"' + o.org + '"[Affiliation]'); },
    search(term) {
      const q = this.scope ? term + " AND " + this.scope : term;
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
