/* ═══════════════════════════════════════════════════════════════════════════
   Zettelkasten — Frontend Application
   ═══════════════════════════════════════════════════════════════════════════ */

"use strict";

/* ── State ────────────────────────────────────────────────────────────────── */
const state = {
  concepts: [],          // all concepts from server
  currentId: null,       // selected concept id
  currentTags: [],       // tags for current concept being edited
  chatMessages: [],      // AI chat history
  chatStreaming: false,  // is AI currently responding?
  graphSimulation: null, // d3 force simulation reference
  graphData: { nodes: [], links: [] },
};

/* ── DOM refs ─────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

const searchInput      = $("search-input");
const conceptList      = $("concept-list");
const listEmpty        = $("list-empty");
const editorPlaceholder= $("editor-placeholder");
const conceptEditor    = $("concept-editor");
const conceptTitle     = $("concept-title");
const conceptContent   = $("concept-content");
const tagsDisplay      = $("tags-display");
const tagInput         = $("tag-input");
const saveBtn          = $("save-btn");
const deleteBtn        = $("delete-btn");
const linkTargetSelect = $("link-target-select");
const linkLabelInput   = $("link-label-input");
const addLinkBtn       = $("add-link-btn");
const existingLinks    = $("existing-links");
const previewContent   = $("preview-content");
const chatMessages     = $("chat-messages");
const chatInput        = $("chat-input");
const sendChatBtn      = $("send-chat-btn");
const includeContext   = $("include-context");
const graphSvg         = $("graph-svg");
const graphEmpty       = $("graph-empty");
const toast            = $("toast");

/* ── Toast ────────────────────────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg, type = "info") {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast";
    setTimeout(() => { toast.hidden = true; }, 200);
  }, 2500);
}

/* ── API helpers ──────────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "API error");
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ── Concepts API ─────────────────────────────────────────────────────────── */
async function loadConcepts() {
  state.concepts = await api("/api/concepts");
  renderConceptList();
  refreshLinkTargetSelect();
}

async function createConcept() {
  const c = await api("/api/concepts", {
    method: "POST",
    body: JSON.stringify({ title: "New Concept", content: "", tags: [] }),
  });
  state.concepts.unshift(c);
  renderConceptList();
  refreshLinkTargetSelect();
  selectConcept(c.id);
  setTimeout(() => { conceptTitle.select(); }, 50);
}

async function saveConcept() {
  if (!state.currentId) return;
  const data = {
    title: conceptTitle.value.trim() || "Untitled",
    content: conceptContent.value,
    tags: state.currentTags,
  };
  try {
    const updated = await api(`/api/concepts/${state.currentId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    const idx = state.concepts.findIndex((c) => c.id === state.currentId);
    if (idx !== -1) state.concepts[idx] = updated;
    renderConceptList();
    refreshLinkTargetSelect();
    showToast("Saved!", "success");
  } catch (e) {
    showToast("Save failed: " + e.message, "error");
  }
}

async function deleteConcept() {
  if (!state.currentId) return;
  if (!confirm("Delete this concept and all its connections?")) return;
  try {
    await api(`/api/concepts/${state.currentId}`, { method: "DELETE" });
    state.concepts = state.concepts.filter((c) => c.id !== state.currentId);
    state.currentId = null;
    state.currentTags = [];
    showEditor(false);
    renderConceptList();
    refreshLinkTargetSelect();
    loadGraph();
    showToast("Deleted", "success");
  } catch (e) {
    showToast("Delete failed: " + e.message, "error");
  }
}

/* ── Concept List ─────────────────────────────────────────────────────────── */
function renderConceptList() {
  const q = searchInput.value.toLowerCase();
  const filtered = q
    ? state.concepts.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.content && c.content.toLowerCase().includes(q)) ||
          (c.tags && JSON.parse(c.tags).some((t) => t.toLowerCase().includes(q)))
      )
    : state.concepts;

  listEmpty.hidden = filtered.length > 0;

  // Remove existing items
  Array.from(conceptList.querySelectorAll(".concept-item")).forEach((el) =>
    el.remove()
  );

  filtered.forEach((c) => {
    const tags = safeParseJSON(c.tags, []);
    const date = c.updated_at
      ? new Date(c.updated_at).toLocaleDateString()
      : "";

    const item = document.createElement("div");
    item.className =
      "concept-item" + (c.id === state.currentId ? " active" : "");
    item.dataset.id = c.id;

    item.innerHTML = `
      <div class="concept-item-title">${escHtml(c.title)}</div>
      <div class="concept-item-meta">
        <span class="concept-item-date">${date}</span>
        ${tags.slice(0, 2).map((t) => `<span class="tag-pill">${escHtml(t)}</span>`).join("")}
      </div>
    `;
    item.addEventListener("click", () => selectConcept(c.id));
    conceptList.appendChild(item);
  });
}

/* ── Select / Open Concept ────────────────────────────────────────────────── */
function selectConcept(id) {
  const c = state.concepts.find((x) => x.id === id);
  if (!c) return;

  state.currentId = id;
  state.currentTags = safeParseJSON(c.tags, []);

  conceptTitle.value = c.title;
  conceptContent.value = c.content || "";
  renderTags();
  showEditor(true);
  renderConceptList();

  // Reset to write tab
  switchTab("write");

  // Highlight node in graph
  highlightGraphNode(id);
}

function showEditor(show) {
  editorPlaceholder.hidden = show;
  conceptEditor.hidden = !show;
}

/* ── Tags ─────────────────────────────────────────────────────────────────── */
function renderTags() {
  tagsDisplay.innerHTML = "";
  state.currentTags.forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "tag-pill";
    pill.innerHTML = `${escHtml(tag)}<span class="tag-remove" data-tag="${escHtml(tag)}">×</span>`;
    tagsDisplay.appendChild(pill);
  });
}

function addTag(tag) {
  tag = tag.trim().toLowerCase();
  if (!tag || state.currentTags.includes(tag)) return;
  state.currentTags.push(tag);
  renderTags();
}

function removeTag(tag) {
  state.currentTags = state.currentTags.filter((t) => t !== tag);
  renderTags();
}

tagsDisplay.addEventListener("click", (e) => {
  if (e.target.classList.contains("tag-remove")) {
    removeTag(e.target.dataset.tag);
  }
});

tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addTag(tagInput.value);
    tagInput.value = "";
  }
});

/* ── Editor Tabs ──────────────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  document.querySelectorAll(".tab-content").forEach((el) => {
    el.classList.toggle("active", el.id === name + "-tab");
  });

  if (name === "preview") {
    previewContent.innerHTML = marked.parse(conceptContent.value || "");
  }
  if (name === "links") {
    loadLinksPanel();
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

/* ── Links Panel ──────────────────────────────────────────────────────────── */
function refreshLinkTargetSelect() {
  linkTargetSelect.innerHTML = '<option value="">Select concept…</option>';
  state.concepts
    .filter((c) => c.id !== state.currentId)
    .forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.title;
      linkTargetSelect.appendChild(opt);
    });
}

async function loadLinksPanel() {
  if (!state.currentId) return;
  refreshLinkTargetSelect();
  try {
    const links = await api(`/api/links/for/${state.currentId}`);
    existingLinks.innerHTML = "";
    if (!links.length) {
      existingLinks.innerHTML = '<p class="muted">No connections yet.</p>';
      return;
    }
    links.forEach((lnk) => {
      const isSource = lnk.source_id === state.currentId;
      const otherTitle = isSource ? lnk.target_title : lnk.source_title;
      const arrow = isSource ? "→" : "←";
      const label = lnk.label ? ` <span class="link-label">(${escHtml(lnk.label)})</span>` : "";

      const item = document.createElement("div");
      item.className = "link-item";
      item.innerHTML = `
        <div class="link-item-info">
          <span class="link-direction">${arrow}</span>
          <strong>${escHtml(otherTitle)}</strong>${label}
        </div>
        <button class="link-delete-btn" data-id="${lnk.id}" title="Remove connection">×</button>
      `;
      existingLinks.appendChild(item);
    });
  } catch (e) {
    existingLinks.innerHTML = `<p class="muted">Error loading links.</p>`;
  }
}

existingLinks.addEventListener("click", async (e) => {
  const btn = e.target.closest(".link-delete-btn");
  if (!btn) return;
  try {
    await api(`/api/links/${btn.dataset.id}`, { method: "DELETE" });
    loadLinksPanel();
    loadGraph();
    showToast("Connection removed", "success");
  } catch (e) {
    showToast("Failed to remove: " + e.message, "error");
  }
});

addLinkBtn.addEventListener("click", async () => {
  const targetId = parseInt(linkTargetSelect.value);
  if (!targetId || !state.currentId) return;
  const label = linkLabelInput.value.trim();
  try {
    await api("/api/links", {
      method: "POST",
      body: JSON.stringify({
        source_id: state.currentId,
        target_id: targetId,
        label,
      }),
    });
    linkLabelInput.value = "";
    linkTargetSelect.value = "";
    loadLinksPanel();
    loadGraph();
    showToast("Connection added!", "success");
  } catch (e) {
    showToast("Failed to link: " + e.message, "error");
  }
});

/* ── Right Panel Tabs ─────────────────────────────────────────────────────── */
document.querySelectorAll(".right-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".right-tab-btn").forEach((b) =>
      b.classList.remove("active")
    );
    document.querySelectorAll(".right-panel-content").forEach((p) =>
      p.classList.remove("active")
    );
    btn.classList.add("active");
    $(`${btn.dataset.panel}-view`).classList.add("active");

    if (btn.dataset.panel === "graph") loadGraph();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   D3 GRAPH VISUALIZATION
   ════════════════════════════════════════════════════════════════════════════ */

const NODE_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#3b82f6",
];

const tagColorMap = new Map();
let colorIdx = 0;

function tagColor(tags) {
  const arr = safeParseJSON(tags, []);
  if (!arr.length) return NODE_COLORS[0];
  const key = arr[0];
  if (!tagColorMap.has(key)) {
    tagColorMap.set(key, NODE_COLORS[colorIdx % NODE_COLORS.length]);
    colorIdx++;
  }
  return tagColorMap.get(key);
}

async function loadGraph() {
  try {
    const data = await api("/api/graph");
    state.graphData = data;
    renderGraph(data);
  } catch (e) {
    console.error("Graph load error:", e);
  }
}

function renderGraph({ nodes, links }) {
  const container = $("graph-container");
  const svg = d3.select("#graph-svg");
  svg.selectAll("*").remove();

  const isEmpty = nodes.length === 0;
  graphEmpty.hidden = !isEmpty;
  if (isEmpty) return;

  const W = container.clientWidth;
  const H = container.clientHeight;

  // Build adjacency for degree computation
  const degreeMap = new Map();
  nodes.forEach((n) => degreeMap.set(n.id, 0));
  links.forEach((l) => {
    degreeMap.set(l.source_id, (degreeMap.get(l.source_id) || 0) + 1);
    degreeMap.set(l.target_id, (degreeMap.get(l.target_id) || 0) + 1);
  });

  // Map links to use object refs (D3 format)
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const linkData = links
    .map((l) => ({
      ...l,
      source: l.source_id,
      target: l.target_id,
    }))
    .filter((l) => nodeById.has(l.source) && nodeById.has(l.target));

  // Tooltip
  let tooltip = container.querySelector(".graph-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "graph-tooltip";
    container.appendChild(tooltip);
  }
  tooltip.style.display = "none";

  // Zoom layer
  const g = svg.append("g");

  const zoom = d3
    .zoom()
    .scaleExtent([0.2, 4])
    .on("zoom", (e) => g.attr("transform", e.transform));

  svg.call(zoom);

  // Arrow marker
  svg
    .append("defs")
    .append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 22)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("fill", "#475569")
    .attr("d", "M0,-5L10,0L0,5");

  // Links
  const link = g
    .append("g")
    .selectAll("line")
    .data(linkData)
    .join("line")
    .attr("class", "graph-link")
    .attr("marker-end", "url(#arrow)");

  // Link labels
  const linkLabel = g
    .append("g")
    .selectAll("text")
    .data(linkData.filter((l) => l.label))
    .join("text")
    .attr("class", "graph-link-label")
    .attr("text-anchor", "middle")
    .attr("dy", -4)
    .text((d) => d.label);

  // Node groups
  const node = g
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (d) =>
      "graph-node" + (d.id === state.currentId ? " selected" : "")
    )
    .call(
      d3
        .drag()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", dragEnded)
    )
    .on("click", (e, d) => {
      e.stopPropagation();
      selectConcept(d.id);
      // Update selection class
      node.classed("selected", (n) => n.id === d.id);
    })
    .on("mouseover", (e, d) => {
      tooltip.style.display = "block";
      tooltip.textContent = d.title;
    })
    .on("mousemove", (e) => {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = e.clientX - rect.left + 12 + "px";
      tooltip.style.top = e.clientY - rect.top + 12 + "px";
    })
    .on("mouseleave", () => {
      tooltip.style.display = "none";
    });

  node
    .append("circle")
    .attr("r", (d) => 10 + (degreeMap.get(d.id) || 0) * 2.5)
    .attr("fill", (d) => tagColor(d.tags))
    .attr("stroke", (d) => (d.id === state.currentId ? "#fff" : "rgba(0,0,0,0.4)"))
    .attr("stroke-width", (d) => (d.id === state.currentId ? 3 : 2));

  node
    .append("text")
    .attr("class", "graph-label")
    .attr("dy", (d) => -(12 + (degreeMap.get(d.id) || 0) * 2.5 + 4))
    .attr("text-anchor", "middle")
    .text((d) => truncate(d.title, 18));

  // Force simulation
  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(linkData)
        .id((d) => d.id)
        .distance(100)
        .strength(0.5)
    )
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("collision", d3.forceCollide().radius(30))
    .on("tick", ticked);

  state.graphSimulation = simulation;

  function ticked() {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    linkLabel
      .attr("x", (d) => (d.source.x + d.target.x) / 2)
      .attr("y", (d) => (d.source.y + d.target.y) / 2);

    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  function dragStarted(e, d) {
    if (!e.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }
  function dragged(e, d) {
    d.fx = e.x;
    d.fy = e.y;
  }
  function dragEnded(e, d) {
    if (!e.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  // Auto-fit after simulation settles
  setTimeout(() => fitGraph(svg, g, W, H, zoom), 1500);
}

function fitGraph(svg, g, W, H, zoom) {
  const bounds = g.node().getBBox();
  if (!bounds.width || !bounds.height) return;
  const scale = Math.min(
    0.9,
    Math.min(W / bounds.width, H / bounds.height) * 0.8
  );
  const tx = W / 2 - scale * (bounds.x + bounds.width / 2);
  const ty = H / 2 - scale * (bounds.y + bounds.height / 2);
  svg
    .transition()
    .duration(600)
    .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function highlightGraphNode(id) {
  d3.selectAll(".graph-node").classed("selected", (d) => d && d.id === id);
  d3.selectAll(".graph-node circle").attr("stroke", (d) =>
    d && d.id === id ? "#fff" : "rgba(0,0,0,0.4)"
  ).attr("stroke-width", (d) => (d && d.id === id ? 3 : 2));
}

$("reset-zoom-btn").addEventListener("click", () => {
  const svg = d3.select("#graph-svg");
  const g = svg.select("g");
  const container = $("graph-container");
  const zoom = d3.zoom().scaleExtent([0.2, 4]);
  svg.call(zoom);
  fitGraph(
    svg,
    g,
    container.clientWidth,
    container.clientHeight,
    zoom
  );
});

$("refresh-graph-btn").addEventListener("click", loadGraph);

/* ════════════════════════════════════════════════════════════════════════════
   AI CHAT
   ════════════════════════════════════════════════════════════════════════════ */

function appendChatMessage(role, html, streaming = false) {
  // Remove welcome message
  const welcome = chatMessages.querySelector(".chat-welcome");
  if (welcome) welcome.remove();

  const div = document.createElement("div");
  div.className = `chat-message ${role}`;
  div.innerHTML = `
    <div class="chat-message-role">${role === "user" ? "You" : "Assistant"}</div>
    <div class="chat-message-body">${html}</div>
  `;
  if (streaming) div.dataset.streaming = "1";
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function showThinkingIndicator() {
  const div = document.createElement("div");
  div.className = "thinking-indicator";
  div.id = "thinking-indicator";
  div.innerHTML = `
    <span>Thinking</span>
    <span class="thinking-dots">
      <span></span><span></span><span></span>
    </span>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeThinkingIndicator() {
  const el = $("thinking-indicator");
  if (el) el.remove();
}

async function sendChat() {
  if (state.chatStreaming) return;
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = "";
  chatInput.style.height = "";

  // Add user message to history
  state.chatMessages.push({ role: "user", content: text });
  appendChatMessage("user", escHtml(text).replace(/\n/g, "<br>"));

  state.chatStreaming = true;
  sendChatBtn.disabled = true;
  sendChatBtn.textContent = "…";

  showThinkingIndicator();

  // Placeholder for streaming response
  let assistantDiv = null;
  let buffer = "";
  let thinkingDone = false;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.chatMessages,
        include_context: includeContext.checked,
      }),
    });

    if (!res.ok) throw new Error(await res.text());

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let partial = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });
      const lines = partial.split("\n");
      partial = lines.pop(); // last (possibly incomplete) line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));

          if (evt.type === "thinking_start") {
            // Keep thinking indicator showing
          } else if (evt.type === "thinking_end") {
            thinkingDone = true;
            removeThinkingIndicator();
          } else if (evt.type === "text") {
            if (!thinkingDone) {
              removeThinkingIndicator();
              thinkingDone = true;
            }
            buffer += evt.content;
            if (!assistantDiv) {
              assistantDiv = appendChatMessage("assistant", "", true);
            }
            assistantDiv.querySelector(".chat-message-body").innerHTML =
              marked.parse(buffer);
            chatMessages.scrollTop = chatMessages.scrollHeight;
          } else if (evt.type === "done") {
            // Stream complete
          } else if (evt.type === "error") {
            removeThinkingIndicator();
            showToast("AI error: " + evt.content, "error");
          }
        } catch (_) {
          // JSON parse error, skip line
        }
      }
    }

    // Save to history
    if (buffer) {
      state.chatMessages.push({ role: "assistant", content: buffer });
    }
  } catch (e) {
    removeThinkingIndicator();
    showToast("Chat error: " + e.message, "error");
    if (!assistantDiv) {
      appendChatMessage("assistant", "Sorry, an error occurred. Please try again.");
    }
  } finally {
    state.chatStreaming = false;
    sendChatBtn.disabled = false;
    sendChatBtn.textContent = "Send";
  }
}

sendChatBtn.addEventListener("click", sendChat);

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

// Auto-resize chat textarea
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});

/* ── Keyboard Shortcuts ───────────────────────────────────────────────────── */
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveConcept();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    createConcept();
  }
});

/* ── Event Listeners ──────────────────────────────────────────────────────── */
$("new-concept-btn").addEventListener("click", createConcept);
saveBtn.addEventListener("click", saveConcept);
deleteBtn.addEventListener("click", deleteConcept);
searchInput.addEventListener("input", renderConceptList);

/* ── Utilities ────────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function safeParseJSON(str, fallback) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

/* ── Bootstrap ────────────────────────────────────────────────────────────── */
async function init() {
  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  await loadConcepts();
  await loadGraph();
}

init();
