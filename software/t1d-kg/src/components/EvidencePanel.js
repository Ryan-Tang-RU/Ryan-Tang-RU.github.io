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
      return m;
    },
    // Straight from the server, counted over the whole pair. Counting `rels` here
    // counted the 200 assertions the list holds, which on a large edge is the top
    // of the score ranking and nothing else.
    relSummary() {
      const sum = this.$store.state.relationsSummary;
      if (!sum) return [];
      const tot = sum.reduce((a, r) => a + Number(r.n), 0) || 1;
      return sum.map(r => ({ type: r.relation_type, n: Number(r.n),
                             pct: Math.round((Number(r.n) / tot) * 100) }))
        .sort((x, y) => y.n - x.n);
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
    polarity(t) {
      if (t === "Positive_Correlation") return "pos";
      if (t === "Negative_Correlation") return "neg";
      return "neutral";
    },
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
      <p class="hint">Could not load evidence for this pair &mdash;
        {{ ev.error }}.<br>The counts and sentences below would all read as zero,
        which is why nothing is shown instead. The local bridge may have stopped;
        restart it and click the edge again.</p>
    </div>

    <div v-else-if="tab==='relations'" class="evidscroll">
      <template v-if="rels && rels.length">
        <p class="hint">{{ relTotal.toLocaleString() }} extracted assertions<span
            v-if="relCapped">, showing the {{ rels.length }} highest-confidence</span>.
          <span v-for="r in relSummary" :key="r.type" class="pill"
                :class="polarity(r.type)">{{ r.type }}
            {{ r.n.toLocaleString() }} ({{ r.pct }}%)</span></p>
        <p class="hint" v-if="relSummary.length > 1">A large edge carries a little
          of everything: these are assertions from different papers, and a direction
          is the direction of one sentence's claim rather than a settled fact. Across
          the corpus only 3.2% of pairs mix the two directions &mdash; but 68% of
          pairs with fifty or more assertions do.</p>
        <ul class="ilist">
          <li v-for="(r,i) in rels" :key="i" style="cursor:default">
            <span class="pill" :class="polarity(r.relation_type)">{{
              r.relation_type }}</span>
            <a :href="pubmed(r.pmid)" target="_blank" rel="noopener">PMID {{ r.pmid }}</a>
            <span class="n">{{ r.year }} &middot; {{ r.score == null ? '-' :
              r.score.toFixed(2) }}</span>
          </li>
        </ul>
      </template>
      <template v-else>
        <p class="hint" v-if="pairTotal === 0">No extracted relation, and none is
          possible: the extractor never emits a relation for a
          <b>{{ pairType }}</b> pair &mdash; 0 of
          {{ (relCorpusTotal || 0).toLocaleString() }} corpus-wide. It works only
          among Gene, Disease, Chemical and Variant, so this absence is the
          extractor's vocabulary and says nothing about the literature. The
          Sentences tab is the evidence for this pair.</p>
        <p class="hint" v-else>No extracted relation for this pair, though
          <b>{{ pairType }}</b> pairs do carry
          {{ pairTotal.toLocaleString() }} of them corpus-wide &mdash; so here the
          absence is about this pair rather than the vocabulary. The Sentences tab
          shows where the two co-occur.</p>
      </template>
    </div>

    <div v-else-if="tab==='sentences'" class="evidscroll">
      <p class="hint" v-if="nSent">{{ nSent }}{{ capped ? '+' : '' }} sentences contain
        both entities, reconstructed from PubTator's character offsets. Showing
        {{ sentences.length }}.
        <span v-if="rels && rels.length">A tag marks a sentence whose <em>paper</em>
          carries an extracted assertion &mdash; PubTator gives relations per paper,
          not per sentence, so the tagged sentence is not necessarily the one that
          states it<span v-if="relCapped">, and only the
          {{ rels.length }} highest-confidence of {{ relTotal.toLocaleString() }}
          are tagged</span>.</span>
        <span v-if="capped">This pair is large enough that the search stopped after
          the {{ scanned.toLocaleString() }} newest of
          {{ nPapers.toLocaleString() }} co-mentioning papers &mdash; older ones may
          hold more. Narrow the years to reach them.</span></p>
      <p class="hint" v-else-if="capped">The search stopped after
        the {{ scanned.toLocaleString() }} newest of
        {{ nPapers.toLocaleString() }} co-mentioning papers without finding a sentence
        that contains both &mdash; which is not a finding that none exists. Narrow the
        years to search a smaller slice exhaustively.</p>
      <p class="hint" v-else>No sentence contains both mentions &mdash; they share an
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
        range. Listed newest first, with same-sentence papers ahead of the rest.
        <span v-if="belowThreshold">That is {{ belowThreshold }} more than the edge
          weight: the graph keeps a year only once the pair reaches 3 co-mentions in
          it, so sparse early years are in the count but not in the edge.</span></p>
      <p class="hint" v-if="!papers.length">The paper count above is exact; the list is
        empty because this view was paged. Reopen the edge to see it.</p>
      <ul class="ilist" v-else>
        <li v-for="p in papers" :key="p.pmid" style="cursor:default">
          <a :href="pubmed(p.pmid)" target="_blank" rel="noopener">{{ p.title }}</a>
          <span class="pill rel" v-if="p.same_sentence">same sentence</span>
          <span class="n">{{ p.year }}</span>
        </li>
      </ul>
      <p class="hint" v-if="papers.length && nPapers > papers.length">Showing
        {{ papers.length }} of {{ nPapers.toLocaleString() }}. Narrow the years to
        see fewer.</p>
    </div>
  </div>`
});
