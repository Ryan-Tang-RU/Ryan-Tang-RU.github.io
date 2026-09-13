/* The assistant, as a window that floats over the work rather than beside it.

   Floating rather than docked because a question is usually about what is on the
   canvas right now: docking it would take width from the graph for a panel that is
   idle most of the time, and a modal would hide the thing being asked about.

   The transcript shows every tool call and its result, collapsed. That is not a
   debug view - it is the point. This project's recurring failure is a confident
   number with nothing behind it, and a reader who can open the query that produced
   a figure can check it. An answer with no visible retrieval behind it should look
   incomplete here. */
/* The name and the one-line role, in one place so they are easy to change. An
   assistant with no identity reads as a search box with a transcript: every
   mature messenger - Intercom, Copilot Chat, the rest - gives it a name, a mark
   and a sentence about what it will and will not do, because that sentence is
   what sets the reader's expectations before their first question. This one's
   promise is narrow on purpose. */
window.T1DAgent = {
  name: "Archivist",
  role: "Answers from this graph only, and shows every query behind a number.",
  greet: "I can read this graph and move it \u2014 load an entity, change the "
         + "years, open the papers behind an edge. Ask me about an entity, a "
         + "pair, or how something changed over time.",
};

Vue.component("assistant-panel", {
  data: () => ({
    open: false,
    q: "",
    busy: false,
    turns: [],            // {role:'you'|'ai'|'tool'|'err', ...}
    history: [],           // the API's own message list, kept across turns
    keyInput: "",
    showKey: false,
    hasKey: !!window.T1DAssistant.getKey(),
    x: null, y: null,      // null until first dragged, so CSS places it
    drag: null,
    stopping: false,
    followups: [],         // offered after an answer, seeded from what it read
  }),
  computed: {
    agent() { return window.T1DAgent; },
    model() { return window.T1DAssistant.MODEL; },
    /* What to offer before anything has been asked.

       Fixed examples teach the syntax and nothing else. These are built from what
       is actually on screen, so the first question a reader asks is about the
       thing in front of them - which is the pattern every assistant that sits
       beside a document uses, and the reason this one floats over the canvas
       rather than living on its own page. Falls back to three that always work. */
    examples() {
      const S = this.$store.state, out = [];
      const nameOf = eid => (S.nodes[eid] || {}).name;
      const sel = S.selection;
      if (sel && sel.kind === "edge" && S.links[sel.key]) {
        const l = S.links[sel.key];
        const a = nameOf(l.a), b = nameOf(l.b);
        if (a && b) out.push("What does the graph actually say about "
                             + a + " and " + b + "?");
      }
      const f = S.focus && nameOf(S.focus);
      if (f) {
        out.push("What does " + f + " connect to most strongly?");
        out.push("Has " + f + " been studied more or less over time?");
      }
      if (S.y0 > 1960 || S.y1 < 2025)
        out.push("What surged between " + S.y0 + " and " + S.y1 + "?");
      else out.push("What surged in the 1990s?");
      const fallback = [
        "When did teplizumab and C-peptide start appearing together?",
        "Which genes carry the most assertions with type 1 diabetes?",
        "Is liraglutide in this graph?"];
      fallback.forEach(x => { if (out.length < 3) out.push(x); });
      return out.slice(0, 3);
    },
  },
  methods: {
    toggle() {
      this.open = !this.open;
      this.$root.$emit("assistant:open", this.open);
      if (this.open) this.$nextTick(() => {
        const i = this.$el.querySelector(".asinput");
        if (i) i.focus();
      });
    },
    saveKey() {
      const ok = window.T1DAssistant.setKey(this.keyInput.trim());
      this.hasKey = !!window.T1DAssistant.getKey();
      if (!ok) this.turns.push({ role: "err", text:
        "This browser would not store the key - a private window, or site data " +
        "blocked. The assistant works for this tab only." });
      this.keyInput = "";
      this.showKey = false;
    },
    forgetKey() {
      window.T1DAssistant.setKey("");
      this.hasKey = false;
      this.showKey = true;
    },
    use(ex) { this.q = ex; this.send(); },
    /* What a tool call did, in words.

       The row used to read `find_entity {"name":"teplizumab"}`. The reader opening
       it wants to know whether the answer rests on the right lookup, and a
       function signature makes them translate before they can tell. The result
       itself stays as JSON underneath - that is the thing being checked. */
    said(t) {
      const i = t.input || {};
      const first = i.name || i.word || i.eid || i.a || "";
      const short = String(first).split("|").slice(-1)[0];
      switch (t.name) {
        case "find_entity":       return "looked up \u201c" + (i.name || "") + "\u201d";
        case "entity_facts":      return "read the facts for " + short;
        case "entity_trend":      return "read the year-by-year series";
        case "pair_trend":        return "read the pair\u2019s series";
        case "partners":          return "listed the strongest partners";
        case "claims":            return "read the extracted claims";
        case "sentences":         return "pulled sentences, with their PMIDs";
        case "word_in_abstracts": return "counted \u201c" + (i.word || "")
                                         + "\u201d in the abstracts";
        case "connect":           return "searched for a path between them";
        case "surges_in_window":  return "looked for surges, " + i.y0 + "\u2013" + i.y1;
        case "canvas_state":      return "looked at your canvas";
        case "show_on_canvas":    return "loaded " + short + " onto the canvas";
        case "set_years":         return "set the years to " + i.y0 + "\u2013" + i.y1;
        case "open_pair_evidence":return "opened the evidence for that pair";
        default:                  return t.name;
      }
    },
    /* An answer, split into text and the PMIDs inside it.

       Rendered as spans and anchors rather than through v-html: this is model
       output, and handing it to an HTML parser would make anything the model
       echoed back - a sentence quoted out of an abstract, say - into markup. */
    parts(text) {
      const out = [], re = /\b(\d{7,8})\b/g;
      let at = 0, m;
      while ((m = re.exec(text || "")) !== null) {
        if (m.index > at) out.push({ pmid: null, s: text.slice(at, m.index) });
        out.push({ pmid: m[1], s: m[1] });
        at = m.index + m[0].length;
      }
      if (at < (text || "").length) out.push({ pmid: null, s: text.slice(at) });
      return out;
    },
    // Where to go next, from what the turn actually read. Offered rather than
    // guessed at: a reader who has just been told a number usually wants to see
    // it, and the three things worth doing next are the same every time.
    nextSteps(trace) {
      const eids = [], names = {};
      trace.forEach(s => {
        const o = s.output || {};
        (o.matches || []).forEach(r => { if (r.eid) { eids.push(r.eid);
                                                      names[r.eid] = r.name; } });
        if (o.eid) { eids.push(o.eid); names[o.eid] = o.name; }
      });
      if (!eids.length) return [];
      const eid = eids[0], nm = names[eid] || eid;
      const done = trace.map(s => s.name);
      const out = [];
      if (done.indexOf("show_on_canvas") === -1)
        out.push("Show " + nm + " on the canvas");
      if (done.indexOf("partners") === -1)
        out.push("What does " + nm + " connect to most strongly?");
      if (done.indexOf("sentences") === -1)
        out.push("Show me sentences about " + nm + " and type 1 diabetes");
      return out.slice(0, 3);
    },
    stop() { this.stopping = true; },
    // A tool result is shown as compact JSON. Long ones are cut, because the
    // reader is checking which query ran and roughly what came back, not reading
    // 66 years of counts in a chat window.
    brief(v) {
      let s;
      try { s = JSON.stringify(v); } catch (e) { s = String(v); }
      return s.length > 700 ? s.slice(0, 700) + " …" : s;
    },
    async send() {
      const q = this.q.trim();
      if (!q || this.busy) return;
      this.q = "";
      this.turns.push({ role: "you", text: q });
      this.busy = true;
      this.stopping = false;
      this.followups = [];
      this.scroll();
      const ctx = { api: window.T1DApi, store: this.$store };
      try {
        if (!this.hasKey) {
          // No key, so no prose - but the retrieval is local and still answers
          // part of the question. Whatever the graph knows about the entities
          // named in it is shown, and the panel says why there is no more.
          const res = await window.T1DAssistant.lookup(q, ctx);
          this.turns.push({ role: "lookup", found: res.found,
                            untagged: res.untagged });
        } else {
          const res = await window.T1DAssistant.ask(q, this.history, ctx, ev => {
            if (ev.kind === "text") this.turns.push({ role: "ai", text: ev.text });
            else if (ev.kind === "tool")
              this.turns.push({ role: "tool", name: ev.name, input: ev.input,
                                acts: ev.acts, out: null });
            else if (ev.kind === "result") {
              // Attach to the call this result belongs to, newest first, so a tool
              // used twice in one turn does not have both results on one row.
              for (let i = this.turns.length - 1; i >= 0; i--) {
                const t = this.turns[i];
                if (t.role === "tool" && t.name === ev.name && t.out === null) {
                  this.$set(t, "out", ev.output);
                  break;
                }
              }
            }
            this.scroll();
          }, () => this.stopping);
          this.history = res.messages;
          if (res.stopped) this.turns.push({ role: "err", text:
            "Stopped. What it had already read is above." });
          else this.followups = this.nextSteps(
            this.turns.filter(t => t.role === "tool"));
          // The answer above was given after the tools were withdrawn, so it is
          // built on what had been gathered rather than on everything the
          // question needed. Worth saying, but it is no longer an error.
          if (res.capped) this.turns.push({ role: "err", text:
            "That took the maximum number of steps, so the answer above was " +
            "written from what had been gathered by then. A narrower question " +
            "will get a more complete one." });
        }
      } catch (e) {
        const m = String((e && e.message) || e);
        this.turns.push({ role: "err", text:
          m === "no key" ? "Add a key to get written answers."
          : /^401/.test(m) ? "That key was rejected (401). Check it and try again."
          : /^429/.test(m) ? "Rate limited (429). Wait a moment and retry."
          : /Failed to fetch|Load failed|NetworkError/i.test(m)
            ? "Could not reach the model API from this page. Check the connection."
          : m });
      }
      this.busy = false;
      this.scroll();
    },
    scroll() {
      this.$nextTick(() => {
        const b = this.$el && this.$el.querySelector(".asbody");
        if (b) b.scrollTop = b.scrollHeight;
      });
    },
    clear() { this.turns = []; this.history = []; },
    // Dragged by its title bar. Position is held in data rather than written onto
    // the element, so a re-render does not put the window back where it started.
    grab(ev) {
      const r = this.$el.querySelector(".aswin").getBoundingClientRect();
      this.drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      this.x = r.left; this.y = r.top;
      window.addEventListener("mousemove", this.move);
      window.addEventListener("mouseup", this.drop);
    },
    move(ev) {
      if (!this.drag) return;
      // Kept inside the viewport: dragged past an edge the title bar becomes
      // unreachable and the window cannot be moved back or closed.
      const w = 30, h = 26;
      this.x = Math.min(Math.max(ev.clientX - this.drag.dx, -0),
                        window.innerWidth - w - 300);
      this.y = Math.min(Math.max(ev.clientY - this.drag.dy, 0),
                        window.innerHeight - h);
    },
    drop() {
      this.drag = null;
      window.removeEventListener("mousemove", this.move);
      window.removeEventListener("mouseup", this.drop);
    },
  },
  mounted() {
    // Reachable from the thing being looked at, not only from the header. The
    // inspector puts the question together and hands it over, so asking about an
    // entity is one click rather than typing its name back out.
    this.$root.$on("assistant:toggle", () => this.toggle());
    this.$root.$on("assistant:ask", q => {
      this.open = true;
      this.$root.$emit("assistant:open", true);
      this.q = q;
      this.$nextTick(this.send);
    });
  },
  beforeDestroy() {
    window.removeEventListener("mousemove", this.move);
    window.removeEventListener("mouseup", this.drop);
  },
  template: `
  <div>
    <!-- The corner launcher. A small text button in the header is not something a
         first-time reader finds: a round bubble in the bottom-right is where two
         decades of messengers have taught people to look for help, which is both
         the discoverability fix and most of the "assistant" feeling. -->
    <button class="aslauncher" v-if="!open" @click="toggle"
            :title="'Ask ' + agent.name + ' about this graph'"
            aria-label="Open the assistant">
      <svg width="21" height="21" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.6l5.4 3.1v6.6L8 14.4 2.6 11.3V4.7z" fill="none"
              stroke="currentColor" stroke-width="1.3"></path>
        <circle cx="8" cy="8" r="1.9" fill="currentColor"></circle></svg>
    </button>

    <div class="aswin" v-if="open"
         :style="x === null ? null : {left: x + 'px', top: y + 'px',
                                      right: 'auto', bottom: 'auto'}">
      <div class="asbar" @mousedown.prevent="grab">
        <span class="asface" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 16 16">
            <path d="M8 1.6l5.4 3.1v6.6L8 14.4 2.6 11.3V4.7z"
                  fill="none" stroke="currentColor" stroke-width="1.3"></path>
            <circle cx="8" cy="8" r="1.9" fill="currentColor"></circle></svg>
        </span>
        <span class="asid">
          <b>{{ agent.name }}</b>
          <span class="asmodel" v-if="hasKey">{{ model }}</span>
        </span>
        <span class="bspacer"></span>
        <button class="ghost tiny" @click="clear" v-if="turns.length"
                title="start over">Clear</button>
        <button class="ghost tiny" @click="showKey = !showKey"
                :title="hasKey ? 'change or remove the key' : 'add a key'">Key</button>
        <button class="ghost tiny" @click="toggle" title="close">&times;</button>
      </div>

      <div class="askey" v-if="showKey || !hasKey">
        <p class="hint" v-if="!hasKey">Retrieval runs in your browser and needs
          nothing. Written answers need an Anthropic API key, and this page is a
          static site with no server to keep one in &mdash; so it uses yours. It is
          stored in this browser only and sent to api.anthropic.com and nowhere
          else. Without one, questions still resolve the entities they name and
          show what the graph holds for them.</p>
        <div class="row">
          <input class="askeyin" type="password" v-model="keyInput"
                 placeholder="sk-ant-…" @keydown.enter="saveKey">
          <button class="primary" @click="saveKey" :disabled="!keyInput.trim()">
            Save</button>
          <button class="ghost" v-if="hasKey" @click="forgetKey">Forget</button>
        </div>
      </div>

      <div class="asbody">
        <!-- A greeting in the assistant's own voice, as the first turn of the
             conversation rather than as instructions above it, with the openings
             attached to it as quick replies. -->
        <div class="asturn" v-if="!turns.length">
          <span class="asface sm" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 16 16">
              <path d="M8 1.6l5.4 3.1v6.6L8 14.4 2.6 11.3V4.7z" fill="none"
                    stroke="currentColor" stroke-width="1.4"></path>
              <circle cx="8" cy="8" r="1.9" fill="currentColor"></circle></svg>
          </span>
          <div class="asbubble">
            <p class="asrole">{{ agent.role }}</p>
            <p>{{ agent.greet }}</p>
            <div class="asnext">
              <button class="tchip" v-for="e in examples" :key="e" @click="use(e)">
                {{ e }}</button>
            </div>
          </div>
        </div>

        <template v-for="(t, i) in turns">
          <div class="asyou" :key="'y'+i" v-if="t.role === 'you'">{{ t.text }}</div>

          <div class="asturn" :key="'a'+i" v-else-if="t.role === 'ai'"><span
            class="asface sm" aria-hidden="true"><svg width="12" height="12"
              viewBox="0 0 16 16"><path d="M8 1.6l5.4 3.1v6.6L8 14.4 2.6 11.3V4.7z"
                fill="none" stroke="currentColor" stroke-width="1.4"></path>
              <circle cx="8" cy="8" r="1.9" fill="currentColor"></circle></svg></span
            ><div class="asai"><template
            v-for="(p, j) in parts(t.text)"><a v-if="p.pmid" :key="'p'+j"
              :href="'https://pubmed.ncbi.nlm.nih.gov/' + p.pmid + '/'"
              target="_blank" rel="noopener" class="aspmid">{{ p.s }}</a><span
              v-else :key="'s'+j">{{ p.s }}</span></template></div></div>

          <details class="astool" :key="'t'+i" v-else-if="t.role === 'tool'">
            <summary>
              <span class="astag" :class="{acts: t.acts}">{{ t.acts ? 'did' : 'read' }}</span>
              <span class="assaid">{{ said(t) }}</span>
              <span class="hint">{{ t.name }}</span>
            </summary>
            <pre v-if="t.out !== null">{{ brief(t.out) }}</pre>
            <p class="hint" v-else>running&hellip;</p>
          </details>

          <div class="aslookup" :key="'l'+i" v-else-if="t.role === 'lookup'">
            <!-- Worded as what it is. Matching is by word, so a question can land
                 on an entity whose name merely shares one: "why is the sky blue"
                 finds Blue cone monochromatism. Calling these "the answer" would
                 overclaim; calling them what was recognised does not. -->
            <p class="hint" v-if="t.found.length">Entities in this graph whose names
              match words in your question:</p>
            <div class="asfact" v-for="f in t.found" :key="f.row.eid">
              <b>{{ f.row.name }}</b> <span class="hint">{{ f.row.type }}</span>
              <span v-if="f.facts"> &middot;
                {{ f.facts.n_papers_corpus.toLocaleString() }} papers,
                {{ f.facts.first_year }}&ndash;{{ f.facts.last_year }},
                appears with {{ f.facts.partners_all.toLocaleString() }} entities</span>
              <button class="ghost tiny"
                      @click="$store.dispatch('focusOn', {eid: f.row.eid})">
                Show</button>
            </div>
            <!-- The tagging gap, which for a drug is the whole answer. -->
            <p class="hint" v-for="u in t.untagged" :key="'u'+u.tok">
              <b>&ldquo;{{ u.tok }}&rdquo; is in {{ u.n_papers.toLocaleString() }}
              abstracts here but has no node</b> &mdash; it was never tagged as an
              entity, so nothing in the graph can be said about it. That is a fact
              about the labelling, not about the literature.</p>
            <p class="hint" v-if="!t.found.length && !t.untagged.length">Nothing in
              that question matched an entity or a word in the abstracts.</p>
            <p class="hint" v-if="t.found.length || t.untagged.length">Add a key for
              an answer written from this.</p>
          </div>

          <div class="aserr" :key="'e'+i" v-else>{{ t.text }}</div>
        </template>

        <div class="asbusy" v-if="busy">
          <span class="asface sm" aria-hidden="true"><svg width="12" height="12"
            viewBox="0 0 16 16"><path d="M8 1.6l5.4 3.1v6.6L8 14.4 2.6 11.3V4.7z"
              fill="none" stroke="currentColor" stroke-width="1.4"></path>
            <circle cx="8" cy="8" r="1.9" fill="currentColor"></circle></svg></span>
          <span class="astyping" v-if="!stopping" aria-label="working">
            <i></i><i></i><i></i></span>
          <span class="hint" v-else>stopping&hellip;</span>
          <button class="ghost tiny" @click="stop" v-if="!stopping"
                  title="stop after the current step">Stop</button>
        </div>
        <!-- Where to go next, from what the answer actually read. A reader who has
             just been given a number usually wants to see it on the canvas, and
             finding the phrasing for that themselves is friction. -->
        <div class="asnext" v-if="followups.length && !busy">
          <button class="tchip" v-for="f in followups" :key="f" @click="use(f)">
            {{ f }}</button>
        </div>
      </div>

      <div class="asfoot">
        <textarea class="asinput" rows="2" v-model="q" :disabled="busy"
                  placeholder="Ask about an entity, a pair, or a trend"
                  @keydown.enter.exact.prevent="send"></textarea>
        <button class="primary" @click="send" :disabled="busy || !q.trim()">
          Ask</button>
      </div>
    </div>
  </div>`
});
