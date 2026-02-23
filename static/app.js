/* ============================================================
   State
   ============================================================ */
const state = {
  notes: [],            // list from GET /api/notes (with link_count)
  selectedNoteId: null,
  selectedNote: null,   // full note detail including linked_notes
  view: "notes",        // "notes" | "graph"
  editingNoteId: null,  // null = new note
  searchQuery: "",
  selectedTag: null,
  graphInfoNoteId: null, // node selected in graph
};

// Tag → color mapping (consistent across renders)
const TAG_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6",
  "#f59e0b", "#22c55e", "#3b82f6", "#f97316",
];
const tagColorMap = {};
let tagColorIndex = 0;

function tagColor(tag) {
  if (!tagColorMap[tag]) {
    tagColorMap[tag] = TAG_COLORS[tagColorIndex % TAG_COLORS.length];
    tagColorIndex++;
  }
  return tagColorMap[tag];
}

/* ============================================================
   Init
   ============================================================ */
async function init() {
  await loadNotes();
}

/* ============================================================
   Notes – data layer
   ============================================================ */
async function loadNotes() {
  const res = await fetch("/api/notes");
  state.notes = await res.json();

  // Build tag color assignments in a stable order
  const allTags = [...new Set(state.notes.flatMap((n) => n.tags))].sort();
  allTags.forEach((t) => tagColor(t));

  renderSidebar();
  refreshMainArea();
}

async function loadNoteDetail(id) {
  const res = await fetch(`/api/notes/${id}`);
  if (!res.ok) return null;
  return await res.json();
}

/* ============================================================
   Sidebar
   ============================================================ */
function renderSidebar() {
  const q = state.searchQuery.toLowerCase();
  const selTag = state.selectedTag;

  let filtered = state.notes.filter((n) => {
    if (selTag && !n.tags.includes(selTag)) return false;
    if (q) {
      const hay = (n.title + " " + n.content + " " + n.tags.join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  document.getElementById("note-count").textContent = filtered.length;

  // Tag filter bar
  const allTags = [...new Set(state.notes.flatMap((n) => n.tags))].sort();
  const tagBar = document.getElementById("tag-filter-bar");
  tagBar.innerHTML = "";
  allTags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.className = "tag-chip" + (state.selectedTag === tag ? " active" : "");
    chip.style.setProperty("--chip-color", tagColor(tag));
    chip.textContent = "#" + tag;
    if (state.selectedTag === tag) {
      chip.style.background = tagColor(tag) + "33";
      chip.style.color = tagColor(tag);
      chip.style.borderColor = tagColor(tag) + "66";
    }
    chip.onclick = () => {
      state.selectedTag = state.selectedTag === tag ? null : tag;
      renderSidebar();
    };
    tagBar.appendChild(chip);
  });

  // Note list
  const list = document.getElementById("note-list");
  list.innerHTML = "";

  filtered.forEach((note) => {
    const item = document.createElement("div");
    item.className = "note-item" + (note.id === state.selectedNoteId ? " active" : "");

    const preview = (note.content || "").replace(/[#*_\[\]]/g, "").slice(0, 80);
    const tagsHtml = note.tags
      .slice(0, 3)
      .map((t) => `<span class="note-item-tag">#${esc(t)}</span>`)
      .join("");
    const linkBadge =
      note.link_count > 0
        ? `<span class="note-item-links">&#128279; ${note.link_count}</span>`
        : "";

    item.innerHTML = `
      <div class="note-item-title">${esc(note.title)}</div>
      ${preview ? `<div class="note-item-preview">${esc(preview)}</div>` : ""}
      <div class="note-item-footer">${tagsHtml}${linkBadge}</div>
    `;
    item.onclick = () => selectNote(note.id);
    list.appendChild(item);
  });

  if (filtered.length === 0 && state.notes.length > 0) {
    list.innerHTML =
      '<p style="text-align:center;color:#475569;font-size:12px;padding:16px">No matches</p>';
  }
}

/* ============================================================
   View management
   ============================================================ */
function setView(view) {
  state.view = view;

  document.getElementById("notes-view").style.display = view === "notes" ? "" : "none";
  document.getElementById("graph-view").style.display = view === "graph" ? "flex" : "none";

  document.getElementById("btn-notes-view").classList.toggle("active", view === "notes");
  document.getElementById("btn-graph-view").classList.toggle("active", view === "graph");

  if (view === "graph") {
    renderGraph();
  }
}

function refreshMainArea() {
  if (state.view === "notes") {
    renderNoteDetail();
  } else {
    renderGraph();
  }
}

/* ============================================================
   Note selection & detail
   ============================================================ */
async function selectNote(id) {
  state.selectedNoteId = id;
  renderSidebar();

  if (state.view === "graph") {
    setView("notes");
  }

  const note = await loadNoteDetail(id);
  state.selectedNote = note;
  renderNoteDetail();
}

function renderNoteDetail() {
  const welcome = document.getElementById("empty-welcome");
  const selectEl = document.getElementById("empty-select");
  const detail = document.getElementById("note-detail");
  const actions = document.getElementById("topbar-actions");

  if (state.notes.length === 0) {
    welcome.style.display = "";
    selectEl.style.display = "none";
    detail.style.display = "none";
    actions.style.display = "none";
    return;
  }

  if (!state.selectedNote) {
    welcome.style.display = "none";
    selectEl.style.display = "";
    detail.style.display = "none";
    actions.style.display = "none";
    return;
  }

  welcome.style.display = "none";
  selectEl.style.display = "none";
  detail.style.display = "";
  actions.style.display = "";

  const n = state.selectedNote;

  document.getElementById("detail-title").textContent = n.title;
  document.getElementById("detail-created").textContent =
    "Created " + formatDate(n.created_at);
  document.getElementById("detail-updated").textContent =
    "Updated " + formatDate(n.updated_at);

  // Tags
  const tagsEl = document.getElementById("detail-tags");
  tagsEl.innerHTML = (n.tags || [])
    .map(
      (t) =>
        `<span class="note-tag" style="background:${tagColor(t)}22;color:${tagColor(t)};border-color:${tagColor(t)}44"
          onclick="filterByTag('${esc(t)}')">#${esc(t)}</span>`
    )
    .join("");

  // Content
  const contentEl = document.getElementById("detail-content");
  if (n.content && n.content.trim()) {
    contentEl.className = "note-detail-content";
    contentEl.innerHTML = renderMarkdown(n.content);
  } else {
    contentEl.className = "note-detail-content empty-content";
    contentEl.textContent = "No content yet. Click Edit to add content.";
  }

  // Linked notes
  const linkedEl = document.getElementById("linked-notes");
  const noLinksEl = document.getElementById("no-links");
  const linked = n.linked_notes || [];

  if (linked.length === 0) {
    linkedEl.innerHTML = "";
    noLinksEl.style.display = "";
  } else {
    noLinksEl.style.display = "none";
    linkedEl.innerHTML = linked
      .map((ln) => {
        const chipColor = ln.tags && ln.tags[0] ? tagColor(ln.tags[0]) : "#94a3b8";
        return `
          <div class="linked-note-chip" onclick="selectNote(${ln.id})">
            <span class="chip-dot" style="width:8px;height:8px;border-radius:50%;background:${chipColor};flex-shrink:0"></span>
            <span class="chip-title">${esc(ln.title)}</span>
            <button class="chip-unlink" onclick="unlinkNote(event, ${ln.id})" title="Remove link">&#215;</button>
          </div>
        `;
      })
      .join("");
  }
}

async function unlinkNote(event, targetId) {
  event.stopPropagation();
  if (!state.selectedNote) return;
  await fetch(`/api/links/between/${state.selectedNote.id}/${targetId}`, {
    method: "DELETE",
  });
  await reloadSelectedNote();
  await loadNotes();
}

async function reloadSelectedNote() {
  if (!state.selectedNoteId) return;
  const note = await loadNoteDetail(state.selectedNoteId);
  state.selectedNote = note;
  renderNoteDetail();
}

function filterByTag(tag) {
  state.selectedTag = tag;
  setView("notes");
  renderSidebar();
}

/* ============================================================
   Markdown renderer
   ============================================================ */
function renderMarkdown(text) {
  // Escape HTML first
  let html = esc(text);

  // Headings (must be at start of line)
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold & italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Wikilinks [[Note Title]]
  html = html.replace(
    /\[\[(.+?)\]\]/g,
    (_, title) => {
      const note = state.notes.find(
        (n) => n.title.toLowerCase() === title.toLowerCase()
      );
      const id = note ? note.id : null;
      return id
        ? `<span class="wikilink" onclick="selectNote(${id})">[[${title}]]</span>`
        : `<span class="wikilink" style="opacity:.5" title="Note not found">[[${title}]]</span>`;
    }
  );

  // Newlines to <br>
  html = html.replace(/\n/g, "<br>");

  return html;
}

/* ============================================================
   Note CRUD modals
   ============================================================ */
function openNoteModal(id) {
  state.editingNoteId = id;
  const isEdit = id !== null;
  document.getElementById("note-modal-title").textContent = isEdit
    ? "Edit Concept"
    : "New Concept";

  if (isEdit) {
    const note = state.selectedNote || state.notes.find((n) => n.id === id);
    document.getElementById("note-title").value = note ? note.title : "";
    document.getElementById("note-content").value = note ? note.content || "" : "";
    document.getElementById("note-tags").value = note
      ? (note.tags || []).join(", ")
      : "";
  } else {
    document.getElementById("note-title").value = "";
    document.getElementById("note-content").value = "";
    document.getElementById("note-tags").value = "";
  }

  openModal("note-modal");
  setTimeout(() => document.getElementById("note-title").focus(), 60);
}

async function saveNote() {
  const title = document.getElementById("note-title").value.trim();
  if (!title) {
    document.getElementById("note-title").focus();
    return;
  }
  const tagsRaw = document.getElementById("note-tags").value;
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const payload = {
    title,
    content: document.getElementById("note-content").value,
    tags,
  };

  let saved;
  if (state.editingNoteId !== null) {
    const res = await fetch(`/api/notes/${state.editingNoteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    saved = await res.json();
  } else {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    saved = await res.json();
    state.selectedNoteId = saved.id;
  }

  closeModal("note-modal");
  await loadNotes();
  const note = await loadNoteDetail(state.selectedNoteId);
  state.selectedNote = note;
  renderNoteDetail();
}

async function deleteSelectedNote() {
  if (!state.selectedNoteId) return;
  const note = state.notes.find((n) => n.id === state.selectedNoteId);
  if (!note) return;
  confirmDialog(`Delete "${note.title}"?`, async () => {
    await fetch(`/api/notes/${state.selectedNoteId}`, { method: "DELETE" });
    state.selectedNoteId = null;
    state.selectedNote = null;
    await loadNotes();
    renderNoteDetail();
  });
}

/* ============================================================
   Link picker
   ============================================================ */
function openLinkPicker() {
  document.getElementById("link-search").value = "";
  filterLinkPicker();
  openModal("link-modal");
  setTimeout(() => document.getElementById("link-search").focus(), 60);
}

function filterLinkPicker() {
  const q = document.getElementById("link-search").value.toLowerCase();
  const linked = (state.selectedNote?.linked_notes || []).map((n) => n.id);
  const list = document.getElementById("link-picker-list");
  list.innerHTML = "";

  const candidates = state.notes
    .filter((n) => n.id !== state.selectedNoteId)
    .filter((n) => !q || n.title.toLowerCase().includes(q));

  if (candidates.length === 0) {
    list.innerHTML =
      '<p style="text-align:center;color:var(--text-muted);font-size:12px;padding:12px">No concepts found</p>';
    return;
  }

  candidates.forEach((note) => {
    const alreadyLinked = linked.includes(note.id);
    const item = document.createElement("div");
    item.className =
      "link-picker-item" + (alreadyLinked ? " already-linked" : "");

    const tagsHtml = (note.tags || [])
      .slice(0, 2)
      .map((t) => `<span class="picker-tag">#${esc(t)}</span>`)
      .join("");

    item.innerHTML = `
      <span class="picker-title">${esc(note.title)}</span>
      <div class="picker-tags">${tagsHtml}</div>
      ${alreadyLinked ? '<span class="already-linked-badge">linked</span>' : ""}
    `;

    if (!alreadyLinked) {
      item.onclick = () => addLink(note.id);
    }
    list.appendChild(item);
  });
}

async function addLink(targetId) {
  if (!state.selectedNoteId) return;
  await fetch("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_id: state.selectedNoteId,
      target_id: targetId,
    }),
  });
  closeModal("link-modal");
  await reloadSelectedNote();
  await loadNotes();
}

/* ============================================================
   Graph view – Force-directed layout
   ============================================================ */
class ForceGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.nodes = [];
    this.edges = [];
    this.animFrame = null;
    this.simSteps = 0;
    this.maxSimSteps = 300;
    this.dragging = null;
    this.hovering = null;
    this.selectedId = null;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.mouseDownPos = null;
    this.onNodeClick = null;
    this._setupEvents();
  }

  setData(nodes, edges) {
    // Preserve existing positions
    const pos = {};
    this.nodes.forEach((n) => { pos[n.id] = { x: n.x, y: n.y }; });

    const angle = (2 * Math.PI) / Math.max(nodes.length, 1);
    const r = Math.max(100, nodes.length * 18);

    this.nodes = nodes.map((n, i) => ({
      ...n,
      x: pos[n.id]?.x ?? r * Math.cos(i * angle),
      y: pos[n.id]?.y ?? r * Math.sin(i * angle),
      vx: 0,
      vy: 0,
    }));
    this.edges = edges;
    this.simSteps = 0;
    this._start();
  }

  // Physics simulation step
  _tick() {
    const REPULSION = 4000;
    const SPRING_K = 0.04;
    const REST_LEN = 120;
    const GRAVITY = 0.008;
    const DAMPING = 0.82;

    const nodeMap = {};
    this.nodes.forEach((n) => { nodeMap[n.id] = n; });

    this.nodes.forEach((n) => { n.fx = 0; n.fy = 0; });

    // Repulsion between all pairs
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 1;
        const dist = Math.sqrt(dist2);
        const f = REPULSION / dist2;
        const fx = (f * dx) / dist, fy = (f * dy) / dist;
        a.fx -= fx; a.fy -= fy;
        b.fx += fx; b.fy += fy;
      }
    }

    // Spring attraction along edges
    this.edges.forEach((e) => {
      const a = nodeMap[e.source], b = nodeMap[e.target];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = SPRING_K * (dist - REST_LEN);
      const fx = (f * dx) / dist, fy = (f * dy) / dist;
      a.fx += fx; a.fy += fy;
      b.fx -= fx; b.fy -= fy;
    });

    // Gravity toward origin
    this.nodes.forEach((n) => {
      n.fx -= GRAVITY * n.x;
      n.fy -= GRAVITY * n.y;
    });

    // Integrate
    this.nodes.forEach((n) => {
      if (n === this.dragging) return;
      n.vx = (n.vx + n.fx) * DAMPING;
      n.vy = (n.vy + n.fy) * DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    });
  }

  _draw() {
    const c = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    // Dot-grid background
    this._drawGrid(ctx, c.width, c.height);

    ctx.save();
    ctx.translate(c.width / 2 + this.panX, c.height / 2 + this.panY);
    ctx.scale(this.scale, this.scale);

    const nodeMap = {};
    this.nodes.forEach((n) => { nodeMap[n.id] = n; });

    // Draw edges
    this.edges.forEach((e) => {
      const a = nodeMap[e.source], b = nodeMap[e.target];
      if (!a || !b) return;
      const isHighlighted =
        a.id === this.selectedId || b.id === this.selectedId;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = isHighlighted ? "#6366f1" : "#cbd5e1";
      ctx.lineWidth = isHighlighted ? 2 : 1.5;
      ctx.globalAlpha = isHighlighted ? 0.8 : 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Draw nodes
    this.nodes.forEach((n) => {
      const r = 18 + Math.min(n.degree * 4, 14);
      const isSelected = n.id === this.selectedId;
      const isHovered = n === this.hovering;
      const baseColor =
        n.tags && n.tags[0] ? tagColor(n.tags[0]) : "#94a3b8";

      // Shadow
      ctx.shadowColor = isSelected ? baseColor : "rgba(0,0,0,.15)";
      ctx.shadowBlur = isSelected ? 16 : 6;

      // Circle fill
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      if (isSelected) {
        ctx.fillStyle = baseColor;
      } else if (isHovered) {
        ctx.fillStyle = baseColor + "cc";
      } else {
        ctx.fillStyle = baseColor + "33";
      }
      ctx.fill();

      // Circle stroke
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isSelected ? baseColor : isHovered ? baseColor + "aa" : baseColor + "66";
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();

      // Label
      const labelColor = isSelected ? "#fff" : "#1e293b";
      ctx.fillStyle = labelColor;
      ctx.font = `${isSelected ? 700 : 500} 11px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Truncate label to fit node
      const maxW = r * 2 - 8;
      let label = n.title;
      while (label.length > 3 && ctx.measureText(label).width > maxW) {
        label = label.slice(0, -4) + "…";
      }
      ctx.fillText(label, n.x, n.y);
    });

    ctx.restore();
  }

  _drawGrid(ctx, w, h) {
    const spacing = 28;
    ctx.fillStyle = "#e2e8f0";
    for (let x = 0; x < w; x += spacing) {
      for (let y = 0; y < h; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _start() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    const loop = () => {
      if (this.simSteps < this.maxSimSteps || this.dragging) {
        this._tick();
        this.simSteps++;
      }
      this._draw();
      this.animFrame = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  // Convert screen → graph coordinates
  _toGraph(sx, sy) {
    return {
      x: (sx - this.canvas.width / 2 - this.panX) / this.scale,
      y: (sy - this.canvas.height / 2 - this.panY) / this.scale,
    };
  }

  _nodeAt(sx, sy) {
    const { x, y } = this._toGraph(sx, sy);
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const r = 18 + Math.min(n.degree * 4, 14);
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
    }
    return null;
  }

  zoomIn()  { this.scale = Math.min(3, this.scale * 1.2); this._draw(); }
  zoomOut() { this.scale = Math.max(0.15, this.scale / 1.2); this._draw(); }

  fit() {
    if (this.nodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    this.nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    });
    const w = this.canvas.width, h = this.canvas.height;
    const gW = maxX - minX + 80, gH = maxY - minY + 80;
    this.scale = Math.min(3, Math.max(0.15, Math.min(w / gW, h / gH)));
    this.panX = -((minX + maxX) / 2) * this.scale;
    this.panY = -((minY + maxY) / 2) * this.scale;
    this._draw();
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  _setupEvents() {
    const c = this.canvas;

    c.addEventListener("mousedown", (e) => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      this.mouseDownPos = { x: sx, y: sy };
      const node = this._nodeAt(sx, sy);
      if (node) {
        this.dragging = node;
        node.vx = 0; node.vy = 0;
        this.simSteps = 0; // keep sim alive while dragging
      } else {
        this.isPanning = true;
        this.panStartX = sx - this.panX;
        this.panStartY = sy - this.panY;
      }
    });

    c.addEventListener("mousemove", (e) => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.dragging) {
        const g = this._toGraph(sx, sy);
        this.dragging.x = g.x;
        this.dragging.y = g.y;
        this.dragging.vx = 0; this.dragging.vy = 0;
      } else if (this.isPanning) {
        this.panX = sx - this.panStartX;
        this.panY = sy - this.panStartY;
      } else {
        const prev = this.hovering;
        this.hovering = this._nodeAt(sx, sy);
        if (prev !== this.hovering) {
          c.style.cursor = this.hovering ? "pointer" : "grab";
        }
      }
    });

    c.addEventListener("mouseup", (e) => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const movedFar =
        this.mouseDownPos &&
        (Math.abs(sx - this.mouseDownPos.x) > 4 ||
          Math.abs(sy - this.mouseDownPos.y) > 4);

      if (this.dragging && !movedFar) {
        // Treat as click
        this.selectedId = this.dragging.id;
        if (this.onNodeClick) this.onNodeClick(this.dragging.id);
      }
      this.dragging = null;
      this.isPanning = false;
    });

    c.addEventListener("mouseleave", () => {
      this.dragging = null;
      this.isPanning = false;
      this.hovering = null;
    });

    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.scale = Math.max(0.15, Math.min(3, this.scale * factor));
      },
      { passive: false }
    );

    // Touch support
    let lastTouchDist = null;
    c.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const rect = c.getBoundingClientRect();
        const sx = t.clientX - rect.left;
        const sy = t.clientY - rect.top;
        const node = this._nodeAt(sx, sy);
        this.mouseDownPos = { x: sx, y: sy };
        if (node) { this.dragging = node; node.vx = 0; node.vy = 0; }
        else { this.isPanning = true; this.panStartX = sx - this.panX; this.panStartY = sy - this.panY; }
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      }
    });

    c.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const rect = c.getBoundingClientRect();
        const sx = t.clientX - rect.left;
        const sy = t.clientY - rect.top;
        if (this.dragging) {
          const g = this._toGraph(sx, sy);
          this.dragging.x = g.x; this.dragging.y = g.y;
        } else if (this.isPanning) {
          this.panX = sx - this.panStartX;
          this.panY = sy - this.panStartY;
        }
      } else if (e.touches.length === 2 && lastTouchDist) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.scale = Math.max(0.15, Math.min(3, this.scale * (dist / lastTouchDist)));
        lastTouchDist = dist;
      }
    }, { passive: false });

    c.addEventListener("touchend", (e) => {
      const rect = c.getBoundingClientRect();
      if (e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const sx = t.clientX - rect.left;
        const sy = t.clientY - rect.top;
        const movedFar = this.mouseDownPos &&
          (Math.abs(sx - this.mouseDownPos.x) > 8 || Math.abs(sy - this.mouseDownPos.y) > 8);
        if (this.dragging && !movedFar && this.onNodeClick) {
          this.selectedId = this.dragging.id;
          this.onNodeClick(this.dragging.id);
        }
      }
      this.dragging = null;
      this.isPanning = false;
      lastTouchDist = null;
    });
  }
}

// Graph instance
let forceGraph = null;

async function renderGraph() {
  const container = document.getElementById("graph-container");
  const canvas = document.getElementById("graph-canvas");
  const emptyEl = document.getElementById("graph-empty");

  // Size canvas to container
  const w = container.clientWidth;
  const h = container.clientHeight;
  canvas.width = w;
  canvas.height = h;

  const res = await fetch("/api/graph");
  const data = await res.json();

  if (data.nodes.length === 0) {
    emptyEl.style.display = "";
    canvas.style.display = "none";
    return;
  }

  emptyEl.style.display = "none";
  canvas.style.display = "";

  if (!forceGraph) {
    forceGraph = new ForceGraph(canvas);
    forceGraph.onNodeClick = (id) => showGraphInfoCard(id, data.nodes);
  } else {
    forceGraph.resize(w, h);
  }

  forceGraph.selectedId = state.graphInfoNoteId;
  forceGraph.setData(data.nodes, data.edges);

  // Legend: tags
  renderGraphLegend(data.nodes);
}

function renderGraphLegend(nodes) {
  const allTags = [...new Set(nodes.flatMap((n) => n.tags))].sort();
  const legend = document.getElementById("graph-legend");
  legend.innerHTML = allTags
    .slice(0, 6)
    .map(
      (t) =>
        `<div class="legend-item">
          <span class="legend-dot" style="background:${tagColor(t)}"></span>
          #${esc(t)}
        </div>`
    )
    .join("");
}

async function showGraphInfoCard(id, graphNodes) {
  state.graphInfoNoteId = id;
  if (forceGraph) forceGraph.selectedId = id;

  const graphNode = graphNodes.find((n) => n.id === id);
  const card = document.getElementById("graph-info-card");
  const titleEl = document.getElementById("info-card-title");
  const tagsEl = document.getElementById("info-card-tags");
  const previewEl = document.getElementById("info-card-preview");

  titleEl.textContent = graphNode ? graphNode.title : "...";
  tagsEl.innerHTML = (graphNode?.tags || [])
    .map(
      (t) =>
        `<span class="info-card-tag" style="background:${tagColor(t)}22;color:${tagColor(t)}">#${esc(t)}</span>`
    )
    .join("");
  previewEl.textContent = "";
  card.style.display = "";

  // Load full note for preview
  const note = await loadNoteDetail(id);
  if (note) {
    const preview = (note.content || "")
      .replace(/[#*_\[\]]/g, "")
      .slice(0, 120);
    previewEl.textContent = preview || "No content.";
    state.selectedNoteId = id;
    state.selectedNote = note;
  }
}

function closeInfoCard() {
  document.getElementById("graph-info-card").style.display = "none";
  state.graphInfoNoteId = null;
  if (forceGraph) forceGraph.selectedId = null;
}

function openNoteFromGraph() {
  closeInfoCard();
  setView("notes");
  renderNoteDetail();
  renderSidebar();
}

// Graph controls exposed to HTML
function graphZoomIn()  { if (forceGraph) forceGraph.zoomIn(); }
function graphZoomOut() { if (forceGraph) forceGraph.zoomOut(); }
function graphFit()     { if (forceGraph) forceGraph.fit(); }

// Resize graph canvas when window resizes
const resizeObserver = new ResizeObserver(() => {
  if (state.view !== "graph" || !forceGraph) return;
  const container = document.getElementById("graph-container");
  forceGraph.resize(container.clientWidth, container.clientHeight);
});
resizeObserver.observe(document.getElementById("graph-container"));

/* ============================================================
   Filter helpers
   ============================================================ */
function applyFilters() {
  state.searchQuery = document.getElementById("search").value;
  renderSidebar();
}

/* ============================================================
   Modal helpers
   ============================================================ */
function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function confirmDialog(message, onOk) {
  document.getElementById("confirm-message").textContent = message;
  openModal("confirm-modal");
  const btn = document.getElementById("confirm-ok");
  btn.onclick = () => {
    closeModal("confirm-modal");
    onOk();
  };
}

/* ============================================================
   Utilities
   ============================================================ */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ============================================================
   Keyboard shortcuts
   ============================================================ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    ["note-modal", "link-modal", "confirm-modal"].forEach(closeModal);
    closeInfoCard();
  }
  // Ctrl/Cmd + N = new note
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    openNoteModal(null);
  }
  // Ctrl/Cmd + G = toggle graph
  if ((e.ctrlKey || e.metaKey) && e.key === "g") {
    e.preventDefault();
    setView(state.view === "graph" ? "notes" : "graph");
  }
});

/* ============================================================
   Boot
   ============================================================ */
init();
