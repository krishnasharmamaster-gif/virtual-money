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
    name: 'A new bike',
    target: 250,
    saved: 128.5,
  },
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
    if (serverAvailable && currentView === 'parent') refreshFromServer(true);
  }, 15000);
}

function bindEvents() {
  $$('#openAddButton').forEach((button) => button.addEventListener('click', () => openModal('addModal')));
  $('#shareButton').addEventListener('click', () => openModal('shareModal'));
  $('#openParentButton').addEventListener('click', requestParentAccess);
  $('#backToSavings').addEventListener('click', () => showView('savings'));
  $('#shareDoneButton').addEventListener('click', () => closeModal('shareModal'));
  $('#learnButton').addEventListener('click', () => showToast('Virtual Money is a practice space — no real money moves here.'));
  $('#profileButton').addEventListener('click', () => showToast('Your profile is ready for the next step.'));
  $('#addGoalButton').addEventListener('click', () => showToast('Goal editing is coming next. Your bike goal is active.'));

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
  const merged = {
    ...DEFAULT_STATE,
    ...next,
    familyCode,
    profile: { ...DEFAULT_STATE.profile, ...(next?.profile || {}) },
    goal: { ...DEFAULT_STATE.goal, ...(next?.goal || {}) },
    week: Array.isArray(next?.week) ? next.week.slice(0, 7) : DEFAULT_STATE.week.slice(),
    transactions: Array.isArray(next?.transactions) ? next.transactions : DEFAULT_STATE.transactions.slice(),
  };
  while (merged.week.length < 7) merged.week.unshift(0);
  return merged;
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
    if (!silent) showToast('Your family space is ready to sync.');
  } catch (error) {
    serverAvailable = false;
    setSyncStatus('Local preview', false);
  }
}

async function sendToServer(path, payload) {
  if (!serverAvailable || window.location.protocol === 'file:') return false;
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    state = mergeState(await response.json());
    persistLocal();
    return true;
  } catch (error) {
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
  $('#nextMilestone').textContent = `${currency(Math.max(state.goal.target - state.goal.saved, 0))} to go`;
  $('#goalDueText').textContent = state.goal.name;
  $('#lastUpdated').textContent = updatedLabel(state.updatedAt);
  $('#reviewFooterText').textContent = state.reviewRequestedAt
    ? 'A parent review has been requested for this family space.'
    : 'Everything here is virtual and made for practice.';
}

function renderGoal() {
  const percentage = Math.min(100, Math.round((state.goal.saved / state.goal.target) * 100));
  $('#goalTitle').textContent = state.goal.name;
  $('#goalPercent').textContent = `${percentage}%`;
  $('#goalProgress').style.width = `${percentage}%`;
  $('#goalSaved').textContent = currency(state.goal.saved);
  $('#goalRemaining').textContent = currency(Math.max(state.goal.target - state.goal.saved, 0));
  $('#parentGoalName').textContent = state.goal.name;
  $('#parentGoalProgress').textContent = `${percentage}% of ${currency(state.goal.target)}`;
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
  $('#activityList').innerHTML = sorted.slice(0, 5).map(activityMarkup).join('');
  $('#parentActivityList').innerHTML = sorted.slice(0, 6).map(activityMarkup).join('');
  $('#reviewCount').textContent = `${sorted.length} ${sorted.length === 1 ? 'move' : 'moves'}`;
}

function activityMarkup(item) {
  const iconClass = item.type === 'gift' ? 'gift' : item.type === 'streak' ? 'streak' : '';
  const icon = item.type === 'gift' ? '♡' : item.type === 'streak' ? '✦' : '+';
  const label = item.note || (item.type === 'gift' ? 'A thoughtful gift' : 'Virtual savings');
  return `<div class="activity-row">
    <span class="activity-icon ${iconClass}" aria-hidden="true">${icon}</span>
    <div class="activity-main"><strong>${escapeHtml(label)}</strong><span>${formatDate(item.createdAt)} · ${item.type === 'gift' ? 'Gift' : 'Saved to goal'}</span></div>
    <span class="activity-amount">+${currency(item.amount)}</span>
  </div>`;
}

function renderParentView() {
  $('#parentNote').value = state.parentNote || '';
  $('#savedNoteLabel').textContent = state.reviewedAt ? `Saved ${updatedLabel(state.reviewedAt).toLowerCase()}` : 'Not saved yet';
  $('#familyCodeDisplay').textContent = state.familyCode;
  $('#modalParentCode').textContent = state.parentPin;
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

function handlePinSubmit(event) {
  event.preventDefault();
  if ($('#pinInput').value.trim() !== String(state.parentPin)) {
    $('#pinError').classList.remove('hidden');
    $('#pinInput').select();
    return;
  }
  parentAccessGranted = true;
  closeModal('pinModal');
  showParentView();
  showToast('Parent review unlocked.');
}

async function handleAddMoney(event) {
  event.preventDefault();
  const amount = Number($('#amountInput').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('Add an amount greater than zero.');
    return;
  }

  const note = $('#noteInput').value.trim() || 'Virtual savings';
  const addToGoal = $('#goalCheck').checked;
  const now = new Date().toISOString();
  const transaction = { id: `local-${Date.now()}`, amount: Number(amount.toFixed(2)), note, type: 'save', createdAt: now };
  state.balance = Number((state.balance + transaction.amount).toFixed(2));
  if (addToGoal) state.goal.saved = Number((state.goal.saved + transaction.amount).toFixed(2));
  state.transactions.unshift(transaction);
  state.week[state.week.length - 1] = Number((state.week[state.week.length - 1] + transaction.amount).toFixed(2));
  state.streak = Math.max(1, state.streak);
  state.updatedAt = now;
  state.reviewRequestedAt = now;
  persistLocal();

  closeModal('addModal');
  $('#addMoneyForm').reset();
  renderAll();
  showToast(`${currency(transaction.amount)} saved in Virtual Money.`);

  const synced = await sendToServer(`/api/family/${encodeURIComponent(familyCode)}/transactions`, { transaction, addToGoal });
  if (synced) {
    renderAll();
    showToast('Saved and synced with Dad.');
  }
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
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear() ? sum + Number(item.amount || 0) : sum;
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
