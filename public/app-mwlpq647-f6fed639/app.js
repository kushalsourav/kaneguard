(() => {
  "use strict";

  const STORAGE_KEY = "kaneguard-todo-tasks-v1";
  const form = document.querySelector("#task-form");
  const input = document.querySelector("#task-input");
  const list = document.querySelector("#task-list");
  const summary = document.querySelector("#task-summary");
  const emptyState = document.querySelector("#empty-state");
  const emptyTitle = document.querySelector("#empty-title");
  const emptyCopy = document.querySelector("#empty-copy");
  const statusMessage = document.querySelector("#status-message");
  const filterButtons = [...document.querySelectorAll("[data-filter]")];

  let fallbackIdSequence = 0;
  let tasks = loadTasks();
  let currentFilter = "all";

  function loadTasks() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) return [];
      const seenIds = new Set();

      return saved.reduce((validTasks, task) => {
        const text = typeof task?.text === "string" ? task.text.trim() : "";
        const isValid = (
          typeof task?.id === "string" &&
          task.id.length > 0 &&
          !seenIds.has(task.id) &&
          text.length > 0 &&
          typeof task.completed === "boolean"
        );

        if (isValid) {
          seenIds.add(task.id);
          validTasks.push({ id: task.id, text, completed: task.completed });
        }

        return validTasks;
      }, []);
    } catch {
      return [];
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      return true;
    } catch {
      announce("Tasks could not be saved in this browser.");
      return false;
    }
  }

  function createTaskId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    fallbackIdSequence += 1;
    return `${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function announce(message) {
    statusMessage.textContent = "";
    window.setTimeout(() => {
      statusMessage.textContent = message;
    }, 30);
  }

  function visibleTasks() {
    if (currentFilter === "active") return tasks.filter((task) => !task.completed);
    if (currentFilter === "completed") return tasks.filter((task) => task.completed);
    return tasks;
  }

  function summaryText() {
    const activeCount = tasks.filter((task) => !task.completed).length;
    const activeLabel = `${activeCount} active ${activeCount === 1 ? "task" : "tasks"}`;
    if (tasks.length === 0) return activeLabel;
    const completedCount = tasks.length - activeCount;
    return completedCount > 0 ? `${activeLabel} · ${completedCount} completed` : activeLabel;
  }

  function createTaskItem(task) {
    const item = document.createElement("li");
    item.className = `task-item${task.completed ? " is-completed" : ""}`;
    item.dataset.taskId = task.id;

    const completionLabel = document.createElement("label");
    completionLabel.className = "completion-control";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", `Mark ${task.text} as ${task.completed ? "active" : "complete"}`);
    checkbox.addEventListener("change", () => setTaskCompletion(task.id, checkbox.checked));

    const checkmark = document.createElement("span");
    checkmark.className = "checkmark";
    checkmark.setAttribute("aria-hidden", "true");
    checkmark.innerHTML = '<svg viewBox="0 0 16 16"><path d="m3 8.2 3 3L13 4.8"/></svg>';

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Delete ${task.text}`);
    deleteButton.title = `Delete ${task.text}`;
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 3.8h6M7.2 7l.7 13h8.2l.7-13M10 10.5v5.8M14 10.5v5.8"/></svg><span>Delete</span>';
    deleteButton.addEventListener("click", () => deleteTask(task.id));

    completionLabel.append(checkbox, checkmark);
    item.append(completionLabel, text, deleteButton);
    return item;
  }

  function render() {
    const filteredTasks = visibleTasks();
    list.replaceChildren(...filteredTasks.map(createTaskItem));
    summary.textContent = summaryText();

    filterButtons.forEach((button) => {
      const selected = button.dataset.filter === currentFilter;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      if (selected) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });

    emptyState.hidden = filteredTasks.length > 0;
    list.hidden = filteredTasks.length === 0;

    if (tasks.length === 0) {
      emptyTitle.textContent = "Your list is clear";
      emptyCopy.textContent = "Add your first task above and start making progress.";
    } else if (currentFilter === "active") {
      emptyTitle.textContent = "No active tasks";
      emptyCopy.textContent = "Everything is complete. Nicely done.";
    } else if (currentFilter === "completed") {
      emptyTitle.textContent = "No completed tasks yet";
      emptyCopy.textContent = "Completed tasks will appear here.";
    }
  }

  function addTask(text) {
    const task = {
      id: createTaskId(),
      text,
      completed: false
    };
    tasks.push(task);
    saveTasks();
    render();
    announce(`${text} added.`);
  }

  function setTaskCompletion(id, completed) {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    task.completed = completed;
    saveTasks();
    render();
    announce(`${task.text} marked ${task.completed ? "complete" : "active"}.`);
  }

  function deleteTask(id) {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    tasks = tasks.filter((candidate) => candidate.id !== id);
    saveTasks();
    render();
    announce(`${task.text} deleted.`);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      announce("Enter a task before adding it.");
      input.focus();
      return;
    }
    addTask(text);
    input.value = "";
    input.focus();
  });

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter;
      render();
      announce(`Showing ${button.textContent.toLowerCase()} tasks.`);
    });
  });

  render();
})();
