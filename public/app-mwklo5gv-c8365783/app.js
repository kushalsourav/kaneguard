/**
 * SpendWise Personal Expense Tracker
 * Dashboard Layout, Visual Theme & Transaction Management
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- UI & Layout Elements ---
  const appLayout = document.getElementById('app-layout');
  const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const navLinks = document.querySelectorAll('.nav-link');
  const filterPills = document.querySelectorAll('.filter-pill');
  const dateDisplay = document.getElementById('current-date-display');

  // --- Form & Transaction Elements ---
  const transactionForm = document.getElementById('transaction-form');
  const formErrorMsg = document.getElementById('form-error-msg');
  const typeInput = document.getElementById('type');
  const descInput = document.getElementById('description');
  const amountInput = document.getElementById('amount');
  const categoryInput = document.getElementById('category');
  const dateInput = document.getElementById('date');

  // --- Summary & Breakdown Elements ---
  const totalBalanceDisplay = document.getElementById('total-balance-display');
  const totalIncomeDisplay = document.getElementById('total-income-display');
  const totalExpensesDisplay = document.getElementById('total-expenses-display');
  const incomeStreamsDisplay = document.getElementById('income-streams-display');
  const expenseRatioDisplay = document.getElementById('expense-ratio-display');
  const transactionListBody = document.getElementById('transaction-list-body');
  const spendingBreakdownContainer = document.getElementById('spending-breakdown-container');
  const budgetStatusTag = document.getElementById('budget-status-tag');

  // --- In-Memory State ---
  let transactions = [];

  // Update current date badge dynamically
  if (dateDisplay) {
    const now = new Date();
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    dateDisplay.textContent = now.toLocaleDateString('en-US', options);
  }

  // Desktop sidebar collapse toggle
  if (sidebarCollapseBtn && appLayout) {
    sidebarCollapseBtn.addEventListener('click', () => {
      appLayout.classList.toggle('sidebar-collapsed');
    });
  }

  // Mobile menu open / close
  if (mobileMenuBtn && appLayout) {
    mobileMenuBtn.addEventListener('click', () => {
      appLayout.classList.toggle('mobile-sidebar-open');
    });
  }

  if (sidebarBackdrop && appLayout) {
    sidebarBackdrop.addEventListener('click', () => {
      appLayout.classList.remove('mobile-sidebar-open');
    });
  }

  // Navigation link active state
  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.forEach((l) => l.classList.remove('active'));
      link.classList.add('active');

      // Close mobile sidebar on nav click
      if (appLayout && appLayout.classList.contains('mobile-sidebar-open')) {
        appLayout.classList.remove('mobile-sidebar-open');
      }
    });
  });

  // Helper: Currency formatting (e.g. "3,000.00")
  function formatCurrency(amount) {
    return Number(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // Helper: HTML escaping for safe injection
  function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper: Get active filter
  function getActiveFilter() {
    const activePill = document.querySelector('.filter-pill.active');
    return activePill ? activePill.getAttribute('data-filter') : 'all';
  }

  // Helper: Filter displayed rows based on active pill
  function applyActiveFilter() {
    const filterType = getActiveFilter();
    const rows = document.querySelectorAll('.transaction-row');

    rows.forEach((row) => {
      if (filterType === 'all') {
        row.style.display = '';
      } else if (filterType === 'income') {
        row.style.display = row.classList.contains('income-row') ? '' : 'none';
      } else if (filterType === 'expense') {
        row.style.display = row.classList.contains('expense-row') ? '' : 'none';
      }
    });
  }

  // Filter pills visual toggle & filter execution
  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      applyActiveFilter();
    });
  });

  // Dynamic Summary Cards Update
  function updateSummaryCards() {
    const totalIncome = transactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalExpenses = transactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const netBalance = totalIncome - totalExpenses;

    if (totalBalanceDisplay) {
      if (netBalance < 0) {
        totalBalanceDisplay.textContent = `-$${formatCurrency(Math.abs(netBalance))}`;
      } else {
        totalBalanceDisplay.textContent = `$${formatCurrency(netBalance)}`;
      }
    }

    if (totalIncomeDisplay) {
      totalIncomeDisplay.textContent = `$${formatCurrency(totalIncome)}`;
    }

    if (totalExpensesDisplay) {
      totalExpensesDisplay.textContent = `$${formatCurrency(totalExpenses)}`;
    }

    const incomeCount = transactions.filter((t) => t.type === 'income').length;
    if (incomeStreamsDisplay) {
      incomeStreamsDisplay.textContent = `${incomeCount} active ${incomeCount === 1 ? 'stream' : 'streams'}`;
    }

    if (expenseRatioDisplay) {
      if (totalIncome > 0) {
        const ratio = ((totalExpenses / totalIncome) * 100).toFixed(1);
        expenseRatioDisplay.textContent = `${ratio}% of total income`;
      } else {
        expenseRatioDisplay.textContent = '0.0% of total income';
      }
    }

    if (budgetStatusTag) {
      const budgetCap = 2500;
      const percentUsed = Math.round((totalExpenses / budgetCap) * 100);
      budgetStatusTag.textContent = `${percentUsed}% Used`;
      if (totalExpenses > budgetCap) {
        budgetStatusTag.classList.remove('under-budget');
        budgetStatusTag.classList.add('over-budget');
      } else {
        budgetStatusTag.classList.remove('over-budget');
        budgetStatusTag.classList.add('under-budget');
      }
    }
  }

  // Dynamic Spending Breakdown Rendering
  function renderSpendingBreakdown() {
    if (!spendingBreakdownContainer) return;
    spendingBreakdownContainer.innerHTML = '';

    const expenseTransactions = transactions.filter((t) => t.type === 'expense');
    const totalExpenses = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);

    if (expenseTransactions.length === 0) {
      return;
    }

    const categoryTotals = {};
    expenseTransactions.forEach((t) => {
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
    });

    const categories = Object.keys(categoryTotals);
    categories.sort((a, b) => categoryTotals[b] - categoryTotals[a]);

    categories.forEach((cat) => {
      const catAmount = categoryTotals[cat];
      const percent = totalExpenses > 0 ? ((catAmount / totalExpenses) * 100).toFixed(1) : '0.0';
      const catLower = cat.toLowerCase();

      const item = document.createElement('div');
      item.className = 'breakdown-item';
      item.innerHTML = `
        <div class="breakdown-header">
          <div class="breakdown-category">
            <span class="category-dot ${catLower}-dot"></span>
            <span class="category-name">${escapeHtml(cat)}</span>
          </div>
          <div class="breakdown-values">
            <span class="category-amount">$${formatCurrency(catAmount)}</span>
            <span class="category-percent">${percent}%</span>
          </div>
        </div>
        <div class="progress-track">
          <div class="progress-fill fill-${catLower}" style="width: ${percent}%;"></div>
        </div>
      `;
      spendingBreakdownContainer.appendChild(item);
    });
  }

  // Render Transactions Table
  function renderTransactions() {
    if (!transactionListBody) return;
    transactionListBody.innerHTML = '';

    transactions.forEach((tx) => {
      const isIncome = tx.type === 'income';
      const row = document.createElement('tr');
      row.className = `transaction-row ${isIncome ? 'income-row' : 'expense-row'}`;
      row.setAttribute('data-id', tx.id);

      const iconSvg = isIncome
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;

      const amountFormatted = isIncome
        ? `+$${formatCurrency(tx.amount)}`
        : `-$${formatCurrency(tx.amount)}`;

      const catLower = tx.category.toLowerCase();

      row.innerHTML = `
        <td class="td-desc">
          <div class="transaction-item-info">
            <div class="tx-icon ${isIncome ? 'income-bg' : 'expense-bg'}">
              ${iconSvg}
            </div>
            <div>
              <span class="tx-title">${escapeHtml(tx.description)}</span>
              <span class="tx-meta">${isIncome ? 'Income' : 'Expense'}</span>
            </div>
          </div>
        </td>
        <td class="td-cat">
          <span class="category-badge badge badge-${catLower}">${escapeHtml(tx.category)}</span>
        </td>
        <td class="td-date">${escapeHtml(tx.date)}</td>
        <td class="td-amount text-right ${isIncome ? 'text-emerald' : 'text-rose'}">
          ${amountFormatted}
        </td>
        <td class="td-actions text-right">
          <button type="button" class="btn-delete action-btn delete-btn" data-id="${tx.id}" aria-label="Delete ${escapeHtml(tx.description)}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Delete</span>
          </button>
        </td>
      `;

      transactionListBody.appendChild(row);
    });

    applyActiveFilter();
  }

  // Update Everything
  function updateAll() {
    renderTransactions();
    updateSummaryCards();
    renderSpendingBreakdown();
  }

  // Form Validation & Submission Handling
  if (transactionForm) {
    transactionForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const type = typeInput ? typeInput.value.trim() : 'expense';
      const description = descInput ? descInput.value.trim() : '';
      const amountRaw = amountInput ? amountInput.value.trim() : '';
      const amount = parseFloat(amountRaw);
      const category = categoryInput ? categoryInput.value.trim() : '';
      const date = dateInput ? dateInput.value.trim() : '';

      // Validate inputs: Description, Category, Date non-empty; Amount valid number strictly > 0
      if (!description || amountRaw === '' || isNaN(amount) || amount <= 0 || !category || !date) {
        if (formErrorMsg) {
          formErrorMsg.style.display = 'flex';
        }
        return;
      }

      // Valid: hide error message
      if (formErrorMsg) {
        formErrorMsg.style.display = 'none';
      }

      // Create transaction object
      const newTransaction = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        type: type === 'income' ? 'income' : 'expense',
        description,
        amount,
        category,
        date
      };

      transactions.push(newTransaction);
      updateAll();

      // Reset form inputs (retaining default type 'expense')
      transactionForm.reset();
      if (typeInput) {
        typeInput.value = 'expense';
      }
    });
  }

  // Delete Action Handling (Event Delegation)
  if (transactionListBody) {
    transactionListBody.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.btn-delete, .action-btn, .delete-btn');
      if (deleteBtn) {
        const txId = deleteBtn.getAttribute('data-id');
        transactions = transactions.filter((t) => t.id !== txId);
        updateAll();
      }
    });
  }

  // Initial update
  updateAll();
});
