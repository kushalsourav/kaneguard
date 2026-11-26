(() => {
  const STORAGE_KEY = "mini-tasks:tasks";

  const formEl = document.getElementById("task-form");
  const inputEl = document.getElementById("task-input");
  const errorEl = document.getElementById("task-error");
  const counterEl = document.getElementById("task-counter");
  const listEl = document.getElementById("task-list");

  /**
   * Offline localStorage persistence adapter (substitutes for /api/tasks).
   */
  const taskStorage = {
    load() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return [];
        }
        return parsed
          .filter(
            (item) =>
              item &&
              typeof item === "object" &&
              typeof item.id === "string" &&
              typeof item.text === "string" &&
              item.text.trim().length > 0
          )
          .map((item) => ({
            id: item.id,
            text: item.text,
            done: Boolean(item.done),
          }));
      } catch {
        return [];
      }
    },
    save(taskList) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(taskList));
      } catch {
        // Ignore storage write errors when storage is unavailable or full.
      }
    },
  };

  const tasks = taskStorage.load();

  function updateCounter() {
    const doneCount = tasks.filter((task) => task.done).length;
    counterEl.textContent = `${doneCount} of ${tasks.length} done`;
  }

  function showError(message) {
    errorEl.textContent = message;
    inputEl.setAttribute("aria-invalid", "true");
  }

  function clearError() {
    errorEl.textContent = "";
    inputEl.removeAttribute("aria-invalid");
  }

  function toggleTaskDone(task, itemEl, checked) {
    task.done = checked;
    itemEl.classList.toggle("is-done", task.done);
    taskStorage.save(tasks);
    updateCounter();
  }

  function deleteTask(taskId) {
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      return;
    }

    tasks.splice(index, 1);
    taskStorage.save(tasks);
    renderTasks();
    updateCounter();
  }

  function createTaskElement(task) {
    const itemEl = document.createElement("li");
    itemEl.className = "task-item";
    itemEl.classList.toggle("is-done", Boolean(task.done));
    itemEl.dataset.id = task.id;

    const checkboxId = `task-checkbox-${task.id}`;
    const checkboxEl = document.createElement("input");
    checkboxEl.type = "checkbox";
    checkboxEl.id = checkboxId;
    checkboxEl.className = "task-checkbox";
    checkboxEl.checked = Boolean(task.done);
    checkboxEl.addEventListener("change", () => {
      toggleTaskDone(task, itemEl, checkboxEl.checked);
    });

    const textEl = document.createElement("label");
    textEl.className = "task-text";
    textEl.htmlFor = checkboxId;
    textEl.textContent = task.text;

    const deleteButtonEl = document.createElement("button");
    deleteButtonEl.type = "button";
    deleteButtonEl.className = "delete-button";
    deleteButtonEl.textContent = "Delete";
    deleteButtonEl.addEventListener("click", () => {
      deleteTask(task.id);
    });

    itemEl.append(checkboxEl, textEl, deleteButtonEl);
    return itemEl;
  }

  function renderTasks() {
    listEl.textContent = "";
    for (const task of tasks) {
      listEl.appendChild(createTaskElement(task));
    }
  }

  function handleFormSubmit(event) {
    event.preventDefault();

    const text = inputEl.value.trim();
    if (!text) {
      showError("Task is required");
      inputEl.focus();
      return;
    }

    const newTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      done: false,
    };

    tasks.push(newTask);
    taskStorage.save(tasks);
    inputEl.value = "";
    clearError();
    renderTasks();
    updateCounter();
    inputEl.focus();
  }

  formEl.addEventListener("submit", handleFormSubmit);
  renderTasks();
  updateCounter();
})();
