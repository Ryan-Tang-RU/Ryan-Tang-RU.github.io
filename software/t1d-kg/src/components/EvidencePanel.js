/* Evidence for one edge, in three layers that answer different questions:

     Relations - what the extractor actually asserted, per paper, with a confidence.
                 A co-mention only says the two share an abstract; collapsing the
                 assertions into a list of type names threw that distinction away.
     Sentences - the text the assertion sits in, with both entities marked in place.
     Papers    - everything that co-mentions them, whether or not a sentence contains
                 both.

   Sentences page rather than truncate: INS - type 1 diabetes has 376 of them, and a
   silent cap of six is indistinguishable from "that is all there is". */
Vue.component("evidence-panel", {
  props: ["link"],
  data: () => ({ tab: "relations", loadingMore: false }),
  computed: {
    ev() { return this.$store.state.evidence; },
    rels() { return this.$store.state.relations; },
    relTotal() {
      const t = this.$store.state.relationsTotal;
      return t == null ? (this.rels || []).length : t;
    },
    relCapped() { return this.relTotal > (this.rels || []).length; },
    // Two different reasons for an empty Relations tab, and the difference is the
    // whole point: a pair type the extractor never covers (Species is in none of
    // the 262,510 relations) versus a covered pair type with nothing asserted here.
    pairType() { return this.$store.state.relationsPairType || "this"; },
    pairTotal() { return this.$store.state.relationsPairTotal; },
    relCorpusTotal() { return this.$store.state.relationsCorpusTotal; },
    loading() { return this.ev === null; },
    // Missing fields read as zero in JavaScript, so an error response rendered as a
    // complete, confident answer of nothing. Check this before any count is shown.
    failed() { return !!(this.ev && this.ev.error); },
    sentences() { return (this.ev && this.ev.sentences) || []; },
    nSent() { return (this.ev && this.ev.n_sentences) || 0; },
    papers() { return (this.ev && this.ev.papers) || []; },
    nPapers() { return (this.ev && this.ev.n_papers) || 0; },
    // Every type the paper carries, not the last one written into the slot: 123
    // paper-pairs in the corpus carry two at once, "Association + Negative
    // Correlation" among them, and assignment silently kept whichever came last.
    relPmids() {
      const m = {};
      (this.rels || []).forEach(r => {
        (m[r.pmid] = m[r.pmid] || []).indexOf(r.relation_type) === -1 &&
          m[r.pmid].push(r.relation_type);
      });
      // Signed claims first on every sentence, so the eye does not have to read
      // past "Association" to find out which way the finding went.
      Object.keys(m).forEach(k => { m[k] = T1DRel.order(m[k]); });
      return m;
    },
    // Straight from the server, counted over the whole pair. Counting `rels` here
    // counted the 200 assertions the list holds, which on a large edge is the top
    // of the score ranking and nothing else.
    relSummary() {
      const sum = this.$store.state.relationsSummary;
      if (!sum) return [];
      const tot = sum.reduce((a, r) => a + Number(r.n), 0) || 1;
      const byCount = sum.map(r => ({ type: r.relation_type, n: Number(r.n),
                                      pct: Math.round((Number(r.n) / tot) * 100) }))
        .sort((x, y) => y.n - x.n);
      return T1DRel.order(byCount, r => r.type);
    },
    moreSentences() { return this.nSent > this.sentences.length; },
    // The sentence scan is capped; the paper count is not. Glucose - Diabetes
    // Mellitus Type 1 joins to 106,848 mention-passage rows, so a complete scan is
    // not on a click budget. What must never happen is the cap being invisible: a
    // short list, or an empty one, then reads as the whole literature.
    capped() { return !!(this.ev && this.ev.scan_capped); },
    // The edge weight sums only years with at least 3 co-mentions, so it sits a
    // little under the true count - 17,574 against 17,576 for Glucose - Diabetes
    // Mellitus Type 1. Two numbers that differ without explanation read as one of
    // them being broken, which is how this panel's real bug was first noticed.
    belowThreshold() {
      const w = this.link && this.link.comention_papers;
      if (w == null) return 0;                 // not measured yet, nothing to explain
      return this.nPapers > w ? this.nPapers - w : 0;
    },
    scanned() { return (this.ev && this.ev.scanned_papers) || 0; }
  },
  watch: { link() { this.tab = "relations"; } },
  methods: {
    marked(s) {
      const t = s.sentence, sp = s.spans;
      const e = x => String(x).replace(/[&<>"]/g,
        c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      return e(t.slice(0, sp[0][0])) + "<mark>" + e(t.slice(sp[0][0], sp[0][1])) +
        "</mark>" + e(t.slice(sp[0][1], sp[1][0])) + "<mark>" +
        e(t.slice(sp[1][0], sp[1][1])) + "</mark>" + e(t.slice(sp[1][1]));
    },
    pubmed: pmid => "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/",
    polarity(t) { return T1DRel.polarity(t); },
    // "Positive_Correlation 2,450 (38%)" wrapped over three lines and read as a
    // file name. The direction is the word that matters, and the full type stays
    // in the title for anyone matching it against the extractor's own labels.
    short(t) { return String(t || "").replace("_Correlation", ""); },
    async more() {
      this.loadingMore = true;
      await this.$store.dispatch("loadEvidence",
        { link: this.link, offset: this.sentences.length });
      this.loadingMore = false;
    }
  },
  template: `
  <div class="evid">
    <div class="tabs" role="tablist">
      <button role="tab" :aria-selected="String(tab==='relations')"
              @click="tab='relations'">Relations
        <span class="cnt" v-if="rels && !failed">{{
          relTotal.toLocaleString() }}</span></button>
      <button role="tab" :aria-selected="String(tab==='sentences')"
              @click="tab='sentences'">Sentences
        <span class="cnt" v-if="nSent && !failed">{{
          nSent }}{{ capped ? '+' : '' }}</span></button>
      <button role="tab" :aria-selected="String(tab==='papers')"
              @click="tab='papers'">Papers
        <span class="cnt" v-if="nPapers && !failed">{{
          nPapers.toLocaleString() }}</span></button>
    </div>

    <p v-if="loading" class="hint">loading evidence&hellip;</p>

    <div v-else-if="failed" class="evidscroll">
      <p class="hint">Could not load evidence for this pair.
        {{ ev.error }}.<br>Click the edge again, or reload the page.</p>
    </div>

    <div v-else-if="tab==='relations'" class="evidscroll">
      <template v-if="rels && rels.length">
        <p class="hint">{{ relTotal.toLocaleString() }} claims found in the text<span
            v-if="relCapped">, showing the {{ rels.length }} highest-confidence</span>.
          <span v-for="r in relSummary" :key="r.type" class="pill"
                :class="polarity(r.type)" :title="r.type">{{ short(r.type) }}
            {{ r.n.toLocaleString() }} ({{ r.pct }}%)</span></p>
        <p class="hint" v-if="relSummary.length > 1">Claims come from different papers and different sentences. Both directions
          on one pair is normal for a well-studied link: among pairs with fifty
          claims or more, 68% carry both.</p>
        <ul class="ilist">
          <li v-for="(r,i) in rels" :key="i" class="nocursor">
            <span class="pill" :class="polarity(r.relation_type)"
                  :title="r.relation_type">{{ short(r.relation_type) }}</span>
            <a :href="pubmed(r.pmid)" target="_blank" rel="noopener">PMID {{ r.pmid }}</a>
            <span class="n">{{ r.year }} &middot; {{ r.score == null ? '-' :
              r.score.toFixed(2) }}</span>
          </li>
        </ul>
      </template>
      <template v-else>
        <p class="hint" v-if="pairTotal === 0">No claim was found, and none could be: the text-reading step never produces one for a
          <b>{{ pairType }}</b> pair, not once in {{ (relCorpusTotal || 0).toLocaleString() }} claims across all these papers. It reads claims only between genes, diseases, chemicals and variants, so nothing is missing here: this kind of pair is outside what it looks for. The sentences are the evidence.</p>
        <p class="hint" v-else>No claim was found for this pair, although <b>{{ pairType }}</b> pairs carry
          {{ pairTotal.toLocaleString() }} claims elsewhere in these papers.
          Here it is this pair that has none, not the kind of pair. The sentences
          below show where the two appear together.</p>
      </template>
    </div>

    <div v-else-if="tab==='sentences'" class="evidscroll">
      <p class="hint" v-if="nSent">{{ nSent }}{{ capped ? '+' : '' }} sentences contain
        both entities. Showing
        {{ sentences.length }}.
        <span v-if="rels && rels.length">A tag marks a sentence from a <em>paper</em> that carries a claim. Claims are
          recorded per paper, so the tagged sentence is not necessarily the one
          making the claim<span v-if="relCapped">, and only the
          {{ rels.length }} highest-confidence of {{ relTotal.toLocaleString() }}
          are tagged</span>.</span>
        <span v-if="capped">This pair is large enough that the search stopped after
          the {{ scanned.toLocaleString() }} newest of
          {{ nPapers.toLocaleString() }} co-mentioning papers, and older ones may
          hold more. Narrow the years to reach them.</span></p>
      <p class="hint" v-else-if="capped">The search stopped after
        the {{ scanned.toLocaleString() }} newest of
        {{ nPapers.toLocaleString() }} co-mentioning papers without finding a sentence
        that contains both. Narrow the years to search the rest.</p>
      <p class="hint" v-else>No sentence contains both mentions. They share an
        abstract but not a sentence. Open the Papers tab.</p>
      <p class="sent" v-for="(s,i) in sentences" :key="i">
        <span v-html="marked(s)"></span>
        <span class="src">
          <a :href="pubmed(s.pmid)" target="_blank" rel="noopener">PMID {{ s.pmid }}</a>
          &middot; {{ s.year }}
          <span class="pill" v-for="t in (relPmids[s.pmid] || [])" :key="t"
                :class="polarity(t)"
                :title="'This paper carries an extracted ' + t + ' assertion for the '
                      + 'pair. PubTator gives relations per paper, not per sentence, '
                      + 'so it need not be this sentence that states it.'">{{ t }}</span>
        </span>
      </p>
      <button class="ghost wide" v-if="moreSentences" @click="more"
              :disabled="loadingMore">
        {{ loadingMore ? 'loading...' : 'Show ' + Math.min(8, nSent - sentences.length) +
           ' more of ' + nSent }}
      </button>
    </div>

    <div v-else class="evidscroll">
      <p class="hint">{{ nPapers.toLocaleString() }} papers mention both in this year
        range, newest first, with same-sentence papers ahead of the rest.
        <span v-if="belowThreshold">That is {{ belowThreshold }} more than the edge
          weight, because an edge needs 3 shared papers within a single year and
          sparser years are counted here but not drawn.</span></p>
      <!-- Reachable only if the list genuinely came back empty, which the count
           above says should not happen. It used to blame paging, from when a
           later page overwrote the list; it no longer does, so the old wording
           was an apology for a fixed bug. -->
      <p class="hint" v-if="!papers.length">The count above is exact, but the list
        of papers did not load. Reopen the edge to try again.</p>
      <ul class="ilist" v-else>
        <li v-for="p in papers" :key="p.pmid" class="nocursor">
          <a :href="pubmed(p.pmid)" target="_blank" rel="noopener">{{ p.title }}</a>
          <span class="pill rel" v-if="p.same_sentence"
                title="Both entities appear inside one sentence of this abstract,
not merely somewhere in it. A paper that names them together in a sentence is more
often about the pair, and one that mentions them paragraphs apart often is not.">both
            in one sentence</span>
          <span class="n">{{ p.year }}</span>
        </li>
      </ul>
      <p class="hint" v-if="papers.length && nPapers > papers.length">Showing
        {{ papers.length }} of {{ nPapers.toLocaleString() }}. Narrow the years to
        see fewer.</p>
    </div>
  </div>`
});
