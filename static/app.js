/* ============================================================
   State
   ============================================================ */
const state = {
  projects: [],
  tasks: [],          // tasks currently displayed
  currentProjectId: null, // null = "All Tasks"
  editingProject: null,
  editingTask: null,
};

/* ============================================================
   Init
   ============================================================ */
async function init() {
  await loadProjects();
  await loadTasks();
}

/* ============================================================
   Projects
   ============================================================ */
async function loadProjects() {
  const res = await fetch("/api/projects");
  state.projects = await res.json();
  renderSidebar();
}

function renderSidebar() {
  // Update "All Tasks" badge
  const totalOpen = state.projects.reduce(
    (sum, p) => sum + p.task_count - p.done_count, 0
  );
  const badgeAll = document.getElementById("badge-all");
  badgeAll.textContent = totalOpen > 0 ? totalOpen : "";

  // Active state for "All Tasks"
  document.getElementById("btn-all-tasks")
    .classList.toggle("active", state.currentProjectId === null);

  // Project list
  const list = document.getElementById("project-list");
  list.innerHTML = "";
  state.projects.forEach((p) => {
    const btn = document.createElement("button");
    btn.className =
      "project-nav-item" + (state.currentProjectId === p.id ? " active" : "");
    const pending = p.task_count - p.done_count;
    btn.innerHTML = `
      <span class="project-dot"></span>
      <span class="project-nav-name">${esc(p.name)}</span>
      <span class="project-nav-count">${pending > 0 ? pending : ""}</span>
    `;
    btn.onclick = () => selectProject(p.id);
    list.appendChild(btn);
  });
}

async function selectProject(id) {
  state.currentProjectId = id;
  renderSidebar();
  updateTopbar();
  await loadTasks();
  applyFilters();
}

function updateTopbar() {
  const project = state.projects.find((p) => p.id === state.currentProjectId);
  const titleEl = document.getElementById("view-title");
  const subEl = document.getElementById("view-subtitle");
  const addBtn = document.getElementById("btn-add-task");
  const editBtn = document.getElementById("btn-edit-project");
  const delBtn = document.getElementById("btn-delete-project");

  if (project) {
    titleEl.textContent = project.name;
    subEl.textContent = project.description || "";
    addBtn.style.display = "";
    editBtn.style.display = "";
    delBtn.style.display = "";
  } else {
    titleEl.textContent = "All Tasks";
    subEl.textContent = "";
    addBtn.style.display = "none";
    editBtn.style.display = "none";
    delBtn.style.display = "none";
  }
}

/* Project modal */
function openProjectModal(project) {
  state.editingProject = project;
  document.getElementById("project-modal-title").textContent =
    project ? "Edit Project" : "New Project";
  document.getElementById("project-name").value = project ? project.name : "";
  document.getElementById("project-desc").value =
    project ? project.description : "";
  openModal("project-modal");
  document.getElementById("project-name").focus();
}

function editCurrentProject() {
  const project = state.projects.find((p) => p.id === state.currentProjectId);
  if (project) openProjectModal(project);
}

async function saveProject() {
  const name = document.getElementById("project-name").value.trim();
  if (!name) {
    document.getElementById("project-name").focus();
    return;
  }
  const payload = {
    name,
    description: document.getElementById("project-desc").value.trim(),
  };
  if (state.editingProject) {
    await fetch(`/api/projects/${state.editingProject.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const created = await res.json();
    // auto-select new project
    state.currentProjectId = created.id;
  }
  closeModal("project-modal");
  await loadProjects();
  updateTopbar();
  await loadTasks();
}

async function deleteCurrentProject() {
  const project = state.projects.find((p) => p.id === state.currentProjectId);
  if (!project) return;
  confirm(
    `Delete project "${project.name}" and all its tasks?`,
    async () => {
      await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      state.currentProjectId = null;
      await loadProjects();
      updateTopbar();
      await loadTasks();
    }
  );
}

/* ============================================================
   Tasks
   ============================================================ */
async function loadTasks() {
  let res;
  if (state.currentProjectId === null) {
    res = await fetch("/api/tasks");
  } else {
    res = await fetch(`/api/projects/${state.currentProjectId}/tasks`);
  }
  state.tasks = await res.json();
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById("search").value.toLowerCase();
  const status = document.getElementById("filter-status").value;
  const priority = document.getElementById("filter-priority").value;

  let filtered = state.tasks.filter((t) => {
    if (status !== "all" && t.status !== status) return false;
    if (priority !== "all" && t.priority !== priority) return false;
    if (q) {
      const hay =
        (t.title + " " + t.description + " " + (t.tags || []).join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  renderTasks(filtered);
}

function renderTasks(tasks) {
  const list = document.getElementById("task-list");
  const empty = document.getElementById("empty-state");
  const emptySub = document.getElementById("empty-sub");
  list.innerHTML = "";

  if (tasks.length === 0) {
    empty.style.display = "";
    emptySub.textContent =
      state.currentProjectId
        ? 'No tasks match your filters. Click "+ Add Task" to create one.'
        : "Select a project and add your first task.";
    return;
  }
  empty.style.display = "none";

  tasks.forEach((task) => {
    const card = document.createElement("div");
    card.className = "task-card" + (task.status === "done" ? " done" : "");

    const tagsHtml = (task.tags || [])
      .map((t) => `<span class="badge badge-tag">#${esc(t)}</span>`)
      .join("");

    const projectBadge =
      task.project_name
        ? `<span class="badge badge-project">${esc(task.project_name)}</span>`
        : "";

    const dueHtml = task.due_date ? renderDueDate(task.due_date) : "";

    const nextStatus = cycleStatus(task.status);
    const statusLabel = {
      todo: "To Do",
      in_progress: "In Progress",
      done: "Done",
    }[task.status];

    card.innerHTML = `
      <div class="task-main">
        <div class="task-title">${esc(task.title)}</div>
        ${task.description ? `<div class="task-desc">${esc(task.description)}</div>` : ""}
        <div class="task-meta">
          <span class="badge badge-priority-${task.priority}">${cap(task.priority)}</span>
          <span class="badge badge-status-${task.status}">${statusLabel}</span>
          ${dueHtml}
          ${tagsHtml}
          ${projectBadge}
        </div>
      </div>
      <div class="task-actions">
        <div class="action-group">
          <button class="btn-action" title="Edit" onclick="openTaskModal(${task.id})">&#9998;</button>
          <button class="btn-action danger" title="Delete" onclick="deleteTask(${task.id}, '${esc(task.title).replace(/'/g, "\\'")}')">&#128465;</button>
        </div>
        <button class="btn-action" title="Advance status" onclick="cycleTaskStatus(${task.id}, '${nextStatus}')" style="font-size:11px;padding:3px 7px">
          ${nextStatus === "done" ? "&#10003;" : nextStatus === "in_progress" ? "&#9654;" : "&#8635;"}&nbsp;${cap(nextStatus.replace("_", " "))}
        </button>
      </div>
    `;
    list.appendChild(card);
  });
}

function renderDueDate(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = dateStr < today;
  const cls = overdue ? "due-date overdue" : "due-date";
  const icon = overdue ? "&#9888;" : "&#128197;";
  return `<span class="${cls}">${icon} ${dateStr}</span>`;
}

function cycleStatus(current) {
  return { todo: "in_progress", in_progress: "done", done: "todo" }[current];
}

async function cycleTaskStatus(id, newStatus) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  await fetch(`/api/tasks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...task, status: newStatus, tags: task.tags || [] }),
  });
  await loadTasks();
}

/* Task modal */
function openTaskModal(taskId) {
  // populate project dropdown
  const sel = document.getElementById("task-project");
  sel.innerHTML = "";
  state.projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === state.currentProjectId) opt.selected = true;
    sel.appendChild(opt);
  });

  if (taskId === null) {
    // New task
    state.editingTask = null;
    document.getElementById("task-modal-title").textContent = "New Task";
    document.getElementById("task-title").value = "";
    document.getElementById("task-desc").value = "";
    document.getElementById("task-priority").value = "medium";
    document.getElementById("task-status").value = "todo";
    document.getElementById("task-due").value = "";
    document.getElementById("task-tags").value = "";
  } else {
    // Edit task
    const task = state.tasks.find((t) => t.id === taskId);
    state.editingTask = task;
    document.getElementById("task-modal-title").textContent = "Edit Task";
    document.getElementById("task-title").value = task.title;
    document.getElementById("task-desc").value = task.description;
    document.getElementById("task-priority").value = task.priority;
    document.getElementById("task-status").value = task.status;
    document.getElementById("task-due").value = task.due_date || "";
    document.getElementById("task-tags").value = (task.tags || []).join(", ");
    sel.value = task.project_id;
  }

  openModal("task-modal");
  document.getElementById("task-title").focus();
}

async function saveTask() {
  const title = document.getElementById("task-title").value.trim();
  if (!title) {
    document.getElementById("task-title").focus();
    return;
  }
  const projectId = parseInt(document.getElementById("task-project").value, 10);
  const tagsRaw = document.getElementById("task-tags").value;
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const payload = {
    title,
    description: document.getElementById("task-desc").value.trim(),
    priority: document.getElementById("task-priority").value,
    status: document.getElementById("task-status").value,
    due_date: document.getElementById("task-due").value || null,
    tags,
  };

  if (state.editingTask) {
    await fetch(`/api/tasks/${state.editingTask.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    await fetch(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  closeModal("task-modal");
  await loadProjects(); // refresh counts
  await loadTasks();
}

async function deleteTask(id, title) {
  confirm(`Delete task "${title}"?`, async () => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    await loadProjects();
    await loadTasks();
  });
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

// Confirm dialog
function confirm(message, onOk) {
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

function cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ============================================================
   Keyboard shortcuts
   ============================================================ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    ["task-modal", "project-modal", "confirm-modal"].forEach(closeModal);
  }
});

/* ============================================================
   Boot
   ============================================================ */
init();
