/* Force-directed canvas.

   Interaction follows what users already know from Neo4j Bloom, Linkurious and
   Cytoscape: click selects, double-click expands, drag moves and pins, hover
   previews, scroll zooms, background click clears.

   Three things here are deliberate rather than incidental:

   - Every edge gets an invisible wide hit line underneath it. A 1-3 px stroke is
     far below the ~10 px a pointer can reliably acquire, which made edges feel
     unclickable.
   - Redraws are driven by an explicit version counter, not by watching computed
     arrays. `Object.values()` returns a fresh array each call, so array watchers
     fired on unrelated state changes, re-ran the join and restarted the simulation
     mid-gesture - which is what swallowed double-clicks.
   - Fitting never zooms past 1.15x. The first version capped at 4x and ran 700 ms
     after a search, while the layout was still collapsed, so it reliably hit the cap
     and filled the screen with two enormous nodes. */
Vue.component("graph-canvas", {
  data: () => ({ tipHtml: "", tipX: 0, tipY: 0,
                 clickTimer: null, clickEid: null, clickNode: null,
                 seeds: window.T1D_SEEDS }),
  computed: {
    version() { return this.$store.state.version; },
    nodes() { return this.$store.getters.visibleNodes; },
    links() { return this.$store.getters.visibleLinks; },
    focus() { return this.$store.state.focus; },
    selection() { return this.$store.state.selection; },
    pathEids() { return this.$store.state.pathEids; },
    /* Three states, not two.

       `nodes` is already filtered by the type checkboxes, so hiding every type
       emptied it and the canvas offered "Start from an entity" - telling the
       reader to do the thing they had just done, and hiding the one control that
       would undo it. Nothing loaded and everything filtered out look the same
       here and are not the same problem. */
    nothingLoaded() {
      return Object.keys(this.$store.state.nodes).length === 0;
    },
    allFiltered() {
      return !this.nothingLoaded() && this.nodes.length === 0;
    },
    hiddenNow() { return (this.$store.state.hiddenTypes || []).slice(); },
    // What is on screen, on the screen. The counts lived only in the inspector,
    // so the reader had to select something to find out how much they were
    // looking at, and the year window - which silently governs every number -
    // was legible only from the strip's handles.
    pinnedCount() {
      return Object.keys(this.$store.state.nodes)
        .filter(k => this.$store.state.nodes[k].pinned).length;
    },
    busy() { return this.$store.state.status === "running"; },
    // One hover, in the store, whether the pointer is on this canvas or on a row in
    // the inspector's list: both point at the same node or edge. Keeping a local
    // copy as well would be a second source of truth for one fact, which is how the
    // hub definition came to disagree with itself.
    hotNode() { return this.$store.state.hoverEid; },
    hotLink() { return this.$store.state.hoverKey; },
    edgeMode() { return this.$store.state.edgeMode; }
  },
  watch: {
    version() { this.$nextTick(this.draw); },
    selection() { this.$nextTick(this.restyle); },
    edgeMode() { this.$nextTick(this.restyle); },
    pathEids() { this.$nextTick(this.restyle); },
    // Hover changes emphasis, not structure. Routing it through restyle() re-ran
    // label collision placement on every mousemove over a node, recomputing positions
    // that had not moved.
    hotLink() { this.emphasise(); },
    hotNode() { this.emphasise(); }
  },
  mounted() {
    const svg = d3.select(this.$refs.svg);
    this.root = svg.append("g");
    this.gLink = this.root.append("g").attr("class", "edges");
    this.gNode = this.root.append("g").attr("class", "nodes");
    this.zoom = d3.zoom().scaleExtent([0.1, 4])
      .on("zoom", e => {
        this.k = e.transform.k;
        this.root.attr("transform", e.transform);
        clearTimeout(this.labTimer);
        this.labTimer = setTimeout(this.placeLabels, 120);
      });
    this.k = 1;
    svg.call(this.zoom).on("dblclick.zoom", null)
       .on("click", () => { this.$store.commit("select", null); });
    this.sim = d3.forceSimulation()
      .force("link", d3.forceLink().id(d => d.eid)
        .distance(d => 80 + 70 * (1 - (d.w || 0)))
        .strength(d => 0.12 + 0.45 * (d.w || 0)))
      .force("charge", d3.forceManyBody().strength(-500).distanceMax(600))
      .force("collide", d3.forceCollide().radius(d => (d.r || 10) + 16))
      .force("x", d3.forceX().strength(0.04))
      .force("y", d3.forceY().strength(0.04))
      .on("tick", this.tick)
      .on("end", () => { if (this.pendingFit) { this.pendingFit = false; this.fit(); } });
    // measure, never assume: mounted() fires before the flex layout settles, so the
    // first read can be 0 and every node would be seeded at the origin
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.$el);
    window.addEventListener("resize", this.resize);
    this.$root.$on("graph:fit", this.fit);
    this.$root.$on("graph:fit-soon", () => { this.pendingFit = true; });
    this.$root.$on("graph:zoom", k =>
      d3.select(this.$refs.svg).transition().call(this.zoom.scaleBy, k));
  },
  beforeDestroy() {
    window.removeEventListener("resize", this.resize);
    if (this.ro) this.ro.disconnect();
  },
  methods: {
    // the same scale the nodes are drawn with, so the dot beside
    // a group matches the colour those entities will appear in
    color: t => T1DGlyphs.color(t),
    box() { return this.$refs.svg.getBoundingClientRect(); },
    viewport() {
      const b = this.box();
      return (b.width && b.height) ? b
        : { width: Math.max(window.innerWidth - 660, 400),
            height: Math.max(window.innerHeight - 140, 300) };
    },
    resize() {
      const b = this.box();
      if (!b.width || !b.height) return;
      const first = !this.lastW;
      const moved = first || Math.abs(b.width - this.lastW) > 4;
      this.lastW = b.width; this.lastH = b.height;
      this.sim.force("x").x(b.width / 2);
      this.sim.force("y").y(b.height / 2);
      if (moved && this.nodes.length) this.recentre(b);
      this.sim.alpha(0.3).restart();
    },
    recentre(b) {
      const ns = this.nodes;
      const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
      const cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
      const cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
      const dx = b.width / 2 - cx, dy = b.height / 2 - cy;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      ns.forEach(n => {
        n.x += dx; n.y += dy;
        if (n.fx != null) { n.fx += dx; n.fy += dy; }
      });
    },
    // Size is a property of the entity, not of its relationship to whatever is
    // focused. Corpus counts span 1 to 89,641, so the scale is logarithmic or the
    // top three nodes are the only ones with any area.
    radius: d => 5 + 4.2 * Math.log10((d.total_papers || 1) + 1),
    tick() {
      this.gLink.selectAll("line")
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      this.gNode.selectAll("g.node")
        .attr("transform", d => "translate(" + d.x + "," + d.y + ")");
      // Colliding labels are resolved by dropping the less important one rather than
      // letting them pile up. Throttled: it is O(n x kept) per pass.
      this.tickN = (this.tickN || 0) + 1;
      if (this.tickN % 6 === 0) this.placeLabels();
    },
    labelText(d) {
      const nm = d.name || "";
      return nm.length > 28 ? nm.slice(0, 27) + "\u2026" : nm;
    },
    placeLabels() {
      const k = this.k || 1, self = this;
      const ns = this.nodes.slice().sort((a, b) => {
        if (a.eid === self.focus) return -1;
        if (b.eid === self.focus) return 1;
        return (b.total_papers || 0) - (a.total_papers || 0);
      });
      const boxes = [], keep = {}, pad = 2 / k;
      ns.forEach(d => {
        if (d.x == null) return;
        const w = self.labelText(d).length * 5.6 / k + 10 / k, h = 12 / k;
        const x = d.x + (d.r || 8) + 7 / k, y = d.y - h / 2;
        const hit = boxes.some(b =>
          x < b.x + b.w + pad && x + w + pad > b.x &&
          y < b.y + b.h + pad && y + h + pad > b.y);
        // focus, selection and hover always keep their label
        const forced = d.eid === self.focus || d.eid === self.hotNode ||
          (self.selection && self.selection.eid === d.eid);
        if (forced || !hit) { boxes.push({ x: x, y: y, w: w, h: h }); keep[d.eid] = true; }
      });
      this.gNode.selectAll("g.node").select("text.lab")
        .attr("display", d => keep[d.eid] ? null : "none");
    },
    draw() {
      const self = this, b = this.viewport(), nodes = this.nodes, byId = {};
      nodes.forEach(n => {
        if (n.x === undefined || !isFinite(n.x)) {
          const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 160;
          n.x = b.width / 2 + r * Math.cos(a);
          n.y = b.height / 2 + r * Math.sin(a);
        }
        n.r = this.radius(n); byId[n.eid] = n;
      });
      const links = this.links.filter(l => byId[l.a] && byId[l.b]).map(l => {
        l.source = byId[l.a]; l.target = byId[l.b]; return l;
      });
      const maxP = Math.max.apply(null, links.map(l => l.comention_papers || 0).concat([1]));
      links.forEach(l => { l.w = Math.min((l.comention_papers || 0) / maxP, 1); });

      // each edge is a group: a wide transparent hit line plus the visible one
      this.gLink.selectAll("g.edge").data(links, d => d.key).join(
        en => {
          const g = en.append("g").attr("class", "edge");
          g.append("line").attr("class", "hit")
            .attr("stroke", "transparent").attr("stroke-width", 16)
            .attr("stroke-linecap", "round").style("cursor", "pointer")
            .on("mouseenter", (e, d) => { self.$store.commit("setHover", { key: d.key });
              self.showTip(e, self.edgeTip(d)); })
            .on("mousemove", e => self.moveTip(e))
            .on("mouseleave", () => { self.tipHtml = "";
            self.$store.commit("setHover", null); })
            .on("click", (e, d) => { e.stopPropagation(); self.$emit("pick-edge", d); });
          g.append("line").attr("class", "wire").attr("stroke-linecap", "round")
            .style("pointer-events", "none");
          return g;
        }, up => up, ex => ex.remove());

      this.gNode.selectAll("g.node").data(nodes, d => d.eid).join(
        en => {
          const g = en.append("g").attr("class", "node").style("cursor", "pointer");
          g.append("circle").attr("class", "halo").attr("fill", "none");
          // "What did Expand just do" is best answered by showing which nodes
          // arrived, so the last expand's additions keep a dashed ring for as long
          // as Undo is still on offer.
          g.append("circle").attr("class", "fresh").attr("fill", "none");
          g.append("path").attr("class", "glyph");
          g.append("circle").attr("class", "pin").attr("r", 3);
          g.append("text").attr("class", "lab").attr("dy", "0.34em")
            .style("pointer-events", "none");
          g.on("mouseenter", (e, d) => { self.$store.commit("setHover", { eid: d.eid });
              self.showTip(e, self.nodeTip(d)); })
            .on("mousemove", e => self.moveTip(e))
            .on("mouseleave", () => { self.tipHtml = "";
            self.$store.commit("setHover", null); })
            // a manual click/double-click guard: relying on the native dblclick
            // alongside d3-drag loses the second click often enough to feel broken
            .on("click", (e, d) => {
              e.stopPropagation();
              // The pending click has to remember which node it belongs to. One
              // shared timer meant clicking node A and then node B within 220ms
              // read as a double-click and expanded B - a click that selects
              // quietly turning into one that adds twenty nodes to the canvas.
              if (self.clickTimer && self.clickEid === d.eid) {
                clearTimeout(self.clickTimer);
                self.clickTimer = null; self.clickEid = null;
                self.$emit("expand", d);
                return;
              }
              if (self.clickTimer) {          // a different node: honour that click
                clearTimeout(self.clickTimer);
                const prev = self.clickNode;
                self.clickTimer = null; self.clickEid = null; self.clickNode = null;
                if (prev) self.$emit("pick-node", prev);
              }
              self.clickEid = d.eid; self.clickNode = d;
              self.clickTimer = setTimeout(() => {
                self.clickTimer = null; self.clickEid = null; self.clickNode = null;
                self.$emit("pick-node", d);
              }, 220);
            })
            .call(d3.drag()
              .on("start", (e, d) => {
                if (!e.active) self.sim.alphaTarget(0.2).restart();
                d.fx = d.x; d.fy = d.y;
              })
              .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
              .on("end", (e, d) => {
                if (!e.active) self.sim.alphaTarget(0);
                d.pinned = true; self.restyle();
              }));
          return g;
        }, up => up, ex => ex.remove());

      this.sim.nodes(nodes);
      this.sim.force("link").links(links);
      this.sim.force("collide").radius(d => (d.r || 10) + 16);
      this.buildAdj();
      this.sim.alpha(0.6).restart();
      this.restyle();
    },
    // adjacency for the hover neighbourhood, rebuilt only when the link set changes
    buildAdj() {
      const m = {};
      this.links.forEach(l => {
        (m[l.a] = m[l.a] || {})[l.b] = 1;
        (m[l.b] = m[l.b] || {})[l.a] = 1;
      });
      this.adj = m;
    },
    emphasise() {
      // only the attributes hover actually affects
      const hl = this.hotLink, hn = this.hotNode, path = this.pathEids;
      const sel = this.selection || {};
      const brand = T1DGlyphs.cssVar("--brand"), rule = T1DGlyphs.cssVar("--rule");
      const adj = this.adj || {};
      const near = eid => !hn || hn === eid || (adj[hn] && adj[hn][eid]);
      const onPath = l => path.indexOf(l.a) !== -1 && path.indexOf(l.b) !== -1;
      this.gLink.selectAll("g.edge").select("line.wire")
        .attr("stroke", d => (d.key === hl || (sel.kind === "edge" && sel.key === d.key)
            || (path.length && onPath(d))) ? brand : rule)
        .attr("stroke-width", d => {
          const base = 1.2 + 3.2 * (d.w || 0);
          if (path.length && onPath(d)) return base + 2.5;
          if (d.key === hl || (sel.kind === "edge" && sel.key === d.key)) return base + 2;
          return base;
        })
        .attr("stroke-opacity", d => {
          if (path.length) return onPath(d) ? 1 : 0.18;
          // In emphasise mode an edge with no extracted relation stays visible but
          // recedes: nothing is hidden, and where an assertion exists is legible at
          // a glance. Hiding them would filter the extractor's vocabulary instead -
          // disease-disease and anything with a species can never carry one.
          if (this.edgeMode === "emphasise"
              && !((d.relation_types || []).filter(Boolean).length)) return 0.14;
          if (hn) return (d.a === hn || d.b === hn) ? 1 : 0.22;
          return 0.9;
        });
      const g = this.gNode.selectAll("g.node");
      const dim = d => {
        if (path.length) return path.indexOf(d.eid) !== -1 ? 1 : 0.25;
        if (hn) return near(d.eid) ? 1 : 0.3;
        return 1;
      };
      g.select("path.glyph").attr("opacity", dim);
      g.select("text.lab").attr("opacity", d => {
        const o = dim(d);
        return o === 1 ? 1 : o - 0.05;
      });
      g.select("circle.halo")
        .attr("stroke", d => (sel.kind === "node" && sel.eid === d.eid) ? brand : "none");
    },
    restyle() {
      const path = this.pathEids, sel = this.selection || {};
      const onPath = l => path.indexOf(l.a) !== -1 && path.indexOf(l.b) !== -1;
      const hl = this.hotLink, hn = this.hotNode;
      const brand = T1DGlyphs.cssVar("--brand");
      const near = eid => hn && (hn === eid ||
        this.links.some(l => (l.a === hn && l.b === eid) || (l.b === hn && l.a === eid)));

      this.gLink.selectAll("g.edge").select("line.wire")
        .attr("stroke", d => (d.key === hl || (sel.kind === "edge" && sel.key === d.key)
            || (path.length && onPath(d))) ? brand : T1DGlyphs.cssVar("--rule"))
        .attr("stroke-width", d => {
          const base = 1.2 + 3.2 * (d.w || 0);
          if (path.length && onPath(d)) return base + 2.5;
          if (d.key === hl || (sel.kind === "edge" && sel.key === d.key)) return base + 2;
          return base;
        })
        .attr("stroke-opacity", d => {
          if (path.length) return onPath(d) ? 1 : 0.18;
          // In emphasise mode an edge with no extracted relation stays visible but
          // recedes: nothing is hidden, and where an assertion exists is legible at
          // a glance. Hiding them would filter the extractor's vocabulary instead -
          // disease-disease and anything with a species can never carry one.
          if (this.edgeMode === "emphasise"
              && !((d.relation_types || []).filter(Boolean).length)) return 0.14;
          if (hn) return (d.a === hn || d.b === hn) ? 1 : 0.22;
          return 0.9;
        });

      const g = this.gNode.selectAll("g.node");
      g.select("circle.halo")
        .attr("r", d => d.r + 7)
        .attr("stroke", d => (sel.kind === "node" && sel.eid === d.eid) ? brand : "none")
        .attr("stroke-width", 2).attr("stroke-opacity", 0.55);
      g.select("circle.fresh")
        .attr("r", d => d.r + 11)
        .attr("stroke", d => d.justAdded ? T1DGlyphs.cssVar("--warn") : "none")
        .attr("stroke-width", 1.6).attr("stroke-dasharray", "3 3")
        .attr("stroke-opacity", 0.9);
      g.select("path.glyph")
        .attr("d", d => T1DGlyphs.path(d.type, d.r))
        .attr("fill", d => T1DGlyphs.color(d.type))
        .attr("stroke", d => d.eid === this.focus ? T1DGlyphs.cssVar("--navy")
          : T1DGlyphs.cssVar("--ground"))
        .attr("stroke-width", d => d.eid === this.focus ? 2.5 : 1.8)
        .attr("opacity", d => {
          if (path.length) return path.indexOf(d.eid) !== -1 ? 1 : 0.25;
          if (hn) return near(d.eid) ? 1 : 0.3;
          return 1;
        });
      g.select("circle.pin")
        .attr("cx", d => d.r + 5).attr("cy", d => -d.r - 2)
        .attr("fill", d => d.pinned ? T1DGlyphs.cssVar("--warn") : "none");
      g.select("text.lab")
        .attr("x", d => d.r + 7)
        .attr("font-size", d => d.eid === this.focus ? 12.5 : 10.5)
        .attr("font-weight", d => d.eid === this.focus ? 700 : 400)
        .attr("fill", T1DGlyphs.cssVar("--ink-2"))
        .attr("opacity", d => {
          if (path.length) return path.indexOf(d.eid) !== -1 ? 1 : 0.3;
          if (hn) return near(d.eid) ? 1 : 0.25;
          return 1;
        })
        .text(d => this.labelText(d));
      this.placeLabels();
    },
    fit() {
      const ns = this.nodes;
      if (!ns.length) return;
      const b = this.viewport(), pad = 90;
      const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
      const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      const span = Math.max((x1 - x0 + pad) / b.width, (y1 - y0 + pad) / b.height);
      // never zoom past 1.15x: fitting is for pulling a spread-out graph into view,
      // not for magnifying a cluster that has not finished laying out
      const k = Math.max(0.15, Math.min(1.15, 0.92 / Math.max(span, 0.001)));
      d3.select(this.$refs.svg).transition().duration(450).call(
        this.zoom.transform, d3.zoomIdentity
          .translate(b.width / 2, b.height / 2).scale(k)
          .translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
    },
    releaseAll() {
      this.$store.commit("unpinAll");
      this.sim.alpha(0.5).restart();
      this.restyle();
    },
    showTip(e, html) { this.tipHtml = html; this.moveTip(e); },
    moveTip(e) {
      const b = this.$el.getBoundingClientRect();
      const w = 320, h = 120;
      let x = e.clientX - b.left + 16, y = e.clientY - b.top + 16;
      if (x + w > b.width - 8) x = e.clientX - b.left - w - 12;
      if (y + h > b.height - 8) y = Math.max(8, e.clientY - b.top - h - 8);
      this.tipX = x; this.tipY = y;
    },
    nodeTip(d) {
      return "<b>" + this.esc(d.name) + "</b><br><span class='k'>" + d.type +
        " &middot; " + this.esc(d.id) + "</span><br>" +
        (d.total_papers || 0).toLocaleString() + " papers in the corpus" +
        "<br><span class='k'>click to inspect &middot; double-click to expand" +
        (d.pinned ? " &middot; pinned" : "") + "</span>";
    },
    edgeTip(d) {
      const S = this.$store.state, a = S.nodes[d.a], b = S.nodes[d.b];
      const rel = (d.relation_types || []).filter(Boolean);
      return "<b>" + this.esc(a.name) + "</b> &mdash; <b>" + this.esc(b.name) +
        "</b><br>" + (d.comention_papers == null ? "co-mention count loading&hellip;"
          : d.comention_papers.toLocaleString() + " co-mentioning papers") +
        (d.y_first ? " &middot; " + d.y_first + "&ndash;" + d.y_last : "") + "<br>" +
        (rel.length
          ? "relation: " + this.esc(this.distText(d) || rel.join(", "))
            + (d.n_relations ? " &middot; " + d.n_relations.toLocaleString()
               + " assertions" : "")
            + (d.rel_score_max != null
               ? " &middot; score " + Number(d.rel_score_max).toFixed(2) : "")
          : "<span class='k'>no extracted relation for this pair type</span>") +
        "<br><span class='k'>click for papers and sentences</span>";
    },
    // Shares rather than a set of names, for the same reason the list shows them.
    distText(d) {
      const x = d && d.rel_dist;
      if (!x || !x.total) return "";
      const parts = [];
      for (let i = 0; i < (x.types || []).length; i++) {
        const pct = Math.round((Number(x.counts[i]) / x.total) * 100);
        if (pct < 5) continue;
        parts.push(String(x.types[i]).replace("_Correlation", "")
                   + (parts.length || i + 1 < (x.types || []).length
                      ? " " + pct + "%" : ""));
      }
      return parts.join(", ");
    },
    esc: s => String(s == null ? "" : s).replace(/[&<>"]/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  },
  template: `
  <div class="canvaswrap">
    <svg ref="svg" role="application" aria-label="Entity graph"></svg>
    <div class="tip" v-show="tipHtml" v-html="tipHtml"
         :style="{left: tipX+'px', top: tipY+'px'}"></div>
    <div class="busy" v-if="busy">working&hellip;</div>
    <!-- Everything is on the canvas and every type of it is switched off. -->
    <div class="empty" v-if="allFiltered">
      <div class="start">
        <h2>Every entity type is hidden</h2>
        <p>The canvas holds
          {{ Object.keys($store.state.nodes).length }} entities, and the type
          filters are hiding all of them.</p>
        <div class="startrow">
          <button class="seedbtn" v-for="t in hiddenNow" :key="t"
                  @click="$store.commit('toggleType', t)">show {{ t }}</button>
        </div>
      </div>
    </div>

    <div class="empty" v-else-if="nothingLoaded">
      <div class="start">
        <h2>Start from an entity</h2>
        <p>Search on the left, or open one of these:</p>
        <div class="startgrid">
          <template v-for="g in seeds">
            <div class="stype" :key="'t'+g.type">
              <span class="sdot" :style="{background: color(g.type)}"></span>{{ g.type }}
            </div>
            <div class="startrow" :key="'r'+g.type">
              <button class="seedbtn" v-for="s in g.items" :key="s.q"
                      @click="$emit('seed', s.q)">{{ s.label }}</button>
            </div>
          </template>
        </div>
        <p class="hint">Nodes are entities, edges are papers that mention both.
          Drag a node to move it, click an edge for the sentences behind it.</p>
      </div>
    </div>
    <div class="cstat" v-if="!nothingLoaded">
      <b>{{ nodes.length.toLocaleString() }}</b> entities
      &middot; <b>{{ links.length.toLocaleString() }}</b> links
      &middot; {{ $store.state.y0 }}&ndash;{{ $store.state.y1 }}
      <span v-if="hiddenNow.length">&middot; {{ hiddenNow.length }} type<span
        v-if="hiddenNow.length > 1">s</span> hidden</span>
    </div>

    <!-- Transient, over the canvas, where the removal happened - the inspector
         has nothing selected once the node is gone, so its own Undo bar cannot
         appear there. -->
    <div class="cundo" v-if="$store.state.lastRemoved">
      <span>Removed <b>{{ $store.state.lastRemoved.name }}</b></span>
      <button class="ghost tiny" @click="$store.commit('restoreRemoved')">Undo</button>
      <button class="ghost tiny" @click="$store.commit('forgetRemoved')"
              title="dismiss">&times;</button>
    </div>

    <div class="ctools">
      <button class="ghost" @click="$root.$emit('graph:zoom',1.4)" title="Zoom in">+</button>
      <button class="ghost" @click="$root.$emit('graph:zoom',1/1.4)" title="Zoom out">&minus;</button>
      <button class="ghost" @click="fit" title="Fit to view">&#8690;</button>
      <!-- Only when there is something to release, and saying how many. A filled
           circle labelled "release pinned nodes" is a control whose meaning is
           only in its tooltip, sitting there whether or not it does anything. -->
      <button class="ghost cpin" v-if="pinnedCount" @click="releaseAll"
              :title="'release ' + pinnedCount + ' pinned node'
                      + (pinnedCount > 1 ? 's' : '')">
        &#9679;<span class="cpinn">{{ pinnedCount }}</span></button>
    </div>
  </div>`
});
