/* The assistant, as a window that floats over the work rather than beside it.

   Floating rather than docked because a question is usually about what is on the
   canvas right now: docking it would take width from the graph for a panel that is
   idle most of the time, and a modal would hide the thing being asked about.

   The transcript shows every tool call and its result, collapsed. That is not a
   debug view - it is the point. This project's recurring failure is a confident
   number with nothing behind it, and a reader who can open the query that produced
   a figure can check it. An answer with no visible retrieval behind it should look
   incomplete here. */
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
  }),
  computed: {
    model() { return window.T1DAssistant.MODEL; },
    examples() {
      return ["When did teplizumab and C-peptide start appearing together?",
              "What does the graph say about vitamin D and type 1 diabetes?",
              "Which genes carry the most assertions with type 1 diabetes?"];
    },
  },
  methods: {
    toggle() {
      this.open = !this.open;
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
          });
          this.history = res.messages;
          if (res.capped) this.turns.push({ role: "err", text:
            "Stopped after too many steps without an answer. Try a narrower " +
            "question." });
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
  beforeDestroy() {
    window.removeEventListener("mousemove", this.move);
    window.removeEventListener("mouseup", this.drop);
  },
  template: `
  <div>
    <button class="ghost asktoggle" @click="toggle"
            :class="{on: open}" title="Ask about this graph">Ask</button>

    <div class="aswin" v-if="open"
         :style="x === null ? null : {left: x + 'px', top: y + 'px',
                                      right: 'auto', bottom: 'auto'}">
      <div class="asbar" @mousedown.prevent="grab">
        <b>Ask this graph</b>
        <span class="asmodel" v-if="hasKey">{{ model }}</span>
        <span class="bspacer"></span>
        <button class="ghost tiny" @click="clear" v-if="turns.length"
                title="start over">Clear</button>
        <button class="ghost tiny" @click="showKey = !showKey"
                :title="hasKey ? 'change or remove the key' : 'add a key'">Key</button>
        <button class="ghost tiny" @click="open = false" title="close">&times;</button>
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
        <div class="asempty" v-if="!turns.length">
          <p class="hint">It can read this graph and move it &mdash; load an entity,
            change the years, open the papers behind an edge.</p>
          <button class="tchip" v-for="e in examples" :key="e" @click="use(e)">
            {{ e }}</button>
        </div>

        <template v-for="(t, i) in turns">
          <div class="asyou" :key="'y'+i" v-if="t.role === 'you'">{{ t.text }}</div>

          <div class="asai" :key="'a'+i" v-else-if="t.role === 'ai'">{{ t.text }}</div>

          <details class="astool" :key="'t'+i" v-else-if="t.role === 'tool'">
            <summary>
              <span class="astag" :class="{acts: t.acts}">{{ t.acts ? 'did' : 'read' }}</span>
              {{ t.name }}
              <span class="hint">{{ brief(t.input) }}</span>
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

        <p class="hint" v-if="busy">thinking&hellip;</p>
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
