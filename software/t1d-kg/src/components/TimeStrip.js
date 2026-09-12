/* The year strip.

   Two things share one axis, because separating them is what lets a reader tell the
   difference this project exists to measure: bars are the raw paper count, the line
   is that count as a share. The corpus grows about 25-fold across the range, so a
   rising bar profile on its own says almost nothing.

   The share divides by the papers something of that type was actually annotated in,
   which is Step 5's A1 normalisation and what the report plots. Dividing by all
   papers instead - which this strip used to do, under the same word "share" - moves
   INS's peak from the 1970s to 1990, because Gene coverage climbs from 14% to 48%
   across the same years. The other denominator is one click away and labelled.

   It is also the year control. Dragging on it selects a window, which is a far better
   interaction than two number inputs - you can see what you are selecting.

   Context follows the selection: with an edge selected the strip shows the pair's
   co-mentions, otherwise the focal entity's papers.

   The three states carry keys. Vue 2 reuses an element across v-if branches when
   the tag matches, so the error, empty and series strips - all div.tstrip - were
   patched into each other and left the previous branch's children behind: content
   appearing that belonged to a state the strip was no longer in. */
Vue.component("time-strip", {
  data: () => ({ data: null, mode: "count", drag: null, hoverYear: null,
                 loadKey: null, err: "", denom: "cov" }),
  computed: {
    // One accessor for the chosen denominator: the geometry, the burst test, the
    // hover box and the caption all have to agree about which share they mean.
    share() {
      if (!this.data) return [];
      return this.denom === "cov" ? this.data.share_cov : this.data.share_corpus;
    },
    denomText() {
      return this.denom === "cov"
        ? (this.data && this.data.denom_label) || "annotated papers"
        : "all papers that year";
    },
    focus() { return this.$store.state.focus; },
    link() { return this.$store.getters.selectedLink; },
    y0() { return this.$store.state.y0; },
    y1() { return this.$store.state.y1; },
    context() {
      if (this.link) return { a: this.link.a, b: this.link.b };
      if (this.focus) return { eid: this.focus };
      return null;
    },
    title() {
      const S = this.$store.state;
      if (this.link) {
        const a = S.nodes[this.link.a], b = S.nodes[this.link.b];
        return (a ? a.name : "?") + " — " + (b ? b.name : "?");
      }
      if (this.focus && S.nodes[this.focus]) return S.nodes[this.focus].name;
      return "";
    },
    windowBand() {
      // one rect for the selected window rather than a v-if inside a v-for over 66
      // years: v-for has the higher priority in Vue 2, so the condition is evaluated
      // per item and the DOM carries every element anyway
      if (!this.data) return { x: 0, w: 0 };
      const ys = this.data.years;
      const i0 = Math.max(0, ys.indexOf(this.y0));
      const i1 = ys.indexOf(this.y1) === -1 ? ys.length - 1 : ys.indexOf(this.y1);
      return { x: this.x(i0) - 0.5, w: Math.max(this.x(i1) - this.x(i0) + 1, 1) };
    },
    // Where the series stops being comparable with itself. MeSH indexing lags about
    // four years, so a fall in the last few years is mostly the index catching up,
    // and reading it as a decline is the single easiest mistake to make here.
    lagBand() {
      if (!this.data || !this.data.core_to) return null;
      const ys = this.data.years, i0 = ys.indexOf(this.data.core_to + 1);
      if (i0 === -1) return null;
      return { x: this.x(i0) - 0.5, w: Math.max(this.x(ys.length - 1) - this.x(i0) + 1, 1),
               from: this.data.core_to + 1, to: ys[ys.length - 1] };
    },
    // 47% of relations carry an explicit direction, so a pair can be watched
    // changing sign. Shown only where there are assertions to show.
    pol() {
      const p = this.data && this.data.polarity;
      if (!p || !p.total || !p.total.some(x => x > 0)) return null;
      return p;
    },
    polMax() { return this.pol ? Math.max.apply(null, this.pol.total) : 0; },
    // One line, always one line. The caption used to grow to four lines when an
    // entity had bursts and a polarity band, which changed the strip's height and
    // therefore the canvas's, and the graph jumped every time the selection changed.
    // The detail lives in the tooltip, where length costs nothing.
    note() {
      const bits = ["drag to choose years"];
      if (this.pol) bits.push("strip below: which way the claims point");
      if ((this.data.bursts || []).length) bits.push("orange: unusually busy years");
      if (this.lagBand) bits.push(this.lagBand.from + " on: still being indexed");
      return bits.join(" \u00b7 ");
    },
    fullNote() {
      const out = ["Bars are " + (this.mode === "count" ? "the number of papers"
        : "the share") + " each year; the line is the share, out of "
        + this.denomText + ". The share is the series worth reading: the literature "
        + "itself grows about twenty-five fold across these years, so almost "
        + "everything rises when you count papers."];
      if ((this.data.bursts || []).length) {
        out.push("Orange marks the years when this came up far more often than "
          + "its own baseline: " +
          this.data.bursts.map(b => b[0] === b[1] ? b[0] : b[0] + "-" + b[1])
            .join(", ") + ".");
      }
      if (this.lagBand) {
        out.push("The tinted years from " + this.lagBand.from + " on are not yet "
          + "fully catalogued - the subject headings arrive about four years late "
          + "- so a fall at the right-hand end is mostly the catalogue catching up, "
          + "not the research slowing down.");
      }
      if (this.pol) {
        out.push("The strip under the bars shows which way the claims about these "
          + "two point, each year: claims of a lower value below, a higher value "
          + "above, and the gap between them claims that only say the two are "
          + "related. Up to " + this.polMax + " claims in a single year.");
      }
      return out.join(" ");
    },
    dragBand() {
      if (!this.drag || !this.data) return null;
      const ys = this.data.years;
      const a = this.x(ys.indexOf(this.drag.from));
      const b = this.x(ys.indexOf(this.drag.to));
      return { x: Math.min(a, b), w: Math.abs(b - a) };
    },
    bursty() {
      // The actual Kleinberg intervals from Step 5b, not a stand-in. This used to
      // mark any year whose share exceeded twice its own median - a rule invented
      // here while the project already fitted a two-state model to the same series.
      // The made-up one was the one on screen, under the same word.
      const out = {};
      ((this.data && this.data.bursts) || []).forEach(([a, b]) => {
        for (let y = a; y <= b; y++) out[y] = true;
      });
      return out;
    }
  },
  watch: {
    context: { immediate: true, deep: true, handler(c) { this.load(c); } }
  },
  methods: {
    async load(c) {
      if (!c) { this.data = null; return; }
      const key = JSON.stringify(c);
      if (key === this.loadKey) return;
      this.loadKey = key;
      const r = await T1DApi.timeline(c);
      if (JSON.stringify(this.context) !== key) return;   // a newer context won
      // {error} has no `years`, and the bar geometry reads data.years.length before
      // anything guards it - the whole strip throws mid-render and disappears.
      if (r.error || !r.years) { this.data = null; this.err = r.error || "no series";
                                 return; }
      this.err = ""; this.data = r;
    },
    x(i) { return (i / Math.max(this.data.years.length - 1, 1)) * 100; },
    barH(i) {
      const d = this.data;
      if (this.mode === "count") {
        return d.peak ? (d.counts[i] / d.peak) * 100 : 0;
      }
      const m = Math.max.apply(null, this.share);
      return m ? (this.share[i] / m) * 100 : 0;
    },
    // Two stacked heights per year, each a count over that year's assertions, so the
    // band reads as composition and not as volume.
    polH(i, which) {
      const p = this.pol, t = p.total[i];
      if (!t) return 0;
      return ((which === "pos" ? p.pos[i] : p.neg[i]) / t) * 100;
    },
    inWindow(y) { return y >= this.y0 && y <= this.y1; },
    yearAt(ev) {
      const b = this.$refs.plot.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width));
      const ys = this.data.years;
      return ys[Math.round(f * (ys.length - 1))];
    },
    down(ev) {
      if (!this.data) return;
      this.drag = { from: this.yearAt(ev), to: this.yearAt(ev) };
      window.addEventListener("mousemove", this.move);
      window.addEventListener("mouseup", this.up);
    },
    move(ev) { if (this.drag) this.drag = { from: this.drag.from, to: this.yearAt(ev) }; },
    up() {
      window.removeEventListener("mousemove", this.move);
      window.removeEventListener("mouseup", this.up);
      if (!this.drag) return;
      const a = Math.min(this.drag.from, this.drag.to);
      const b = Math.max(this.drag.from, this.drag.to);
      this.drag = null;
      // a click, not a drag, selects that single year
      this.$store.commit("setYears", { y0: a, y1: b });
      this.$store.dispatch("reloadYears");
    },
    reset() {
      this.$store.commit("setYears", { y0: 1960, y1: 2025 });
      this.$store.dispatch("reloadYears");
    },
    hover(ev) { if (this.data) this.hoverYear = this.yearAt(ev); },
    countAt(y) {
      if (!this.data) return 0;
      const i = this.data.years.indexOf(y);
      return i === -1 ? 0 : this.data.counts[i];
    },
    shareAt(y) {
      if (!this.data) return 0;
      const i = this.data.years.indexOf(y);
      return i === -1 ? 0 : this.share[i];
    },
    linePath() {
      const d = this.data;
      const m = Math.max.apply(null, this.share) || 1;
      return d.years.map((y, i) =>
        (i ? "L" : "M") + this.x(i).toFixed(2) + "," +
        (100 - (this.share[i] / m) * 100).toFixed(2)).join(" ");
    }
  },
  template: `
  <div class="tstrip" key="err" v-if="err">
    <div class="thead"><span class="tt">Timeline unavailable</span>
      <span class="tsub">{{ err }}</span></div>
  </div>
  <div class="tstrip" key="empty" v-else-if="!data">
    <div class="thead"><span class="tt">Timeline</span>
      <span class="tsub">{{ context ? 'loading\u2026'
        : 'select an entity or an edge to see its year series' }}</span></div>
  </div>
  <div class="tstrip" key="series" v-else-if="data">
    <div class="thead">
      <span class="tt">{{ title }}</span>
      <span class="tsub">{{ data.total.toLocaleString() }} {{ data.label }}<template
        v-if="data.peak_year">, peak {{ data.peak_year }}</template></span>
      <span class="tspacer"></span>
      <span class="tsel">{{ y0 }}&ndash;{{ y1 }}</span>
      <button class="ghost tiny" @click="reset" v-if="y0 !== 1960 || y1 !== 2025">
        all years</button>
      <button class="ghost tiny" @click="mode = mode === 'count' ? 'share' : 'count'">
        {{ mode === 'count' ? 'bars: papers' : 'bars: share' }}</button>
      <button class="ghost tiny" @click="denom = denom === 'cov' ? 'corpus' : 'cov'"
              :title="'share is divided by ' + denomText">
        {{ denom === 'cov' ? '/ annotated' : '/ all papers' }}</button>
    </div>
    <div class="plot" ref="plot" @mousedown="down" @mousemove="hover"
         @mouseleave="hoverYear = null">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="bars">
        <rect class="lagband" v-if="lagBand" :x="lagBand.x" y="0"
              :width="lagBand.w" height="100"></rect>
        <rect class="wband" :x="windowBand.x" y="0" :width="windowBand.w"
              height="100"></rect>
        <rect v-for="(y,i) in data.years" :key="y"
              :x="x(i) - 0.42" :y="100 - barH(i)" width="0.84" :height="barH(i)"
              :class="['bar', {out: !inWindow(y), burst: bursty[y]}]"></rect>
        <path v-if="mode === 'count'" :d="linePath()" class="shareline"
              vector-effect="non-scaling-stroke"></path>
        <rect v-if="dragBand" :x="dragBand.x" y="0" :width="dragBand.w"
              height="100" class="dragband"></rect>
      </svg>
      <!-- always present, empty when the pair has no assertions: a band that comes
           and goes changes the strip's height, and the strip is the canvas's
           sibling in a flex column, so every appearance re-laid out the graph -->
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="polband">
        <template v-if="pol">
          <rect v-for="(y,i) in data.years" :key="'n'+y" :x="x(i) - 0.42"
                :y="100 - polH(i,'neg')" width="0.84" :height="polH(i,'neg')"
                class="pneg"></rect>
          <rect v-for="(y,i) in data.years" :key="'p'+y" :x="x(i) - 0.42" y="0"
                :height="polH(i,'pos')" width="0.84" class="ppos"></rect>
        </template>
      </svg>
      <div class="ticks">
        <span v-for="y in [1960,1975,1990,2005,2020]" :key="y"
              :style="{left: x(data.years.indexOf(y)) + '%'}">{{ y }}</span>
      </div>
      <div class="tcursor" v-if="hoverYear"
           :style="{left: x(data.years.indexOf(hoverYear)) + '%'}">
        <span class="tbox">{{ hoverYear }} &middot; {{ countAt(hoverYear) }}
          {{ data.label }}<template v-if="shareAt(hoverYear)">
          &middot; {{ (shareAt(hoverYear)*100).toFixed(2) }}% of
          {{ denomText }}</template></span>
      </div>
    </div>
    <p class="thint" :title="fullNote">{{ note }}</p>
  </div>`
});
