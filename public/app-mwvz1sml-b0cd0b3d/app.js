// FlowDesk landing page — features, pricing, reviews, FAQ, signup validation.

const FEATURE_DESCRIPTIONS = {
  kanban: "Visual boards that keep every task moving from idea to done.",
  chat: "Keep decisions next to the work with focused team conversations.",
  time: "Log hours against tasks so estimates stay honest and useful.",
  reports: "See throughput and blockers at a glance with clear reports.",
};

const PLAN_RATES = {
  Starter: 0,
  Team: 399,
  Business: 799,
};

function formatRupees(amount) {
  return `₹${amount}/month`;
}

function clampSeats(value) {
  const n = Number.parseInt(String(value), 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(50, Math.max(1, n));
}

function initFeatureCards() {
  const cards = document.querySelectorAll(".feature-card[data-feature]");
  const detail = document.getElementById("feature-detail");
  if (!cards.length || !detail) return;

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const key = card.dataset.feature;
      const description = FEATURE_DESCRIPTIONS[key];
      if (!description) return;

      cards.forEach((other) => {
        const selected = other === card;
        other.classList.toggle("is-selected", selected);
        other.setAttribute("aria-pressed", selected ? "true" : "false");
      });

      detail.hidden = false;
      detail.textContent = description;
    });
  });
}

function updatePlanTotals(seats) {
  Object.entries(PLAN_RATES).forEach(([plan, rate]) => {
    const el = document.querySelector(`[data-plan-total="${plan}"]`);
    if (!el) return;
    const total = plan === "Starter" ? 0 : rate * seats;
    el.textContent = formatRupees(total);
  });
}

function initPricing() {
  const seatsInput = document.getElementById("seats");
  const selectedPlanEl = document.getElementById("selected-plan");
  const chooseButtons = document.querySelectorAll("[data-plan]");

  if (!seatsInput || !selectedPlanEl) return;

  const refreshTotals = () => {
    const seats = clampSeats(seatsInput.value);
    if (String(seatsInput.value) !== String(seats)) {
      seatsInput.value = String(seats);
    }
    updatePlanTotals(seats);
  };

  seatsInput.addEventListener("input", refreshTotals);
  seatsInput.addEventListener("change", refreshTotals);

  chooseButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.plan;
      if (!name) return;
      selectedPlanEl.hidden = false;
      selectedPlanEl.textContent = `Selected plan: ${name}`;
    });
  });

  refreshTotals();
}

function initReviewSlider() {
  const reviews = Array.from(document.querySelectorAll(".review-card[data-review-index]"));
  const prevBtn = document.getElementById("review-prev");
  const nextBtn = document.getElementById("review-next");
  if (reviews.length < 2 || !prevBtn || !nextBtn) return;

  let current = reviews.findIndex((card) => card.classList.contains("is-active"));
  if (current < 0) current = 0;

  const showReview = (index) => {
    const next = ((index % reviews.length) + reviews.length) % reviews.length;
    reviews.forEach((card, i) => {
      const active = i === next;
      card.classList.toggle("is-active", active);
      card.hidden = !active;
    });
    current = next;
  };

  prevBtn.addEventListener("click", () => showReview(current - 1));
  nextBtn.addEventListener("click", () => showReview(current + 1));
  showReview(current);
}

function initFaqAccordion() {
  const items = Array.from(document.querySelectorAll(".faq-item"));
  if (!items.length) return;

  const setOpen = (item, open) => {
    const button = item.querySelector(".faq-question");
    const answer = item.querySelector(".faq-answer");
    if (!button || !answer) return;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    answer.hidden = !open;
    item.classList.toggle("is-open", open);
  };

  items.forEach((item) => {
    const button = item.querySelector(".faq-question");
    if (!button) return;

    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      items.forEach((other) => setOpen(other, false));
      if (!isOpen) setOpen(item, true);
    });
  });
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function setFieldError(input, errorEl, message) {
  if (!errorEl || !input) return;
  if (message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
  } else {
    errorEl.textContent = "";
    errorEl.hidden = true;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
  }
}

function initSignupForm() {
  const form = document.getElementById("signup-form");
  const successEl = document.getElementById("signup-success");
  if (!form || !successEl) return;

  const nameInput = document.getElementById("name");
  const emailInput = document.getElementById("email");
  const companyInput = document.getElementById("company");
  const nameError = document.getElementById("name-error");
  const emailError = document.getElementById("email-error");
  const companyError = document.getElementById("company-error");

  if (!nameInput || !emailInput || !companyInput) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const company = companyInput.value.trim();

    let valid = true;

    if (!name) {
      setFieldError(nameInput, nameError, "Please enter your name.");
      valid = false;
    } else {
      setFieldError(nameInput, nameError, "");
    }

    if (!email || !isValidEmail(email)) {
      setFieldError(emailInput, emailError, "Please enter a valid work email.");
      valid = false;
    } else {
      setFieldError(emailInput, emailError, "");
    }

    if (!company) {
      setFieldError(companyInput, companyError, "Please enter your company name.");
      valid = false;
    } else {
      setFieldError(companyInput, companyError, "");
    }

    if (!valid) return;

    form.hidden = true;
    successEl.hidden = false;
    successEl.textContent = `Welcome to FlowDesk, ${name}!`;
  });
}

initFeatureCards();
initPricing();
initReviewSlider();
initFaqAccordion();
initSignupForm();
