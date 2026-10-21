const STORAGE_PREFIX = 'virtual-money-family-';
const LEGACY_STORAGE_PREFIX = 'nest-family-';
const DEFAULT_FAMILY = 'VM-2047';
const DEFAULT_STATE = {
  familyCode: DEFAULT_FAMILY,
  parentPin: '2047',
  profile: {
    childName: 'Alex',
    parentName: 'Dad',
    initials: 'AK',
  },
  balance: 128.5,
  goal: {
    id: 'goal-bike',
    name: 'A new bike',
    target: 250,
    saved: 128.5,
  },
  goals: [{ id: 'goal-bike', name: 'A new bike', target: 250, saved: 128.5 }],
  activeGoalId: 'goal-bike',
  streak: 4,
  week: [5, 0, 10, 0, 20, 0, 0],
  transactions: [
    {
      id: 'welcome-1',
      amount: 20,
      note: 'Extra chores',
      type: 'save',
      createdAt: '2026-10-19T10:00:00.000Z',
    },
    {
      id: 'welcome-2',
      amount: 15,
      note: 'Gift from Grandma',
      type: 'gift',
      createdAt: '2026-10-16T10:00:00.000Z',
    },
    {
      id: 'welcome-3',
      amount: 10,
      note: 'Weekly save',
      type: 'save',
      createdAt: '2026-10-14T10:00:00.000Z',
    },
  ],
  pendingRequests: [],
  parentNote: '',
  reviewedAt: null,
  reviewRequestedAt: null,
  updatedAt: new Date().toISOString(),
};

let state = null;
let familyCode = getFamilyCode();
let serverAvailable = false;
let currentView = 'savings';
let parentAccessGranted = false;
let parentCredential = '';
let currentMoneyAction = 'add';
let lastServerError = '';
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener('DOMContentLoaded', init);

async function init() {
  state = getLocalState();
  renderAll();
  bindEvents();
  await refreshFromServer();
  renderAll();

  const query = new URLSearchParams(window.location.search);
  if (query.get('view') === 'parent') {
    setTimeout(() => requestParentAccess(), 250);
  }

  window.setInterval(() => {
    if (serverAvailable) refreshFromServer(true);
  }, 15000);
}

function bindEvents() {
  $('#openAddButton').addEventListener('click', () => openMoneyModal('add'));
  $('#openSpendButton').addEventListener('click', () => openMoneyModal('deduct'));
  $('#shareButton').addEventListener('click', () => openModal('shareModal'));
  $('#openParentButton').addEventListener('click', requestParentAccess);
  $('#backToSavings').addEventListener('click', () => showView('savings'));
  $('#shareDoneButton').addEventListener('click', () => closeModal('shareModal'));
  $('#learnButton').addEventListener('click', () => showToast('Virtual Money is a practice space — no real money moves here.'));
  $('#profileButton').addEventListener('click', () => showToast('Your profile is ready for the next step.'));
  $('#addGoalButton').addEventListener('click', openGoalModal);
  $('#goalForm').addEventListener('submit', handleCreateGoal);
  $('#goalList').addEventListener('click', handleGoalActionClick);

  $$('.modal-close').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  $$('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) backdrop.classList.add('hidden');
    });
  });

  $$('[data-amount]').forEach((button) => {
    button.addEventListener('click', () => {
      $('#amountInput').value = button.dataset.amount;
      $('#amountInput').focus();
    });
  });

  $$('[data-view-link]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.viewLink;
      if (view === 'parent') requestParentAccess();
      else showView(view);
    });
  });

  $('#addMoneyForm').addEventListener('submit', handleAddMoney);
  $('#pinForm').addEventListener('submit', handlePinSubmit);
  $('#markReviewedButton').addEventListener('click', saveParentNote);
  $('#pendingRequestsList').addEventListener('click', handleRequestDecisionClick);

  $$('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', () => copyTarget(button.dataset.copyTarget));
  });
}

function getFamilyCode() {
  const queryFamily = new URLSearchParams(window.location.search).get('family');
  const storedFamily = window.localStorage.getItem('virtual-money-active-family')
    || window.localStorage.getItem('nest-active-family');
  return sanitizeFamilyCode(queryFamily || storedFamily || DEFAULT_FAMILY);
}

function sanitizeFamilyCode(value) {
  return String(value || DEFAULT_FAMILY).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32) || DEFAULT_FAMILY;
}

function getStorageKey() {
  return `${STORAGE_PREFIX}${familyCode}`;
}

function getLocalState() {
  try {
    const saved = window.localStorage.getItem(getStorageKey())
      || window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${familyCode}`);
    if (saved) return mergeState(JSON.parse(saved));
  } catch (error) {
    console.warn('Virtual Money local storage is unavailable.', error);
  }
  return mergeState({ ...DEFAULT_STATE, familyCode });
}

function mergeState(next) {
  const goalSource = Array.isArray(next?.goals)
    ? next.goals
    : next?.goal
      ? [next.goal]
      : DEFAULT_STATE.goals;
  const goals = goalSource
    .filter((goal) => goal && typeof goal === 'object')
    .map((goal, index) => {
      const target = Number(goal.target);
      const saved = Number(goal.saved);
      return {
        id: String(goal.id || (index === 0 ? 'goal-bike' : `goal-${index + 1}`)),
        name: String(goal.name || 'Untitled goal').trim().slice(0, 40) || 'Untitled goal',
        target: Number.isFinite(target) && target > 0 ? target : 1,
        saved: Number.isFinite(saved) ? Math.max(0, saved) : 0,
      };
    });
  const requestedActiveId = String(next?.activeGoalId || next?.goal?.id || '');
  const activeGoal = goals.find((goal) => goal.id === requestedActiveId) || goals[0] || null;
  const merged = {
    ...DEFAULT_STATE,
    ...next,
    familyCode,
    profile: { ...DEFAULT_STATE.profile, ...(next?.profile || {}) },
    goals,
    activeGoalId: activeGoal?.id || null,
    goal: activeGoal ? { ...activeGoal } : null,
    week: Array.isArray(next?.week) ? next.week.slice(0, 7) : DEFAULT_STATE.week.slice(),
    transactions: Array.isArray(next?.transactions) ? next.transactions : DEFAULT_STATE.transactions.slice(),
    pendingRequests: Array.isArray(next?.pendingRequests) ? next.pendingRequests : [],
  };
  while (merged.week.length < 7) merged.week.unshift(0);
  return merged;
}

function activeGoal() {
  return state?.goals?.find((goal) => goal.id === state.activeGoalId) || null;
}

function syncActiveGoalAlias() {
  const goal = activeGoal();
  state.goal = goal ? { ...goal } : null;
}

function persistLocal() {
  try {
    window.localStorage.setItem(getStorageKey(), JSON.stringify(state));
    window.localStorage.setItem('virtual-money-active-family', familyCode);
  } catch (error) {
    console.warn('Virtual Money could not save locally.', error);
  }
}

async function refreshFromServer(silent = false) {
  if (window.location.protocol === 'file:') return;

  try {
    const response = await fetch(`/api/family/${encodeURIComponent(familyCode)}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const remoteState = await response.json();
    state = mergeState(remoteState);
    persistLocal();
    serverAvailable = true;
    setSyncStatus('Live sync', true);
    renderAll();
    if (!silent) showToast('Your family space is ready to sync.');
  } catch (error) {
    serverAvailable = false;
    setSyncStatus('Local preview', false);
  }
}

async function sendToServer(path, payload) {
  lastServerError = '';
  if (!serverAvailable || window.location.protocol === 'file:') return false;
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      lastServerError = problem.error || `Could not save this change (${response.status}).`;
      return false;
    }
    state = mergeState(await response.json());
    persistLocal();
    return true;
  } catch (error) {
    lastServerError = 'The family server could not be reached. Please try again.';
    serverAvailable = false;
    setSyncStatus('Local preview', false);
    return false;
  }
}

function setSyncStatus(label, isLive) {
  const badge = $('#syncBadge');
  badge.innerHTML = `<span class="sync-dot" aria-hidden="true"></span>${label}`;
  badge.classList.toggle('is-live', isLive);
}

function renderAll() {
  if (!state) return;
  $('#profileButton').textContent = state.profile.initials || 'AK';
  $('#parentChildName').textContent = state.profile.childName;
  $('#parentName').textContent = state.profile.parentName;
  renderDate();
  renderBalance();
  renderGoal();
  renderWeek();
  renderActivity();
  renderParentView();
  updateShareLinks();
}

function renderDate() {
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  $('#todayLabel').textContent = today.toUpperCase();
}

function renderBalance() {
  $('#balanceValue').textContent = currency(state.balance);
  $('#parentBalance').textContent = currency(state.balance);
  $('#monthSaved').textContent = currency(monthSaved());
  $('#parentMonthSaved').textContent = currency(monthSaved());
  const goal = activeGoal();
  $('#nextMilestone').textContent = goal ? `${currency(Math.max(goal.target - goal.saved, 0))} to go` : 'Add a goal';
  $('#goalDueText').textContent = goal ? goal.name : 'Start with a new goal';
  $('#lastUpdated').textContent = updatedLabel(state.updatedAt);
  $('#reviewFooterText').textContent = state.reviewRequestedAt
    ? 'A parent review has been requested for this family space.'
    : 'Everything here is virtual and made for practice.';
}

function renderGoal() {
  const goals = state.goals || [];
  $('#goalList').innerHTML = goals.length
    ? goals.map(goalMarkup).join('')
    : `<section class="surface-card goal-empty-state"><div class="goal-icon" aria-hidden="true">✦</div><h3>No goals yet</h3><p>Create a goal to give your virtual savings a target.</p><button class="primary-button" type="button" data-create-goal>+ Add a goal</button></section>`;

  const goal = activeGoal();
  const percentage = goal ? Math.min(100, Math.round((goal.saved / goal.target) * 100)) : 0;
  $('#parentGoalName').textContent = goal ? goal.name : 'No active goal';
  $('#parentGoalProgress').textContent = goal
    ? `${percentage}% of ${currency(goal.target)}`
    : 'Create a goal to start tracking progress';
}

function goalMarkup(goal) {
  const isActive = goal.id === state.activeGoalId;
  const percentage = Math.min(100, Math.round((goal.saved / goal.target) * 100));
  const remaining = Math.max(goal.target - goal.saved, 0);
  return `<article class="surface-card goal-card ${isActive ? 'is-active' : ''}">
    <div class="card-heading-row">
      <div class="goal-icon" aria-hidden="true">✦</div>
      <button class="goal-delete-button" type="button" data-goal-action="delete" data-goal-id="${escapeHtml(goal.id)}" aria-label="Delete ${escapeHtml(goal.name)} goal">Delete</button>
    </div>
    <div class="goal-heading">
      <div><p class="mini-label">${isActive ? 'CURRENT GOAL' : 'SAVING GOAL'}</p><h3>${escapeHtml(goal.name)}</h3></div>
      <span class="goal-percent">${percentage}%</span>
    </div>
    <div class="progress-track" aria-label="Goal progress"><div class="progress-fill" style="width:${percentage}%"></div></div>
    <div class="goal-footer"><span><strong>${currency(goal.saved)}</strong> saved</span><span>${currency(remaining)} left</span></div>
    <div class="goal-card-footer"><span class="goal-microcopy"><span class="goal-spark" aria-hidden="true">✧</span>${isActive ? 'Saving toward this goal' : 'Choose this goal to track it'}</span>
      ${isActive ? '<span class="active-goal-badge">Active</span>' : `<button class="goal-select-button" type="button" data-goal-action="select" data-goal-id="${escapeHtml(goal.id)}">Make active</button>`}
    </div>
  </article>`;
}

function renderWeek() {
  const chart = $('#weekChart');
  const max = Math.max(...state.week, 1);
  chart.innerHTML = state.week.map((amount, index) => {
    const height = amount ? Math.max(15, Math.round((amount / max) * 100)) : 12;
    const classes = ['chart-bar', amount ? '' : 'is-empty', index === state.week.length - 1 ? 'is-today' : ''].filter(Boolean).join(' ');
    return `<span class="${classes}" style="height:${height}%" data-value="${currency(amount)}"></span>`;
  }).join('');
  $('#weekSaved').textContent = currency(state.week.reduce((sum, value) => sum + Number(value || 0), 0));
  $('#streakValue').textContent = state.streak;
}

function renderActivity() {
  const sorted = [...state.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pending = state.pendingRequests.filter((request) => request.status === 'pending');
  $('#activityList').innerHTML = sorted.slice(0, 5).map(activityMarkup).join('');
  $('#parentActivityList').innerHTML = sorted.slice(0, 6).map(activityMarkup).join('');
  $('#reviewCount').textContent = `${sorted.length} ${sorted.length === 1 ? 'move' : 'moves'}`;
  $('#childPendingSection').classList.toggle('hidden', pending.length === 0);
  $('#childPendingList').innerHTML = pending.map(childPendingMarkup).join('');
  $('#pendingRequestsSection').classList.toggle('hidden', pending.length === 0);
  $('#pendingRequestsCount').textContent = `${pending.length} pending`;
  $('#pendingRequestsList').innerHTML = pending.map(parentRequestMarkup).join('');
}

function activityMarkup(item) {
  const isDeduction = item.type === 'spend';
  const iconClass = item.type === 'gift' ? 'gift' : item.type === 'streak' ? 'streak' : isDeduction ? 'gift' : '';
  const icon = item.type === 'gift' ? '♡' : item.type === 'streak' ? '✦' : isDeduction ? '−' : '+';
  const label = item.note || (item.type === 'gift' ? 'A thoughtful gift' : isDeduction ? 'Virtual spending' : 'Virtual savings');
  const moveLabel = item.type === 'gift' ? 'Gift' : isDeduction ? 'Approved deduction' : 'Approved deposit';
  const amountPrefix = isDeduction ? '−' : '+';
  return `<div class="activity-row">
    <span class="activity-icon ${iconClass}" aria-hidden="true">${icon}</span>
    <div class="activity-main"><strong>${escapeHtml(label)}</strong><span>${formatDate(item.createdAt)} · ${moveLabel}</span></div>
    <span class="activity-amount ${isDeduction ? 'is-negative' : ''}">${amountPrefix}${currency(item.amount)}</span>
  </div>`;
}

function childPendingMarkup(request) {
  const actionLabel = request.action === 'deduct' ? 'Deduction requested' : 'Deposit requested';
  return `<div class="child-pending-item">
    <strong>${actionLabel} · ${currency(request.amount)}</strong>
    <span>${escapeHtml(request.note || 'Waiting for parent')}</span>
  </div>`;
}

function parentRequestMarkup(request) {
  const isDeduction = request.action === 'deduct';
  const kind = isDeduction ? 'Deduction' : 'Deposit';
  const className = isDeduction ? 'deduction' : 'deposit';
  const dateLabel = request.requestedAt ? formatDate(request.requestedAt) : 'Just now';
  return `<article class="pending-request-card">
    <div class="pending-request-top"><span class="pending-type ${className}">${kind}</span><strong>${currency(request.amount)}</strong></div>
    <p class="pending-request-note">${escapeHtml(request.note || (isDeduction ? 'Wants to spend virtual money' : 'Wants to add virtual savings'))}</p>
    <span class="pending-request-meta">Requested ${dateLabel}${request.addToGoal ? ' · Affects goal' : ''}</span>
    <div class="pending-request-actions">
      <button class="decline-request-button" type="button" data-request-action="decline" data-request-id="${escapeHtml(request.id)}">Decline</button>
      <button class="approve-request-button" type="button" data-request-action="approve" data-request-id="${escapeHtml(request.id)}">Approve</button>
    </div>
  </article>`;
}

function renderParentView() {
  $('#parentNote').value = state.parentNote || '';
  $('#savedNoteLabel').textContent = state.reviewedAt ? `Saved ${updatedLabel(state.reviewedAt).toLowerCase()}` : 'Not saved yet';
  $('#familyCodeDisplay').textContent = state.familyCode;
  $('#modalParentCode').textContent = state.parentPin;
}

function openGoalModal() {
  $('#goalForm').reset();
  $('#goalError').classList.add('hidden');
  openModal('goalModal');
  window.setTimeout(() => $('#goalNameInput').focus(), 100);
}

async function handleCreateGoal(event) {
  event.preventDefault();
  const name = $('#goalNameInput').value.trim();
  const target = Number($('#goalTargetInput').value);
  if (!name || name.length > 40 || !Number.isFinite(target) || target <= 0 || target > 100000) {
    $('#goalError').textContent = 'Enter a goal name and a target from ₹0.01 to ₹100,000.';
    $('#goalError').classList.remove('hidden');
    return;
  }

  const action = {
    action: 'create',
    goal: { id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, target: Number(target.toFixed(2)), saved: 0 },
  };
  if (!await saveGoalAction(action)) return;
  closeModal('goalModal');
  $('#goalForm').reset();
  renderAll();
  showToast(`“${name}” goal added.`);
}

async function handleGoalActionClick(event) {
  if (event.target.closest('[data-create-goal]')) {
    openGoalModal();
    return;
  }
  const button = event.target.closest('[data-goal-action][data-goal-id]');
  if (!button) return;
  const goalId = button.dataset.goalId;
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) return;

  if (button.dataset.goalAction === 'delete') {
    const pendingForGoal = state.pendingRequests.some((request) => request.status === 'pending'
      && request.addToGoal
      && (request.goalId || state.activeGoalId) === goalId);
    if (pendingForGoal) {
      showToast('Review the pending money request for this goal before deleting it.');
      return;
    }
    if (!window.confirm(`Delete “${goal.name}” and its goal progress? Your virtual balance will not change.`)) return;
    if (!await saveGoalAction({ action: 'delete', goalId })) return;
    renderAll();
    showToast(`“${goal.name}” goal deleted.`);
    return;
  }

  if (button.dataset.goalAction === 'select') {
    if (!await saveGoalAction({ action: 'select', goalId })) return;
    renderAll();
    showToast(`Now tracking “${goal.name}”.`);
  }
}

async function saveGoalAction(action) {
  if (serverAvailable) {
    const synced = await sendToServer(`/api/family/${encodeURIComponent(familyCode)}/goals`, action);
    if (!synced) {
      showToast(lastServerError || 'Could not update the goal. Please try again.');
      return false;
    }
  } else {
    applyLocalGoalAction(action);
    state.updatedAt = new Date().toISOString();
    persistLocal();
  }
  return true;
}

function applyLocalGoalAction(action) {
  if (action.action === 'create') {
    state.goals.push({ ...action.goal });
    state.activeGoalId = action.goal.id;
  } else if (action.action === 'delete') {
    state.goals = state.goals.filter((goal) => goal.id !== action.goalId);
    if (state.activeGoalId === action.goalId) state.activeGoalId = state.goals[0]?.id || null;
  } else if (action.action === 'select' && state.goals.some((goal) => goal.id === action.goalId)) {
    state.activeGoalId = action.goalId;
  }
  syncActiveGoalAlias();
}

function showView(view) {
  if (view === 'activity') {
    currentView = 'savings';
    $('#activitySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateNav('activity');
    return;
  }

  if (view === 'parent') {
    requestParentAccess();
    return;
  }

  currentView = 'savings';
  $('#childView').classList.remove('hidden');
  $('#parentView').classList.add('hidden');
  updateNav('savings');
  setUrlView(null);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showParentView() {
  currentView = 'parent';
  $('#childView').classList.add('hidden');
  $('#parentView').classList.remove('hidden');
  updateNav('parent');
  setUrlView('parent');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateNav(activeView) {
  $$('[data-view-link]').forEach((link) => link.classList.toggle('active', link.dataset.viewLink === activeView));
}

function setUrlView(view) {
  const url = new URL(window.location.href);
  if (view) url.searchParams.set('view', view);
  else url.searchParams.delete('view');
  window.history.replaceState({}, '', url);
  updateShareLinks();
}

function requestParentAccess() {
  if (parentAccessGranted) {
    showParentView();
    return;
  }
  $('#pinInput').value = '';
  $('#pinError').classList.add('hidden');
  openModal('pinModal');
  window.setTimeout(() => $('#pinInput').focus(), 100);
}

function openMoneyModal(action) {
  currentMoneyAction = action;
  const isDeduction = action === 'deduct';
  const goal = activeGoal();
  $('#addModalTitle').textContent = isDeduction ? 'Request a deduction' : 'Request a deposit';
  $('#moneyModalCopy').textContent = isDeduction
    ? 'Tell your parent what you want to spend. Your virtual balance changes only after they approve it.'
    : 'Tell your parent what you want to add. Your virtual balance changes only after they approve it.';
  $('#moneySubmitButton').innerHTML = `${isDeduction ? 'Ask parent to approve deduction' : 'Ask parent to approve deposit'} <span aria-hidden="true">→</span>`;
  const goalCheckText = $('#goalCheckText');
  goalCheckText.replaceChildren(document.createTextNode(isDeduction ? 'Take it from my ' : 'Add it to my '));
  if (goal) {
    const goalName = document.createElement('strong');
    goalName.textContent = goal.name;
    goalCheckText.append(goalName, document.createTextNode(' goal if approved'));
  } else {
    goalCheckText.append(document.createTextNode(' no goal is active'));
  }
  $('#goalCheck').disabled = !goal;
  $('#amountInput').value = '';
  $('#noteInput').value = '';
  $('#goalCheck').checked = Boolean(goal);
  openModal('addModal');
}

function handlePinSubmit(event) {
  event.preventDefault();
  const enteredPin = $('#pinInput').value.trim();
  if (enteredPin !== String(state.parentPin)) {
    $('#pinError').classList.remove('hidden');
    $('#pinInput').select();
    return;
  }
  parentCredential = enteredPin;
  parentAccessGranted = true;
  closeModal('pinModal');
  showParentView();
  showToast('Parent review unlocked.');
}

async function handleAddMoney(event) {
  event.preventDefault();
  const amount = Number($('#amountInput').value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    showToast('Enter an amount between ₹0.01 and ₹100,000.');
    return;
  }

  const pendingDeductions = state.pendingRequests
    .filter((request) => request.action === 'deduct' && request.status === 'pending')
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);
  if (currentMoneyAction === 'deduct' && amount > state.balance - pendingDeductions) {
    showToast(`You can request up to ${currency(Math.max(0, state.balance - pendingDeductions))}.`);
    return;
  }

  const note = $('#noteInput').value.trim() || (currentMoneyAction === 'deduct' ? 'Virtual spending' : 'Virtual savings');
  const addToGoal = $('#goalCheck').checked;
  const now = new Date().toISOString();
  const request = {
    id: `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action: currentMoneyAction,
    amount: Number(amount.toFixed(2)),
    note,
    addToGoal,
    goalId: addToGoal ? state.activeGoalId : null,
    status: 'pending',
    requestedAt: now,
  };

  closeModal('addModal');
  $('#addMoneyForm').reset();
  if (serverAvailable) {
    const synced = await sendToServer(`/api/family/${encodeURIComponent(familyCode)}/requests`, { request });
    if (!synced) {
      renderAll();
      showToast('The request could not be sent. Please try again.');
      return;
    }
  } else {
    state.pendingRequests.unshift(request);
    state.reviewRequestedAt = now;
    state.updatedAt = now;
    persistLocal();
  }
  renderAll();
  showToast(`${currency(request.amount)} sent to your parent for approval.`);
}

async function handleRequestDecisionClick(event) {
  const button = event.target.closest('[data-request-action][data-request-id]');
  if (!button) return;
  const decision = button.dataset.requestAction;
  const requestId = button.dataset.requestId;
  const request = state.pendingRequests.find((item) => item.id === requestId && item.status === 'pending');
  if (!request) return;
  if (decision === 'approve' && request.action === 'deduct' && request.amount > state.balance) {
    showToast('The balance is too low to approve this deduction.');
    return;
  }
  button.disabled = true;

  if (serverAvailable) {
    const synced = await sendToServer(`/api/family/${encodeURIComponent(familyCode)}/requests/${encodeURIComponent(requestId)}/decision`, {
      decision,
      parentPin: parentCredential,
    });
    if (!synced) {
      renderAll();
      showToast('Could not record the decision. Please try again.');
      return;
    }
  } else {
    applyLocalDecision(request, decision);
    state.updatedAt = new Date().toISOString();
    persistLocal();
  }
  renderAll();
  showToast(decision === 'approve' ? 'Request approved.' : 'Request declined.');
}

function applyLocalDecision(request, decision) {
  request.status = decision === 'approve' ? 'approved' : 'declined';
  request.reviewedAt = new Date().toISOString();
  if (decision !== 'approve') return;

  const isDeduction = request.action === 'deduct';
  const amount = Number(request.amount);
  state.balance = Number((state.balance + (isDeduction ? -amount : amount)).toFixed(2));
  if (request.addToGoal) {
    const goal = state.goals.find((item) => item.id === (request.goalId || state.activeGoalId));
    if (goal) goal.saved = Number(Math.max(0, goal.saved + (isDeduction ? -amount : amount)).toFixed(2));
    syncActiveGoalAlias();
  }
  const transaction = {
    id: request.id,
    amount,
    note: request.note,
    type: isDeduction ? 'spend' : 'save',
    createdAt: request.reviewedAt,
  };
  state.transactions.unshift(transaction);
  if (!isDeduction) {
    state.week[state.week.length - 1] = Number((state.week[state.week.length - 1] + amount).toFixed(2));
    state.streak = Math.max(1, state.streak);
  }
  state.reviewedAt = request.reviewedAt;
}

async function saveParentNote() {
  state.parentNote = $('#parentNote').value.trim();
  state.reviewedAt = new Date().toISOString();
  state.updatedAt = state.reviewedAt;
  persistLocal();
  renderParentView();
  const synced = await sendToServer(`/api/family/${encodeURIComponent(familyCode)}/review`, {
    note: state.parentNote,
    reviewedAt: state.reviewedAt,
  });
  if (synced) renderAll();
  showToast('Parent note saved.');
}

function updateShareLinks() {
  const link = new URL(window.location.href);
  link.searchParams.set('family', familyCode);
  link.searchParams.set('view', 'parent');
  const linkString = link.toString();
  $('#shareLink').value = linkString;
  $('#modalShareLink').value = linkString;
}

async function copyTarget(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const value = target.value || target.textContent;
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    if (target.select) {
      target.select();
      document.execCommand('copy');
    }
  }
  showToast('Copied to clipboard.');
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  if ($$('.modal-backdrop:not(.hidden)').length === 0) document.body.style.overflow = '';
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function currency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthSaved() {
  const now = new Date();
  return state.transactions.reduce((sum, item) => {
    const date = new Date(item.createdAt);
    const amount = Number(item.amount || 0) * (item.type === 'spend' ? -1 : 1);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear() ? sum + amount : sum;
  }, 0) || state.transactions.slice(0, 2).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function updatedLabel(value) {
  if (!value) return 'Updated just now';
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  if (minutes < 1440) return `Updated ${Math.floor(minutes / 60)}h ago`;
  return `Updated ${formatDate(value)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}
