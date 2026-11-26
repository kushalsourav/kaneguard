(() => {
  const STORAGE_KEY = "taskledger.tasks";
  const ALLOWED_PRIORITIES = new Set(["Low", "Medium", "High"]);
  const ALLOWED_FILTERS = new Set(["all", "open", "completed"]);

  const state = {
    tasks: [],
    nextId: 1,
    filter: "all",
    searchQuery: "",
  };

  const form = document.getElementById("task-form");
  const titleInput = document.getElementById("task-title");
  const prioritySelect = document.getElementById("task-priority");
  const errorMessage = document.getElementById("task-title-error");
  const statusFilters = document.getElementById("status-filters");
  const filterButtons = Array.from(
    statusFilters.querySelectorAll("[data-filter]")
  );
  const searchInput = document.getElementById("task-search");
  const taskList = document.getElementById("task-list");
  const emptyState = document.getElementById("empty-state");
  const totalCount = document.getElementById("total-count");
  const openCount = document.getElementById("open-count");
  const completedCount = document.getElementById("completed-count");

  function setError(message) {
    if (message) {
      errorMessage.textContent = message;
      errorMessage.hidden = false;
      titleInput.setAttribute("aria-invalid", "true");
    } else {
      errorMessage.textContent = "";
      errorMessage.hidden = true;
      titleInput.removeAttribute("aria-invalid");
    }
  }

  function createTask(title, priority) {
    const normalizedPriority = ALLOWED_PRIORITIES.has(priority)
      ? priority
      : "Medium";

    return {
      id: `task-${state.nextId++}`,
      title,
      priority: normalizedPriority,
      status: "open",
    };
  }

  function normalizeStoredTask(entry, seenIds) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) {
      return null;
    }

    const priority = ALLOWED_PRIORITIES.has(entry.priority)
      ? entry.priority
      : "Medium";

    let status = "open";
    if (entry.status === "completed") {
      status = "completed";
    } else if (entry.status !== "open" && entry.completed === true) {
      status = "completed";
    }

    let id =
      typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : "";
    if (!id || seenIds.has(id)) {
      id = `task-${state.nextId++}`;
    } else {
      const match = /^task-(\d+)$/.exec(id);
      if (match) {
        const numericId = Number(match[1]);
        if (Number.isSafeInteger(numericId) && numericId >= state.nextId) {
          state.nextId = numericId + 1;
        }
      }
    }
    seenIds.add(id);

    return { id, title, priority, status };
  }

  function loadTasks() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      const seenIds = new Set();
      const tasks = [];
      for (const entry of parsed) {
        const task = normalizeStoredTask(entry, seenIds);
        if (task) {
          tasks.push(task);
        }
      }
      return tasks;
    } catch {
      return [];
    }
  }

  function saveTasks() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch {
      // Ignore storage errors when localStorage is unavailable or full.
    }
  }

  function renderCounters() {
    const total = state.tasks.length;
    const completed = state.tasks.filter(
      (task) => task.status === "completed"
    ).length;
    const open = total - completed;

    totalCount.textContent = String(total);
    openCount.textContent = String(open);
    completedCount.textContent = String(completed);
  }

  function renderTaskItem(task) {
    const isCompleted = task.status === "completed";
    const item = document.createElement("li");
    item.className = isCompleted
      ? "task-item task-item--completed"
      : "task-item";
    item.dataset.taskId = task.id;
    item.dataset.status = task.status;

    const main = document.createElement("div");
    main.className = "task-main";

    const titleEl = document.createElement("span");
    titleEl.className = "task-title";
    titleEl.textContent = task.title;
    main.appendChild(titleEl);

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const priorityBadge = document.createElement("span");
    priorityBadge.className = `badge badge--priority-${task.priority.toLowerCase()}`;
    priorityBadge.textContent = task.priority;

    const statusBadge = document.createElement("span");
    statusBadge.className = `badge badge--status-${task.status}`;
    statusBadge.textContent = isCompleted ? "Completed" : "Open";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = isCompleted
      ? "btn-task-action btn-task-action--reopen"
      : "btn-task-action btn-task-action--complete";
    toggleButton.dataset.action = "toggle-status";
    toggleButton.dataset.taskId = task.id;
    toggleButton.textContent = isCompleted ? "Reopen" : "Complete";
    toggleButton.setAttribute(
      "aria-label",
      isCompleted ? `Reopen ${task.title}` : `Complete ${task.title}`
    );

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn-task-action btn-task-action--delete";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.taskId = task.id;
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${task.title}`);

    meta.append(priorityBadge, statusBadge, toggleButton, deleteButton);
    item.append(main, meta);

    return item;
  }

  function toggleTaskStatus(taskId) {
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task) {
      return;
    }

    task.status = task.status === "completed" ? "open" : "completed";
    saveTasks();
    render();
  }

  function deleteTask(taskId) {
    const index = state.tasks.findIndex((entry) => entry.id === taskId);
    if (index === -1) {
      return false;
    }

    state.tasks.splice(index, 1);
    saveTasks();
    render();
    return true;
  }

  function getVisibleTasks() {
    const query = state.searchQuery.trim().toLowerCase();

    return state.tasks.filter((task) => {
      const matchesStatus =
        state.filter === "all" || task.status === state.filter;
      const matchesSearch =
        query === "" || task.title.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }

  function renderFilters() {
    for (const button of filterButtons) {
      const isActive = button.dataset.filter === state.filter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  }

  function renderTasks() {
    const visibleTasks = getVisibleTasks();
    taskList.replaceChildren(...visibleTasks.map(renderTaskItem));

    const hasVisibleTasks = visibleTasks.length > 0;
    if (!hasVisibleTasks) {
      emptyState.textContent =
        state.tasks.length === 0
          ? "No tasks yet. Add a task above to get started."
          : "No tasks match the current filter or search.";
    }
    emptyState.hidden = hasVisibleTasks;
    taskList.hidden = !hasVisibleTasks;
  }

  function render() {
    renderCounters();
    renderFilters();
    renderTasks();
  }

  function handleFilterClick(event) {
    const filterButton = event.target.closest("[data-filter]");
    if (!filterButton) {
      return;
    }

    const nextFilter = filterButton.dataset.filter;
    if (!ALLOWED_FILTERS.has(nextFilter) || state.filter === nextFilter) {
      return;
    }

    state.filter = nextFilter;
    render();
  }

  function handleSearchInput(event) {
    state.searchQuery = event.target.value;
    renderTasks();
  }

  function handleFormSubmit(event) {
    event.preventDefault();

    const title = titleInput.value.trim();
    if (!title) {
      setError("Please enter a task title.");
      titleInput.focus();
      return;
    }

    setError("");
    const task = createTask(title, prioritySelect.value);
    state.tasks.push(task);
    saveTasks();

    form.reset();
    render();
    titleInput.focus();
  }

  function handleTaskListClick(event) {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) {
      return;
    }

    const { action, taskId } = actionButton.dataset;
    if (!taskId) {
      return;
    }

    if (action === "toggle-status") {
      toggleTaskStatus(taskId);
      const updatedButton = Array.from(
        taskList.querySelectorAll('[data-action="toggle-status"]')
      ).find((button) => button.dataset.taskId === taskId);
      if (updatedButton) {
        updatedButton.focus();
      }
      return;
    }

    if (action === "delete") {
      const visibleIdsBeforeDelete = Array.from(
        taskList.querySelectorAll('li[data-task-id]')
      ).map((item) => item.dataset.taskId);
      const removedIndex = visibleIdsBeforeDelete.indexOf(taskId);

      if (!deleteTask(taskId)) {
        return;
      }

      const remainingDeleteButtons = Array.from(
        taskList.querySelectorAll('[data-action="delete"]')
      );
      if (remainingDeleteButtons.length > 0) {
        const nextIndex = Math.min(
          Math.max(removedIndex, 0),
          remainingDeleteButtons.length - 1
        );
        remainingDeleteButtons[nextIndex].focus();
      } else if (state.searchQuery.trim()) {
        searchInput.focus();
      } else {
        titleInput.focus();
      }
    }
  }

  titleInput.addEventListener("input", () => {
    if (!errorMessage.hidden && titleInput.value.trim()) {
      setError("");
    }
  });

  form.addEventListener("submit", handleFormSubmit);
  statusFilters.addEventListener("click", handleFilterClick);
  searchInput.addEventListener("input", handleSearchInput);
  taskList.addEventListener("click", handleTaskListClick);

  state.tasks = loadTasks();
  render();
})();
