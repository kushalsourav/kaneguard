(() => {
  'use strict';

  const STORAGE_KEY = 'spliteasy_state_v1';
  const MIN_PEOPLE = 2;
  const MAX_PEOPLE = 6;

  /**
   * Load persisted state from localStorage with safe fallback.
   */
  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { people: [], expenses: [] };
      }
      const parsed = JSON.parse(raw);
      const people = Array.isArray(parsed?.people)
        ? parsed.people
            .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim())
            .slice(0, MAX_PEOPLE)
            .map((p) => ({ id: p.id, name: p.name.trim() }))
        : [];
      const expenses = Array.isArray(parsed?.expenses)
        ? parsed.expenses.filter(
            (e) =>
              e &&
              typeof e.id === 'string' &&
              typeof e.paidById === 'string' &&
              typeof e.amountPaise === 'number' &&
              Number.isFinite(e.amountPaise) &&
              e.amountPaise > 0 &&
              e.splits &&
              typeof e.splits === 'object'
          )
        : [];
      return { people, expenses };
    } catch {
      return { people: [], expenses: [] };
    }
  }

  /**
   * Persist current state to localStorage.
   */
  function saveState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors in restricted environments.
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Format integer paise as rupee string with 2 decimals (e.g. 3334 -> "₹33.34").
   */
  function formatRupees(paise) {
    const abs = Math.abs(Math.round(paise));
    return `₹${(abs / 100).toFixed(2)}`;
  }

  /**
   * Compute net balance in integer paise for each person id.
   * Positive = gets back, negative = owes, 0 = settled up.
   */
  function computeBalancesPaise(people, expenses) {
    const balances = new Map();
    for (const person of people) {
      balances.set(person.id, 0);
    }

    for (const expense of expenses) {
      if (!expense || typeof expense.amountPaise !== 'number') {
        continue;
      }
      if (balances.has(expense.paidById)) {
        balances.set(expense.paidById, balances.get(expense.paidById) + Math.round(expense.amountPaise));
      }
      if (expense.splits && typeof expense.splits === 'object') {
        for (const [personId, sharePaise] of Object.entries(expense.splits)) {
          if (balances.has(personId) && typeof sharePaise === 'number') {
            balances.set(personId, balances.get(personId) - Math.round(sharePaise));
          }
        }
      }
    }

    return balances;
  }

  /**
   * Generate settle-up payments in integer paise by repeatedly matching
   * the largest debtor with the largest creditor until all balances are cleared.
   */
  function computeSettleUpPayments(people, balances) {
    const debtors = [];
    const creditors = [];

    people.forEach((person, index) => {
      const balancePaise = Math.round(balances.get(person.id) ?? 0);
      if (balancePaise < 0) {
        debtors.push({ id: person.id, name: person.name, index, remaining: -balancePaise });
      } else if (balancePaise > 0) {
        creditors.push({ id: person.id, name: person.name, index, remaining: balancePaise });
      }
    });

    const pickLargest = (entries) => {
      let best = null;
      for (const entry of entries) {
        if (entry.remaining <= 0) {
          continue;
        }
        if (
          !best ||
          entry.remaining > best.remaining ||
          (entry.remaining === best.remaining && entry.index < best.index)
        ) {
          best = entry;
        }
      }
      return best;
    };

    const payments = [];
    while (true) {
      const debtor = pickLargest(debtors);
      const creditor = pickLargest(creditors);
      if (!debtor || !creditor) {
        break;
      }
      const amountPaise = Math.min(debtor.remaining, creditor.remaining);
      payments.push({
        fromId: debtor.id,
        fromName: debtor.name,
        toId: creditor.id,
        toName: creditor.name,
        amountPaise,
      });
      debtor.remaining -= amountPaise;
      creditor.remaining -= amountPaise;
    }

    return payments;
  }

  const PCT_SCALE = 10000;
  const HUNDRED_PCT_SCALED = 100 * PCT_SCALE;

  /**
   * Parse a rupee string (up to 2 decimal places) into integer paise.
   */
  function parseRupeesToPaise(rawValue, { allowZero = false, allowEmpty = false } = {}) {
    const trimmed = String(rawValue ?? '').trim();
    if (!trimmed) {
      if (allowEmpty) {
        return { amountPaise: 0 };
      }
      return { error: 'Please enter an amount' };
    }
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && (numeric < 0 || (!allowZero && numeric === 0))) {
        return {
          error: allowZero ? 'Split amounts cannot be negative' : 'Amount must be greater than ₹0.00',
        };
      }
      return {
        error: allowZero
          ? 'Enter valid split amounts (up to 2 decimal places)'
          : 'Enter a valid amount (up to 2 decimal places)',
      };
    }
    const [wholePart = '0', fracPart = ''] = trimmed.split('.');
    const rupees = Number(wholePart || '0');
    const paise = Number(fracPart.padEnd(2, '0'));
    const amountPaise = rupees * 100 + paise;
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 0 || (!allowZero && amountPaise === 0)) {
      return {
        error: allowZero ? 'Split amounts cannot be negative' : 'Amount must be greater than ₹0.00',
      };
    }
    return { amountPaise };
  }

  /**
   * Parse a percentage string into integer scaled units (100% = HUNDRED_PCT_SCALED).
   */
  function parsePercentageScaled(rawValue) {
    const trimmed = String(rawValue ?? '').trim();
    if (!trimmed) {
      return { pctScaled: 0 };
    }
    if (!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric < 0) {
        return { error: 'Percentages cannot be negative' };
      }
      return { error: 'Enter valid percentages (up to 4 decimal places)' };
    }
    const [wholePart = '0', fracPart = ''] = trimmed.split('.');
    const whole = Number(wholePart || '0');
    const frac = Number(fracPart.padEnd(4, '0'));
    const pctScaled = whole * PCT_SCALE + frac;
    if (!Number.isSafeInteger(pctScaled) || pctScaled < 0) {
      return { error: 'Percentages cannot be negative' };
    }
    return { pctScaled };
  }

  function formatPercentFromScaled(pctScaled) {
    const pct = pctScaled / PCT_SCALE;
    return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(4)));
  }

  /**
   * Split integer paise equally across participants, distributing any remainder
   * 1 paise at a time in the order people were added.
   */
  function computeEqualSplitsPaise(amountPaise, people) {
    const count = people.length;
    const baseShare = Math.floor(amountPaise / count);
    const remainder = amountPaise % count;
    const splits = {};
    people.forEach((person, index) => {
      splits[person.id] = baseShare + (index < remainder ? 1 : 0);
    });
    return splits;
  }

  /**
   * Convert percentage shares (summing to HUNDRED_PCT_SCALED) to integer paise
   * whose sum equals amountPaise exactly, using largest-remainder rounding.
   */
  function computePercentageSplitsPaise(amountPaise, people, pctScaledById) {
    const totalAmount = BigInt(amountPaise);
    const totalPct = BigInt(HUNDRED_PCT_SCALED);
    const rows = people.map((person, index) => {
      const pctScaled = BigInt(pctScaledById[person.id] ?? 0);
      const numerator = totalAmount * pctScaled;
      const base = Number(numerator / totalPct);
      const rem = numerator % totalPct;
      return { id: person.id, index, pctScaled, base, rem };
    });

    const baseSum = rows.reduce((acc, row) => acc + row.base, 0);
    const leftover = amountPaise - baseSum;

    const eligible = rows
      .filter((row) => row.pctScaled > 0n)
      .sort((a, b) => {
        if (a.rem !== b.rem) {
          return a.rem > b.rem ? -1 : 1;
        }
        return a.index - b.index;
      });

    const splits = {};
    for (const row of rows) {
      splits[row.id] = row.base;
    }
    for (let i = 0; i < leftover && i < eligible.length; i += 1) {
      splits[eligible[i].id] += 1;
    }
    return splits;
  }

  let state = loadState();
  let errorMessage = '';
  let expenseErrorMessage = '';
  let currentSplitType = 'equal';
  let splitDraftValues = { exact: {}, percentage: {} };

  const form = document.getElementById('add-person-form');
  const nameInput = document.getElementById('person-name-input');
  const errorEl = document.getElementById('people-error');
  const statusEl = document.getElementById('people-status');
  const countBadge = document.getElementById('people-count-badge');
  const peopleList = document.getElementById('people-list');
  const peopleEmpty = document.getElementById('people-empty');
  const balancesList = document.getElementById('balances-list');
  const balancesEmpty = document.getElementById('balances-empty');
  const settleList = document.getElementById('settle-list');
  const settleEmpty = document.getElementById('settle-empty');

  const expensesCountBadge = document.getElementById('expenses-count-badge');
  const expensesLocked = document.getElementById('expenses-locked');
  const expensesLockedMessage = document.getElementById('expenses-locked-message');
  const expensesContent = document.getElementById('expenses-content');
  const expenseForm = document.getElementById('add-expense-form');
  const expenseAmountInput = document.getElementById('expense-amount-input');
  const expensePayerSelect = document.getElementById('expense-payer-select');
  const expenseDescriptionInput = document.getElementById('expense-description-input');
  const splitTypeRadios = Array.from(document.querySelectorAll('input[name="splitType"]'));
  const splitInputsPanel = document.getElementById('split-inputs-panel');
  const splitInputsTitle = document.getElementById('split-inputs-title');
  const splitInputsTotal = document.getElementById('split-inputs-total');
  const splitInputsList = document.getElementById('split-inputs-list');
  const expenseSplitPreview = document.getElementById('expense-split-preview');
  const expensesErrorEl = document.getElementById('expenses-error');
  const expensesList = document.getElementById('expenses-list');
  const expensesEmpty = document.getElementById('expenses-empty');

  function setError(message) {
    errorMessage = message;
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  }

  function setExpenseError(message) {
    expenseErrorMessage = message;
    if (message) {
      expensesErrorEl.textContent = message;
      expensesErrorEl.hidden = false;
    } else {
      expensesErrorEl.textContent = '';
      expensesErrorEl.hidden = true;
    }
  }

  function getSplitInputEl(personId) {
    return splitInputsList.querySelector(`[data-person-id="${CSS.escape(personId)}"]`);
  }

  function renderSplitInputs() {
    if (currentSplitType === 'equal' || state.people.length < MIN_PEOPLE) {
      splitInputsPanel.hidden = true;
      splitInputsList.replaceChildren();
      return;
    }

    splitInputsPanel.hidden = false;
    splitInputsTitle.textContent =
      currentSplitType === 'exact' ? 'Exact amounts per person' : 'Percentages per person';

    splitInputsList.replaceChildren();
    for (const person of state.people) {
      const row = document.createElement('div');
      row.className = 'split-person-row';

      const label = document.createElement('label');
      label.className = 'split-person-label';
      const inputId = `split-input-${person.id}`;
      label.setAttribute('for', inputId);
      label.textContent = person.name;

      const wrap = document.createElement('div');
      wrap.className = 'split-input-wrap';

      const input = document.createElement('input');
      input.id = inputId;
      input.className = 'split-person-input';
      input.type = 'number';
      input.inputMode = 'decimal';
      input.min = '0';
      input.step = currentSplitType === 'exact' ? '0.01' : 'any';
      input.placeholder = currentSplitType === 'exact' ? '0.00' : '0';
      input.dataset.personId = person.id;
      input.value = splitDraftValues[currentSplitType][person.id] ?? '';

      input.addEventListener('input', () => {
        splitDraftValues[currentSplitType][person.id] = input.value;
        if (expenseErrorMessage) {
          setExpenseError('');
        }
        updateSplitPreview();
      });

      const unit = document.createElement('span');
      unit.className = 'split-input-unit';
      unit.setAttribute('aria-hidden', 'true');

      if (currentSplitType === 'exact') {
        unit.textContent = '₹';
        wrap.append(unit, input);
      } else {
        unit.textContent = '%';
        wrap.append(input, unit);
      }

      row.append(label, wrap);
      splitInputsList.appendChild(row);
    }
  }

  function updateSplitPreview() {
    const count = state.people.length;
    if (count < MIN_PEOPLE || count > MAX_PEOPLE) {
      expenseSplitPreview.textContent = '';
      return;
    }

    const parsed = parseRupeesToPaise(expenseAmountInput.value);

    if (currentSplitType === 'equal') {
      if (parsed.error) {
        expenseSplitPreview.textContent = `Split equally among all ${count} participants.`;
        return;
      }
      const splits = computeEqualSplitsPaise(parsed.amountPaise, state.people);
      const breakdown = state.people
        .map((person) => `${person.name} ${formatRupees(splits[person.id])}`)
        .join(', ');
      expenseSplitPreview.textContent = `Split equally: ${breakdown}.`;
      return;
    }

    if (currentSplitType === 'exact') {
      let sumPaise = 0;
      let hasInvalid = false;
      for (const person of state.people) {
        const raw = splitDraftValues.exact[person.id] ?? '';
        const res = parseRupeesToPaise(raw, { allowZero: true, allowEmpty: true });
        if (res.error) {
          hasInvalid = true;
        } else {
          sumPaise += res.amountPaise;
        }
      }

      splitInputsTotal.classList.remove('is-valid', 'is-invalid');
      if (parsed.error) {
        splitInputsTotal.textContent = hasInvalid ? 'Check entries' : `Entered: ${formatRupees(sumPaise)}`;
        expenseSplitPreview.textContent = 'Enter exact rupee amounts matching the expense total.';
      } else {
        const diffPaise = parsed.amountPaise - sumPaise;
        splitInputsTotal.textContent = `Total: ${formatRupees(sumPaise)} / ${formatRupees(parsed.amountPaise)}`;
        if (!hasInvalid && diffPaise === 0) {
          splitInputsTotal.classList.add('is-valid');
          expenseSplitPreview.textContent = `Exact amounts match ${formatRupees(parsed.amountPaise)}.`;
        } else {
          splitInputsTotal.classList.add('is-invalid');
          if (hasInvalid) {
            expenseSplitPreview.textContent = 'Enter valid split amounts (up to 2 decimal places).';
          } else if (diffPaise > 0) {
            expenseSplitPreview.textContent = `${formatRupees(diffPaise)} remaining to assign.`;
          } else {
            expenseSplitPreview.textContent = `${formatRupees(Math.abs(diffPaise))} over the expense amount.`;
          }
        }
      }
      return;
    }

    // Percentage mode
    let sumPctScaled = 0;
    let hasInvalid = false;
    for (const person of state.people) {
      const raw = splitDraftValues.percentage[person.id] ?? '';
      const res = parsePercentageScaled(raw);
      if (res.error) {
        hasInvalid = true;
      } else {
        sumPctScaled += res.pctScaled;
      }
    }

    splitInputsTotal.classList.remove('is-valid', 'is-invalid');
    splitInputsTotal.textContent = hasInvalid
      ? 'Check entries'
      : `Total: ${formatPercentFromScaled(sumPctScaled)}% / 100%`;

    if (!hasInvalid && sumPctScaled === HUNDRED_PCT_SCALED) {
      splitInputsTotal.classList.add('is-valid');
      if (!parsed.error) {
        const pctById = {};
        for (const person of state.people) {
          pctById[person.id] = parsePercentageScaled(splitDraftValues.percentage[person.id] ?? '').pctScaled;
        }
        const splits = computePercentageSplitsPaise(parsed.amountPaise, state.people, pctById);
        const breakdown = state.people
          .map((person) => `${person.name} ${formatRupees(splits[person.id])}`)
          .join(', ');
        expenseSplitPreview.textContent = `Percentage split: ${breakdown}.`;
      } else {
        expenseSplitPreview.textContent = 'Percentages add up to 100%.';
      }
    } else {
      splitInputsTotal.classList.add('is-invalid');
      if (hasInvalid) {
        expenseSplitPreview.textContent = 'Enter valid non-negative percentages.';
      } else if (sumPctScaled < HUNDRED_PCT_SCALED) {
        expenseSplitPreview.textContent = `${formatPercentFromScaled(HUNDRED_PCT_SCALED - sumPctScaled)}% remaining to reach 100%.`;
      } else {
        expenseSplitPreview.textContent = `${formatPercentFromScaled(sumPctScaled - HUNDRED_PCT_SCALED)}% over 100%.`;
      }
    }
  }

  function renderExpenses(count) {
    const canAddExpenses = count >= MIN_PEOPLE && count <= MAX_PEOPLE;
    expensesLocked.hidden = canAddExpenses;
    expensesContent.hidden = !canAddExpenses;
    expensesCountBadge.hidden = !canAddExpenses;

    if (!canAddExpenses) {
      expensesLockedMessage.textContent = count === 1
        ? `Add 1 more person to record expenses (minimum ${MIN_PEOPLE}).`
        : `Add ${MIN_PEOPLE} to ${MAX_PEOPLE} people to record expenses.`;
      setExpenseError('');
      return;
    }

    const expenseCount = state.expenses.length;
    expensesCountBadge.textContent = `${expenseCount} ${expenseCount === 1 ? 'expense' : 'expenses'}`;

    const previousPayerId = expensePayerSelect.value;
    expensePayerSelect.replaceChildren();
    for (const person of state.people) {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.name;
      expensePayerSelect.appendChild(option);
    }
    if (state.people.some((p) => p.id === previousPayerId)) {
      expensePayerSelect.value = previousPayerId;
    }

    for (const radio of splitTypeRadios) {
      radio.checked = radio.value === currentSplitType;
    }

    renderSplitInputs();
    updateSplitPreview();

    const peopleById = new Map(state.people.map((p) => [p.id, p]));
    expensesList.replaceChildren();
    expensesEmpty.hidden = expenseCount > 0;

    for (const expense of [...state.expenses].reverse()) {
      const li = document.createElement('li');
      li.className = 'expense-item';
      li.dataset.expenseId = expense.id;

      const topRow = document.createElement('div');
      topRow.className = 'expense-item-top';

      const expenseTitle = expense.description || 'Shared expense';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'expense-title';
      titleSpan.textContent = expenseTitle;

      const rightWrap = document.createElement('div');
      rightWrap.className = 'expense-item-right';

      const amountSpan = document.createElement('span');
      amountSpan.className = 'expense-amount';
      amountSpan.textContent = formatRupees(expense.amountPaise);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-remove btn-delete-expense';
      deleteBtn.textContent = 'Delete';
      deleteBtn.setAttribute('aria-label', `Delete ${expenseTitle}`);
      deleteBtn.addEventListener('click', () => handleDeleteExpense(expense.id));

      rightWrap.append(amountSpan, deleteBtn);
      topRow.append(titleSpan, rightWrap);

      const metaRow = document.createElement('div');
      metaRow.className = 'expense-meta';
      const payerName = peopleById.get(expense.paidById)?.name ?? expense.paidByName ?? 'Unknown';
      const splitEntries = Object.entries(expense.splits || {});
      if (splitEntries.length > 0) {
        const participantNames = splitEntries.map(
          ([personId]) => peopleById.get(personId)?.name ?? expense.participantNames?.[personId] ?? 'Removed'
        );
        if (expense.splitType === 'exact') {
          const detail = splitEntries
            .map(([personId, sharePaise], idx) => `${participantNames[idx]} ${formatRupees(sharePaise)}`)
            .join(', ');
          metaRow.textContent = `Paid by ${payerName} · Exact amounts (${detail})`;
        } else if (expense.splitType === 'percentage') {
          const detail = splitEntries
            .map(([personId, sharePaise], idx) => {
              const pct = expense.percentages?.[personId];
              return pct !== undefined
                ? `${participantNames[idx]} ${pct}% (${formatRupees(sharePaise)})`
                : `${participantNames[idx]} ${formatRupees(sharePaise)}`;
            })
            .join(', ');
          metaRow.textContent = `Paid by ${payerName} · Percentages (${detail})`;
        } else {
          const shares = splitEntries.map(([, sharePaise]) => Math.round(sharePaise));
          const minShare = Math.min(...shares);
          const maxShare = Math.max(...shares);
          const shareSummary = minShare === maxShare
            ? `${formatRupees(minShare)} each`
            : `${formatRupees(minShare)}–${formatRupees(maxShare)} each`;
          metaRow.textContent = `Paid by ${payerName} · Split equally among ${splitEntries.length} (${participantNames.join(', ')}) · ${shareSummary}`;
        }
      } else {
        metaRow.textContent = `Paid by ${payerName}`;
      }

      li.append(topRow, metaRow);
      expensesList.appendChild(li);
    }
  }

  function render() {
    const balances = computeBalancesPaise(state.people, state.expenses);
    const count = state.people.length;

    countBadge.textContent = `${count} / ${MAX_PEOPLE} people`;
    countBadge.classList.toggle('is-ready', count >= MIN_PEOPLE && count <= MAX_PEOPLE);

    if (count > 0 && count < MIN_PEOPLE) {
      statusEl.textContent = `Add ${MIN_PEOPLE - count} more ${MIN_PEOPLE - count === 1 ? 'person' : 'people'} (minimum ${MIN_PEOPLE}).`;
      statusEl.hidden = false;
    } else {
      statusEl.textContent = '';
      statusEl.hidden = true;
    }

    peopleList.replaceChildren();
    peopleEmpty.hidden = count > 0;

    balancesList.replaceChildren();
    balancesEmpty.hidden = count > 0;

    for (const person of state.people) {
      const balancePaise = balances.get(person.id) ?? 0;

      // People list row
      const li = document.createElement('li');
      li.className = 'person-item';
      li.dataset.personId = person.id;

      const meta = document.createElement('div');
      meta.className = 'person-meta';

      const avatar = document.createElement('span');
      avatar.className = 'person-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = person.name.charAt(0).toUpperCase();

      const nameSpan = document.createElement('span');
      nameSpan.className = 'person-name';
      nameSpan.textContent = person.name;

      const balanceTag = document.createElement('span');
      balanceTag.className = `person-balance-tag${balancePaise !== 0 ? ' nonzero' : ''}`;
      balanceTag.textContent = balancePaise === 0
        ? '₹0.00'
        : `${balancePaise > 0 ? '+' : '-'}${formatRupees(balancePaise)}`;

      meta.append(avatar, nameSpan, balanceTag);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.setAttribute('aria-label', `Remove ${person.name}`);
      removeBtn.addEventListener('click', () => handleRemovePerson(person.id));

      li.append(meta, removeBtn);
      peopleList.appendChild(li);

      // Balances list row
      const balLi = document.createElement('li');
      balLi.className = 'balance-item';
      const balText = document.createElement('span');
      balText.className = 'balance-text';
      if (balancePaise > 0) {
        balText.classList.add('gets-back');
        balText.textContent = `${person.name} gets back ${formatRupees(balancePaise)}`;
      } else if (balancePaise < 0) {
        balText.classList.add('owes');
        balText.textContent = `${person.name} owes ${formatRupees(balancePaise)}`;
      } else {
        balText.textContent = `${person.name} is settled up`;
      }
      balLi.appendChild(balText);
      balancesList.appendChild(balLi);
    }

    const payments = computeSettleUpPayments(state.people, balances);
    settleList.replaceChildren();
    settleEmpty.hidden = payments.length > 0;
    for (const payment of payments) {
      const settleLi = document.createElement('li');
      settleLi.className = 'settle-item';
      const settleText = document.createElement('span');
      settleText.className = 'settle-text';
      settleText.textContent = `${payment.fromName} pays ${payment.toName} ${formatRupees(payment.amountPaise)}`;
      settleLi.appendChild(settleText);
      settleList.appendChild(settleLi);
    }

    renderExpenses(count);
  }

  function handleAddPerson(event) {
    event.preventDefault();
    const rawName = nameInput.value;
    const trimmedName = rawName.trim();

    if (!trimmedName) {
      setError('Please enter a name');
      nameInput.focus();
      return;
    }

    if (state.people.length >= MAX_PEOPLE) {
      setError('Maximum 6 people allowed');
      nameInput.focus();
      return;
    }

    const normalized = trimmedName.toLowerCase();
    const duplicate = state.people.some((p) => p.name.trim().toLowerCase() === normalized);
    if (duplicate) {
      setError('Name already added');
      nameInput.focus();
      return;
    }

    state = {
      ...state,
      people: [...state.people, { id: createId(), name: trimmedName }],
    };
    saveState(state);
    setError('');
    nameInput.value = '';
    nameInput.focus();
    render();
  }

  function handleRemovePerson(personId) {
    const person = state.people.find((p) => p.id === personId);
    if (!person) {
      return;
    }

    const balances = computeBalancesPaise(state.people, state.expenses);
    const balancePaise = balances.get(person.id) ?? 0;

    if (balancePaise !== 0) {
      setError(`Settle up before removing ${person.name}`);
      return;
    }

    state = {
      ...state,
      people: state.people.filter((p) => p.id !== personId),
    };
    delete splitDraftValues.exact[personId];
    delete splitDraftValues.percentage[personId];
    saveState(state);
    setError('');
    render();
  }

  function handleAddExpense(event) {
    event.preventDefault();

    if (state.people.length < MIN_PEOPLE || state.people.length > MAX_PEOPLE) {
      setExpenseError(`Add ${MIN_PEOPLE} to ${MAX_PEOPLE} people before recording an expense`);
      return;
    }

    const parsed = parseRupeesToPaise(expenseAmountInput.value);
    if (parsed.error) {
      setExpenseError(parsed.error);
      expenseAmountInput.focus();
      return;
    }

    const paidById = expensePayerSelect.value;
    const payer = state.people.find((p) => p.id === paidById);
    if (!payer) {
      setExpenseError('Please select who paid');
      expensePayerSelect.focus();
      return;
    }

    let splits;
    let percentages;

    if (currentSplitType === 'equal') {
      splits = computeEqualSplitsPaise(parsed.amountPaise, state.people);
    } else if (currentSplitType === 'exact') {
      splits = {};
      let sumPaise = 0;
      for (const person of state.people) {
        const inputEl = getSplitInputEl(person.id);
        const rawVal = inputEl ? inputEl.value : (splitDraftValues.exact[person.id] ?? '');
        const res = parseRupeesToPaise(rawVal, { allowZero: true, allowEmpty: true });
        if (res.error) {
          setExpenseError(res.error);
          inputEl?.focus();
          return;
        }
        splits[person.id] = res.amountPaise;
        sumPaise += res.amountPaise;
      }
      if (sumPaise !== parsed.amountPaise) {
        setExpenseError(`Amounts must add up to ${formatRupees(parsed.amountPaise)}`);
        return;
      }
    } else if (currentSplitType === 'percentage') {
      const pctScaledById = {};
      percentages = {};
      let sumPctScaled = 0;
      for (const person of state.people) {
        const inputEl = getSplitInputEl(person.id);
        const rawVal = inputEl ? inputEl.value : (splitDraftValues.percentage[person.id] ?? '');
        const res = parsePercentageScaled(rawVal);
        if (res.error) {
          setExpenseError(res.error);
          inputEl?.focus();
          return;
        }
        pctScaledById[person.id] = res.pctScaled;
        percentages[person.id] = formatPercentFromScaled(res.pctScaled);
        sumPctScaled += res.pctScaled;
      }
      if (sumPctScaled !== HUNDRED_PCT_SCALED) {
        setExpenseError('Percentages must add up to 100%');
        return;
      }
      splits = computePercentageSplitsPaise(parsed.amountPaise, state.people, pctScaledById);
    } else {
      setExpenseError('Please select a valid split type');
      return;
    }

    const participantNames = Object.fromEntries(state.people.map((p) => [p.id, p.name]));

    const newExpense = {
      id: createId(),
      description: expenseDescriptionInput.value.trim(),
      amountPaise: parsed.amountPaise,
      paidById: payer.id,
      paidByName: payer.name,
      splitType: currentSplitType,
      splits,
      ...(percentages ? { percentages } : {}),
      participantNames,
      createdAt: new Date().toISOString(),
    };

    state = {
      ...state,
      expenses: [...state.expenses, newExpense],
    };
    saveState(state);
    setExpenseError('');
    setError('');
    expenseAmountInput.value = '';
    expenseDescriptionInput.value = '';
    currentSplitType = 'equal';
    splitDraftValues = { exact: {}, percentage: {} };
    expenseDescriptionInput.focus();
    render();
  }

  /**
   * Delete an expense by id, persist updated state, and recalculate balances.
   */
  function handleDeleteExpense(expenseId) {
    const exists = state.expenses.some((e) => e.id === expenseId);
    if (!exists) {
      return;
    }
    state = {
      ...state,
      expenses: state.expenses.filter((e) => e.id !== expenseId),
    };
    saveState(state);
    setError('');
    setExpenseError('');
    render();
  }

  form.addEventListener('submit', handleAddPerson);

  nameInput.addEventListener('input', () => {
    if (errorMessage) {
      setError('');
    }
  });

  expenseForm.addEventListener('submit', handleAddExpense);

  expenseAmountInput.addEventListener('input', () => {
    if (expenseErrorMessage) {
      setExpenseError('');
    }
    updateSplitPreview();
  });

  expenseDescriptionInput.addEventListener('input', () => {
    if (expenseErrorMessage) {
      setExpenseError('');
    }
  });

  expensePayerSelect.addEventListener('change', () => {
    if (expenseErrorMessage) {
      setExpenseError('');
    }
  });

  for (const radio of splitTypeRadios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) {
        return;
      }
      currentSplitType = radio.value;
      if (expenseErrorMessage) {
        setExpenseError('');
      }
      renderSplitInputs();
      updateSplitPreview();
    });
  }

  render();
})();
