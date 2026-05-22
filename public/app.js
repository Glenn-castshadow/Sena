const BASE = window.BASE_PATH || '';
const API  = BASE;

// ── State ──────────────────────────────────────────────────────────────────
let clients = [];
let settings = {};
let currentUser = null;
let notesTarget = null;
let jobCache = {};   // id → job row data
let isciCache = {};  // id → isci row data

// ── Helpers ────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { window.location.href = BASE + '/login'; return; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function canEdit() {
  return currentUser && (currentUser.role === 'admin' || currentUser.role === 'editor');
}

function applyRoleUI() {
  document.querySelectorAll('.editor-only').forEach(el => {
    el.style.display = canEdit() ? '' : 'none';
  });
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = currentUser?.role === 'admin' ? '' : 'none';
  });
  const usersLi = document.getElementById('nav-users-li');
  if (usersLi) usersLi.style.display = currentUser?.role === 'admin' ? '' : 'none';
  const badge = document.getElementById('nav-role-badge');
  if (badge && currentUser) {
    const labels = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
    badge.textContent = labels[currentUser.role] || currentUser.role;
    badge.className = `nav-role-badge role-${currentUser.role}`;
  }
  // Show creator filter only for admins
  const isAdmin = currentUser?.role === 'admin';
  ['job-filter-creator','isci-filter-creator'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
}

async function populateCreatorFilters() {
  if (currentUser?.role !== 'admin') return;
  const users = await api('/api/users');
  ['job-filter-creator','isci-filter-creator'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = '<option value="">All Users</option>';
    users.forEach(u => {
      el.innerHTML += `<option value="${u.id}">${escHtml(u.username)}</option>`;
    });
    if (prev) el.value = prev;
  });
}

// ── Resizable columns ──────────────────────────────────────────────────────
function initResizableCols(tableEl) {
  if (!tableEl || tableEl.dataset.resizable) return;
  tableEl.dataset.resizable = '1';

  const ths = [...tableEl.querySelectorAll('thead th')];
  // Capture natural widths then lock them so table-layout:fixed respects them
  ths.forEach(th => { th.style.width = th.offsetWidth + 'px'; });
  tableEl.style.tableLayout = 'fixed';

  ths.forEach(th => {
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    th.appendChild(handle);

    handle.addEventListener('mousedown', e => {
      const startX = e.clientX;
      const startW = th.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = e => {
        th.style.width = Math.max(40, startW + e.clientX - startX) + 'px';
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  });
}

// ── Navigation ─────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const page = a.dataset.page;
    document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    a.classList.add('active');
    document.getElementById('page-' + page).classList.add('active');
    if (page === 'jobs') loadJobs().then(() => initResizableCols(document.getElementById('jobs-table')));
    if (page === 'isci') loadIsci().then(() => initResizableCols(document.getElementById('isci-table')));
    if (page === 'clients') loadClients().then(() => initResizableCols(document.querySelector('#page-clients table')));
    if (page === 'users') loadUsers().then(() => initResizableCols(document.querySelector('#page-users table')));
    if (page === 'settings') loadSettings();
  });
});

// ── Modal helpers ──────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'modal-new-job') updateJobPreview();
  if (id === 'modal-new-isci') { populateJobDropdown(); updateIsciPreview(); }
  if (id === 'modal-user') {
    // Reset for new user mode
    if (!document.getElementById('user-edit-id').value) {
      document.getElementById('modal-user-title').textContent = 'New User';
      document.getElementById('user-submit-btn').textContent = 'Create User';
      document.getElementById('user-pw-label').innerHTML = 'Password <span class="req">*</span>';
      document.getElementById('user-pw-hint').style.display = 'none';
      document.getElementById('user-active-group').style.display = 'none';
      document.getElementById('user-password').required = true;
    }
  }
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'modal-user') resetUserForm();
}
function closeModalBackdrop(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

// ── Clients ────────────────────────────────────────────────────────────────
async function fetchClients() {
  clients = await api('/api/clients');
  populateClientDropdownsHierarchyV2();
  populateGroupFiltersHierarchyV2();
}

function buildClientChildrenMap(activeOnly = false) {
  const map = new Map();
  clients
    .filter(c => !activeOnly || c.active)
    .forEach(c => {
      const key = c.parent_id || 0;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });

  for (const children of map.values()) {
    children.sort((a, b) => a.name.localeCompare(b.name));
  }

  return map;
}

function hierarchyIndentSafe(depth, useHtml = false) {
  if (depth <= 0) return '';
  const spacer = useHtml ? '&nbsp;&nbsp;' : '\u00A0\u00A0';
  return `${spacer.repeat(depth)}|- `;
}

function flattenClientTree(childrenMap, parentId = 0, depth = 0, rows = []) {
  const children = childrenMap.get(parentId) || [];
  children.forEach(child => {
    rows.push({ client: child, depth });
    flattenClientTree(childrenMap, child.id, depth + 1, rows);
  });
  return rows;
}

function hierarchyIndent(depth, useHtml = false) {
  if (depth <= 0) return '';
  const spacer = useHtml ? '&nbsp;&nbsp;' : '\u00A0\u00A0';
  return `${spacer.repeat(depth)}â†³ `;
}

function populateClientDropdowns() {
  // For job/ISCI creation: flat list of active clients, grouped by parent
  ['#nj-client','#ni-client','#nc-parent'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const isParentPicker = sel === '#nc-parent';
    const prev = el.value;
    el.innerHTML = isParentPicker ? '<option value="">— Top level / no parent —</option>' : '';

    // Group clients by parent
    const topLevel = clients.filter(c => c.active && !c.parent_id);
    const byParent  = {};
    clients.filter(c => c.active && c.parent_id).forEach(c => {
      (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c);
    });

    topLevel.forEach(c => {
      if (!isParentPicker) {
        el.innerHTML += `<option value="${c.id}">${escHtml(c.name)} (${escHtml(c.code)})</option>`;
      } else {
        el.innerHTML += `<option value="${c.id}">${escHtml(c.name)}</option>`;
      }
      if (!isParentPicker && byParent[c.id]) {
        byParent[c.id].forEach(child => {
          el.innerHTML += `<option value="${child.id}">&nbsp;&nbsp;↳ ${escHtml(child.name)} (${escHtml(child.code)})</option>`;
        });
      }
    });
    if (prev) el.value = prev;
  });

  // Filter dropdowns: flat list
  ['#job-filter-client','#isci-filter-client'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = '<option value="">All Clients</option>';
    clients.filter(c => c.active).forEach(c => {
      const indent = c.parent_id ? '↳ ' : '';
      el.innerHTML += `<option value="${c.id}">${indent}${escHtml(c.name)}</option>`;
    });
    if (prev) el.value = prev;
  });
}

function populateGroupFilters() {
  const groups = clients.filter(c => clients.some(ch => ch.parent_id === c.id));
  const sel = document.getElementById('job-filter-group');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Groups</option>';
  groups.forEach(g => {
    sel.innerHTML += `<option value="${g.id}">${escHtml(g.name)}</option>`;
  });
  if (prev) sel.value = prev;
}

function populateClientDropdownsHierarchy() {
  const activeTree = flattenClientTree(buildClientChildrenMap(true));

  ['#nj-client','#ni-client','#nc-parent'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const isParentPicker = sel === '#nc-parent';
    const prev = el.value;
    el.innerHTML = isParentPicker ? '<option value="">â€” Top level / no parent â€”</option>' : '';

    activeTree.forEach(({ client: c, depth }) => {
      const indent = '&nbsp;&nbsp;'.repeat(depth) + (depth > 0 ? '↳ ' : '');
      if (!isParentPicker) {
        el.innerHTML += `<option value="${c.id}">${indent}${escHtml(c.name)} (${escHtml(c.code)})</option>`;
      } else {
        el.innerHTML += `<option value="${c.id}">${indent}${escHtml(c.name)}</option>`;
      }
    });

    if (prev) el.value = prev;
  });

  ['#job-filter-client','#isci-filter-client'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = '<option value="">All Clients</option>';
    activeTree.forEach(({ client: c, depth }) => {
      const indent = '\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '↳ ' : '');
      el.innerHTML += `<option value="${c.id}">${indent}${escHtml(c.name)}</option>`;
    });
    if (prev) el.value = prev;
  });
}

function populateGroupFiltersHierarchy() {
  const groups = flattenClientTree(buildClientChildrenMap(true))
    .filter(({ client }) => clients.some(ch => ch.parent_id === client.id));
  const sel = document.getElementById('job-filter-group');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Groups</option>';
  groups.forEach(({ client: g, depth }) => {
    const indent = '\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '↳ ' : '');
    sel.innerHTML += `<option value="${g.id}">${indent}${escHtml(g.name)}</option>`;
  });
  if (prev) sel.value = prev;
}

function getClientHierarchyRows() {
  return flattenClientTree(buildClientChildrenMap(false));
}

function populateClientDropdownsHierarchyV2() {
  const activeTree = flattenClientTree(buildClientChildrenMap(true));

  ['#nj-client','#ni-client','#nc-parent'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const isParentPicker = sel === '#nc-parent';
    const prev = el.value;
    el.innerHTML = isParentPicker ? '<option value="">- Top level / no parent -</option>' : '';

    activeTree.forEach(({ client: c, depth }) => {
      const indent = '&nbsp;&nbsp;'.repeat(depth) + (depth > 0 ? '|- ' : '');
      if (!isParentPicker) {
        el.innerHTML += `<option value="${c.id}">${indent}${escHtml(c.name)} (${escHtml(c.code)})</option>`;
      } else {
        el.innerHTML += `<option value="${c.id}">${indent}${escHtml(c.name)}</option>`;
      }
    });

    if (prev) el.value = prev;
  });

  ['#job-filter-client','#isci-filter-client'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = '<option value="">All Clients</option>';
    activeTree.forEach(({ client: c, depth }) => {
      const indent = '\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '|- ' : '');
      el.innerHTML += `<option value="${c.id}">${indent}${escHtml(c.name)}</option>`;
    });
    if (prev) el.value = prev;
  });
}

function populateGroupFiltersHierarchyV2() {
  const groups = flattenClientTree(buildClientChildrenMap(true))
    .filter(({ client }) => clients.some(ch => ch.parent_id === client.id));
  const sel = document.getElementById('job-filter-group');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Groups</option>';
  groups.forEach(({ client: g, depth }) => {
    const indent = '\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '|- ' : '');
    sel.innerHTML += `<option value="${g.id}">${indent}${escHtml(g.name)}</option>`;
  });
  if (prev) sel.value = prev;
}

function onGroupFilterChange() {
  // When a group is selected, clear the individual client filter
  const groupId = document.getElementById('job-filter-group').value;
  if (groupId) document.getElementById('job-filter-client').value = '';
  loadJobs();
}

async function loadClients() {
  await fetchClients();
  const tbody = document.getElementById('clients-tbody');
  const editable = canEdit();
  const hierarchyRows = getClientHierarchyRows();

  tbody.innerHTML = hierarchyRows.map(({ client: c, depth }) => {
    const nameCell = depth > 0
      ? `<span class="client-child-indent">${'&nbsp;&nbsp;'.repeat(depth)}|-</span> ${escHtml(c.name)}`
      : `<strong>${escHtml(c.name)}</strong>`;
    return `
    <tr class="${c.active ? '' : 'voided'}">
      <td>${nameCell}</td>
      <td><code>${escHtml(c.code)}</code></td>
      <td><code>${escHtml(c.isci_code)}</code></td>
      <td>${c.parent_name ? `<span class="group-tag">${escHtml(c.parent_name)}</span>` : '<span class="text-dim">â€”</span>'}</td>
      <td><span class="badge ${c.active ? 'badge-active' : 'badge-voided'}">${c.active ? 'Active' : 'Inactive'}</span></td>
      ${editable ? `<td class="actions">
        <button class="btn btn-sm btn-ghost" onclick="openEditClient(${c.id})">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleClient(${c.id},${c.active})">${c.active ? 'Deactivate' : 'Activate'}</button>
      </td>` : ''}
    </tr>`;
  }).join('') || `<tr class="empty-row"><td colspan="${editable ? 6 : 5}">No clients yet.</td></tr>`;
  return;

  // Sort: top-level first, then children under their parent
  const topLevel = clients.filter(c => !c.parent_id);
  const rows = [];
  topLevel.forEach(c => {
    rows.push(c);
    clients.filter(ch => ch.parent_id === c.id).forEach(ch => rows.push(ch));
  });

  tbody.innerHTML = rows.map(c => {
    const isChild = !!c.parent_id;
    const nameCell = isChild
      ? `<span class="client-child-indent">↳</span> ${escHtml(c.name)}`
      : `<strong>${escHtml(c.name)}</strong>`;
    return `
    <tr class="${c.active ? '' : 'voided'}">
      <td>${nameCell}</td>
      <td><code>${escHtml(c.code)}</code></td>
      <td><code>${escHtml(c.isci_code)}</code></td>
      <td>${c.parent_name ? `<span class="group-tag">${escHtml(c.parent_name)}</span>` : '<span class="text-dim">—</span>'}</td>
      <td><span class="badge ${c.active ? 'badge-active' : 'badge-voided'}">${c.active ? 'Active' : 'Inactive'}</span></td>
      ${editable ? `<td class="actions">
        <button class="btn btn-sm btn-ghost" onclick="openEditClient(${c.id})">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleClient(${c.id},${c.active})">${c.active ? 'Deactivate' : 'Activate'}</button>
      </td>` : ''}
    </tr>`;
  }).join('') || `<tr class="empty-row"><td colspan="${editable ? 6 : 5}">No clients yet.</td></tr>`;
}

function openNewClientModal() {
  document.getElementById('nc-edit-id').value = '';
  document.getElementById('nc-title').textContent = 'New Client';
  document.getElementById('nc-submit').textContent = 'Add Client';
  document.getElementById('form-new-client').reset();
  document.getElementById('nc-active-group').style.display = 'none';
  openModal('modal-new-client');
}

async function openEditClient(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  document.getElementById('nc-edit-id').value = c.id;
  document.getElementById('nc-title').textContent = 'Edit Client';
  document.getElementById('nc-submit').textContent = 'Save Changes';
  document.getElementById('nc-name').value = c.name;
  document.getElementById('nc-code').value = c.code;
  document.getElementById('nc-isci').value = c.isci_code;
  document.getElementById('nc-parent').value = c.parent_id || '';
  document.getElementById('nc-active').checked = !!c.active;
  document.getElementById('nc-active-group').style.display = '';
  openModal('modal-new-client');
}

async function submitNewClient(e) {
  e.preventDefault();
  const id = document.getElementById('nc-edit-id').value;
  const body = {
    name: document.getElementById('nc-name').value.trim(),
    code: document.getElementById('nc-code').value.trim().toUpperCase(),
    isci_code: document.getElementById('nc-isci').value.trim().toUpperCase(),
    parent_id: document.getElementById('nc-parent').value || null,
    active: document.getElementById('nc-active').checked ? 1 : 0,
  };
  try {
    if (id) {
      await api(`/api/clients/${id}`, { method: 'PUT', body });
    } else {
      await api('/api/clients', { method: 'POST', body });
    }
    closeModal('modal-new-client');
    document.getElementById('form-new-client').reset();
    await loadClients();
  } catch(err) { alert('Error: ' + err.message); }
}

async function toggleClient(id, active) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  await api(`/api/clients/${id}`, { method: 'PUT',
    body: { name: c.name, code: c.code, isci_code: c.isci_code, active: active ? 0 : 1, parent_id: c.parent_id }
  });
  await loadClients();
}

// ── Jobs ───────────────────────────────────────────────────────────────────
function getActiveStatusChips() {
  return [...document.querySelectorAll('.chip[data-status].active')]
    .map(c => c.dataset.status);
}

function toggleStatusChip(btn) {
  btn.classList.toggle('active');
  loadJobs();
}

async function loadJobs() {
  const search   = document.getElementById('job-search').value.trim();
  const groupId  = document.getElementById('job-filter-group')?.value || '';
  const clientId = document.getElementById('job-filter-client').value;
  const creatorId = document.getElementById('job-filter-creator')?.value || '';
  const activeChips = getActiveStatusChips();

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (groupId) params.set('group_id', groupId);
  else if (clientId) params.set('client_id', clientId);
  if (creatorId) params.set('created_by_id', creatorId);
  if (activeChips.length > 0) params.set('status', activeChips.join(','));

  const jobs = await api('/api/jobs?' + params);
  jobCache = {};
  jobs.forEach(j => jobCache[j.id] = j);
  const tbody = document.getElementById('jobs-tbody');
  const hasRoot = settings.jobs_root?.trim();
  const editable = canEdit();

  const STATUS_LABEL = { active: '● Active', billable: '● Ready to Bill', voided: '● Voided', archived: '● Archived' };
  const STATUS_CYCLE = { active: 'billable', billable: 'archived', archived: 'active', voided: 'active' };

  tbody.innerHTML = jobs.map(j => {
    let folderCell;
    const folderName = escHtml(j.job_number);
    const pathTip = j.folder_path ? escHtml(j.folder_path) : '';

    if (j.folder_created && j.folder_path) {
      folderCell = `
        <div class="folder-status">
          <span class="folder-name folder-ok" title="Location: ${pathTip}">✓ ${folderName}</span>
          ${editable ? `<button class="btn btn-sm btn-ghost folder-btn" id="folder-btn-${j.id}" onclick="pickAndCreateFolder(${j.id})" title="Recreate — pick location and rebuild folder">↺</button>` : ''}
        </div>`;
    } else {
      folderCell = editable
        ? `<div class="folder-pending">
             <span class="folder-name-preview" title="Will be created as: ${folderName}">${folderName}</span>
             <button class="btn btn-sm btn-folder-create" id="folder-btn-${j.id}" onclick="pickAndCreateFolder(${j.id})">📁 Save</button>
           </div>`
        : `<span class="folder-name-preview">${folderName}</span>`;
    }

    const statusBtn = editable
      ? `<button class="status-cycle-btn status-${j.status}" onclick="cycleJobStatus(${j.id},'${j.status}')" title="Click to advance status">${STATUS_LABEL[j.status] || j.status}</button>`
      : `<span class="badge badge-${j.status}">${STATUS_LABEL[j.status] || j.status}</span>`;

    return `
    <tr class="job-status-${j.status}" id="job-row-${j.id}">
      <td><span class="job-number" title="${escHtml(j.job_number)}">${j.serial}${escHtml(j.client_code)}</span></td>
      <td>${escHtml(j.client_name)}</td>
      <td>${escHtml(j.description)}</td>
      <td class="folder-cell">${folderCell}</td>
      <td>${fmtDate(j.created_at)}</td>
      <td>${statusBtn}</td>
      ${editable ? `<td class="actions">
        <button class="btn btn-sm btn-ghost" onclick="openJobDetails(${j.id})">Details</button>
      </td>` : ''}
    </tr>`;
  }).join('') || `<tr class="empty-row"><td colspan="${editable ? 7 : 6}">No jobs found.</td></tr>`;
}

async function submitNewJob(e) {
  e.preventDefault();
  try {
    await api('/api/jobs', { method: 'POST', body: {
      client_id: document.getElementById('nj-client').value,
      description: document.getElementById('nj-description').value.trim(),
      notes: document.getElementById('nj-notes').value.trim(),
    }});
    closeModal('modal-new-job');
    document.getElementById('form-new-job').reset();
    document.getElementById('nj-preview').textContent = '—';
    await loadJobs();
  } catch(err) { alert('Error: ' + err.message); }
}

async function cycleJobStatus(id, current) {
  const cycle = { active: 'billable', billable: 'archived', archived: 'active', voided: 'active' };
  const next = cycle[current] || 'active';
  if (next === 'archived') {
    if (!confirm('Mark this job as Archived? It will be hidden from the main list.\nYou can restore it from Archive → Restore.')) return;
  }
  await api(`/api/jobs/${id}/status`, { method: 'PATCH', body: { status: next } });
  await loadJobs();
}

async function pickAndCreateFolder(id) {
  const btn = document.getElementById(`folder-btn-${id}`);
  if (btn) { btn.textContent = '⏳ Opening…'; btn.disabled = true; }
  try {
    const res = await api(`/api/jobs/${id}/pick-and-create`, { method: 'POST' });
    if (res?.cancelled) {
      if (btn) { btn.textContent = '📁 Create Folder'; btn.disabled = false; }
      return;
    }
    if (res?.ok) await loadJobs();
  } catch(err) {
    alert('Folder creation failed: ' + err.message);
    if (btn) { btn.textContent = '📁 Create Folder'; btn.disabled = false; }
  }
}

async function recreateFolder(id) {
  const j = jobCache[id];
  const label = j ? `${j.serial}${j.client_code}` : `job ${id}`;
  if (!confirm(`Recreate folder structure for ${label}?\n\nPath: ${j?.folder_path}\n\nExisting files will not be affected.`)) return;
  try {
    const res = await api(`/api/jobs/${id}/recreate-folder`, { method: 'POST' });
    if (res?.ok) await loadJobs();
  } catch(err) { alert('Error: ' + err.message); }
}

function slugify(str) {
  return str.trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function updateJobPreview() {
  const clientEl = document.getElementById('nj-client');
  const desc = document.getElementById('nj-description').value.trim();
  const preview = document.getElementById('nj-preview');
  if (!clientEl.value || !desc) { preview.textContent = '—'; return; }
  const client = clients.find(c => String(c.id) === clientEl.value);
  if (!client) return;
  const serial = settings.next_job_serial || '?';
  const slug = slugify(desc);
  preview.textContent = `${serial}${client.code}${slug ? '_' + slug : ''}`;
}

document.getElementById('nj-client').addEventListener('change', updateJobPreview);
document.getElementById('nj-description').addEventListener('input', updateJobPreview);

// ── ISCI ───────────────────────────────────────────────────────────────────
async function loadIsci() {
  const search = document.getElementById('isci-search').value.trim();
  const clientId = document.getElementById('isci-filter-client').value;
  const showVoided = document.getElementById('isci-show-voided').checked;
  const mediaType = document.getElementById('isci-filter-type').value;
  const creatorId = document.getElementById('isci-filter-creator')?.value || '';
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (clientId) params.set('client_id', clientId);
  if (creatorId) params.set('created_by_id', creatorId);
  if (!showVoided) params.set('status', 'active');

  let codes = await api('/api/isci?' + params);
  if (mediaType) codes = codes.filter(c => c.media_type === mediaType);
  isciCache = {};
  codes.forEach(c => isciCache[c.id] = c);
  const editable = canEdit();

  const tbody = document.getElementById('isci-tbody');
  tbody.innerHTML = codes.map(c => {
    const voided = c.status === 'voided';
    return `
    <tr class="${voided ? 'voided' : ''}">
      <td><span class="isci-code isci-copyable" onclick="copyIsci(this,'${escHtml(c.code)}')" title="Click to copy">${escHtml(c.code)}</span></td>
      <td>${escHtml(c.client_name)}</td>
      <td><span class="badge badge-${c.media_type}">${c.media_type === 'H' ? 'HD Video' : 'Radio'}</span></td>
      <td>${escHtml(c.description || '—')}</td>
      <td>${c.job_number ? `<code>${escHtml(c.job_number)}</code>` : '—'}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      ${editable ? `<td class="actions">
        <button class="btn btn-sm btn-ghost" onclick="openIsciDetails(${c.id})">Details</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleIsciStatus(${c.id},'${c.status}')">${voided ? 'Unvoid' : 'Void'}</button>
      </td>` : ''}
    </tr>`;
  }).join('') || `<tr class="empty-row"><td colspan="${editable ? 8 : 7}">No ISCI codes found.</td></tr>`;
}

async function submitNewIsci(e) {
  e.preventDefault();
  try {
    await api('/api/isci', { method: 'POST', body: {
      client_id: document.getElementById('ni-client').value,
      media_type: document.getElementById('ni-type').value,
      job_id: document.getElementById('ni-job').value || null,
      description: document.getElementById('ni-description').value.trim(),
      notes: document.getElementById('ni-notes').value.trim(),
    }});
    closeModal('modal-new-isci');
    document.getElementById('form-new-isci').reset();
    document.getElementById('ni-preview').textContent = '—';
    await loadIsci();
  } catch(err) { alert('Error: ' + err.message); }
}

function copyIsci(el, code) {
  navigator.clipboard.writeText(code).then(() => {
    const orig = el.textContent;
    el.textContent = 'Copied!';
    el.classList.add('isci-copied');
    setTimeout(() => {
      el.textContent = orig;
      el.classList.remove('isci-copied');
    }, 1500);
  });
}

async function toggleIsciStatus(id, current) {
  await api(`/api/isci/${id}/status`, { method: 'PATCH', body: { status: current === 'active' ? 'voided' : 'active' } });
  await loadIsci();
}

async function updateIsciPreview() {
  const clientEl = document.getElementById('ni-client');
  const typeEl = document.getElementById('ni-type');
  const preview = document.getElementById('ni-preview');
  const note = document.getElementById('ni-preview-note');
  if (!clientEl.value) { preview.textContent = '—'; note.textContent = ''; return; }
  const client = clients.find(c => String(c.id) === clientEl.value);
  if (!client) return;
  try {
    const existing = await api(`/api/isci?client_id=${clientEl.value}`);
    const same = existing.filter(c => c.media_type === typeEl.value);
    const nextSerial = (same.length > 0 ? Math.max(...same.map(c => c.serial)) : 0) + 1;
    const paddedSerial = String(nextSerial).padStart(3,'0');
    const agencyCode = settings.agency_code || 'SA';
    const year = String(new Date().getFullYear()).slice(-2);
    preview.textContent = `${agencyCode}${client.isci_code}${year}${paddedSerial}${typeEl.value}`;
    note.textContent = `Next serial: ${paddedSerial}`;
  } catch { preview.textContent = '—'; }
}

document.getElementById('ni-type').addEventListener('change', updateIsciPreview);

async function populateJobDropdown() {
  const jobs = await api('/api/jobs?status=active');
  const sel = document.getElementById('ni-job');
  sel.innerHTML = '<option value="">— None —</option>';
  jobs.forEach(j => { sel.innerHTML += `<option value="${j.id}">${escHtml(j.job_number)}</option>`; });
}

// ── Users ──────────────────────────────────────────────────────────────────
async function loadUsers() {
  const users = await api('/api/users');
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = users.map(u => {
    const isMe = u.id === currentUser?.id;
    const roleLabels = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
    return `
    <tr class="${u.active ? '' : 'voided'}">
      <td><strong>${escHtml(u.username)}</strong>${isMe ? ' <span class="you-badge">you</span>' : ''}</td>
      <td><span class="badge role-badge-${u.role}">${roleLabels[u.role] || u.role}</span></td>
      <td><span class="badge ${u.active ? 'badge-active' : 'badge-voided'}">${u.active ? 'Active' : 'Inactive'}</span></td>
      <td>${fmtDate(u.last_login)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-ghost" onclick="openEditUser(${u.id})">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="openResetPassword(${u.id},'${escHtml(u.username)}')"
          ${isMe ? '' : ''}>Reset PW</button>
      </td>
    </tr>`;
  }).join('') || '<tr class="empty-row"><td colspan="5">No users found.</td></tr>';
}

function resetUserForm() {
  document.getElementById('user-edit-id').value = '';
  document.getElementById('form-user').reset();
  document.getElementById('user-form-error').classList.add('hidden');
  document.getElementById('user-active-group').style.display = 'none';
  document.getElementById('user-pw-hint').style.display = 'none';
  document.getElementById('user-password').required = true;
  document.getElementById('modal-user-title').textContent = 'New User';
  document.getElementById('user-submit-btn').textContent = 'Create User';
}

function openNewUser() {
  resetUserForm();
  openModal('modal-user');
}

async function openEditUser(id) {
  const users = await api('/api/users');
  const u = users.find(x => x.id === id);
  if (!u) return;
  document.getElementById('user-edit-id').value = u.id;
  document.getElementById('user-username').value = u.username;
  document.getElementById('user-role').value = u.role;
  document.getElementById('user-active').checked = !!u.active;
  document.getElementById('user-active-group').style.display = '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-password').required = false;
  document.getElementById('user-pw-label').textContent = 'New Password';
  document.getElementById('user-pw-hint').style.display = '';
  document.getElementById('modal-user-title').textContent = 'Edit User';
  document.getElementById('user-submit-btn').textContent = 'Save Changes';
  document.getElementById('user-form-error').classList.add('hidden');
  openModal('modal-user');
}

function openResetPassword(id, username) {
  openEditUser(id);
}

async function submitUser(e) {
  e.preventDefault();
  const errEl = document.getElementById('user-form-error');
  errEl.classList.add('hidden');
  const id = document.getElementById('user-edit-id').value;
  const username = document.getElementById('user-username').value.trim();
  const role = document.getElementById('user-role').value;
  const active = document.getElementById('user-active').checked;
  const password = document.getElementById('user-password').value;

  try {
    if (id) {
      // Update user
      await api(`/api/users/${id}`, { method: 'PUT', body: { username, role, active } });
      // If password provided, reset it
      if (password) {
        await api(`/api/users/${id}/password`, { method: 'POST', body: { password } });
      }
    } else {
      await api('/api/users', { method: 'POST', body: { username, password, role } });
    }
    closeModal('modal-user');
    await loadUsers();
  } catch(err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

// Password generator
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const all = upper + lower + digits + special;
  let pw = '';
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  pw += special[Math.floor(Math.random() * special.length)];
  for (let i = 4; i < 12; i++) pw += all[Math.floor(Math.random() * all.length)];
  // Shuffle
  pw = pw.split('').sort(() => Math.random() - 0.5).join('');
  document.getElementById('user-password').value = pw;
  document.getElementById('user-password').type = 'text';
}

function copyPassword() {
  const pw = document.getElementById('user-password').value;
  if (!pw) return;
  navigator.clipboard.writeText(pw).then(() => {
    const btn = document.getElementById('btn-copy-pw');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1800);
  });
}

function openJobDetails(id) {
  const j = jobCache[id];
  if (!j) return;
  openNotesModal('job', id, j.notes || '', {
    label: j.job_number,
    created_by: j.created_by_username || null,
    created_at: j.created_at,
    sub: j.client_name,
  });
}

function openIsciDetails(id) {
  const c = isciCache[id];
  if (!c) return;
  openNotesModal('isci', id, c.notes || '', {
    label: c.code,
    created_by: c.created_by_username || null,
    created_at: c.created_at,
    sub: c.client_name,
  });
}

// ── Notes / Details Modal ─────────────────────────────────────────────────
function openNotesModal(type, id, current, meta = {}) {
  notesTarget = { type, id };
  document.getElementById('notes-textarea').value = current;

  const titleEl = document.getElementById('modal-notes-title');
  const metaEl  = document.getElementById('modal-notes-meta');

  titleEl.textContent = meta.label || 'Details';

  const metaItems = [];
  if (meta.created_by) metaItems.push(`<span class="detail-item"><strong>Created by</strong> ${escHtml(meta.created_by)}</span>`);
  if (meta.created_at) metaItems.push(`<span class="detail-item"><strong>Date</strong> ${fmtDate(meta.created_at)}</span>`);
  if (meta.sub)        metaItems.push(`<span class="detail-item">${escHtml(meta.sub)}</span>`);
  metaEl.innerHTML = metaItems.length ? metaItems.join('') : '';

  openModal('modal-notes');
}

async function saveNotes() {
  if (!notesTarget) return;
  const notes = document.getElementById('notes-textarea').value;
  try {
    if (notesTarget.type === 'job') {
      await api(`/api/jobs/${notesTarget.id}/notes`, { method: 'PATCH', body: { notes } });
      await loadJobs();
    } else {
      await api(`/api/isci/${notesTarget.id}`, { method: 'PATCH', body: { notes } });
      await loadIsci();
    }
    closeModal('modal-notes');
  } catch(err) { alert('Error saving notes: ' + err.message); }
}

// ── Settings ───────────────────────────────────────────────────────────────
async function loadSettings() {
  settings = await api('/api/settings');
  document.getElementById('setting-jobs-root').value = settings.jobs_root || '';
  document.getElementById('setting-template-folder').value = settings.template_folder || '';
  document.getElementById('setting-agency-code').value = settings.agency_code || 'SA';
  document.getElementById('setting-next-serial').value = settings.next_job_serial || '1';
}

async function pickFolder() {
  const btn = document.getElementById('btn-pick-folder');
  const note = document.getElementById('pick-folder-note');
  btn.textContent = 'Opening…';
  btn.disabled = true;
  try {
    const res = await api('/api/settings/pick-folder');
    if (res && res.path) {
      document.getElementById('setting-jobs-root').value = res.path;
      note.innerHTML = `<strong>Selected:</strong> ${escHtml(res.path)} — click Save Settings to apply.`;
    } else {
      note.innerHTML = `<strong>No folder selected</strong> — type the path manually if running remotely.`;
    }
  } catch {
    note.innerHTML = `<strong>Folder picker unavailable</strong> — type the path manually.`;
  } finally {
    btn.textContent = 'Browse…';
    btn.disabled = false;
  }
}

async function saveSettings() {
  try {
    const data = {
      jobs_root: document.getElementById('setting-jobs-root').value.trim(),
      template_folder: document.getElementById('setting-template-folder').value.trim(),
      agency_code: document.getElementById('setting-agency-code').value.trim().toUpperCase(),
      next_job_serial: document.getElementById('setting-next-serial').value,
    };
    await api('/api/settings', { method: 'POST', body: data });
    settings = data;
    const ind = document.getElementById('settings-saved');
    ind.textContent = 'Saved!';
    setTimeout(() => ind.textContent = '', 2500);
  } catch(err) { alert('Error: ' + err.message); }
}

async function pickTemplateFolder() {
  const btn = document.getElementById('btn-pick-template');
  btn.textContent = 'Opening…';
  btn.disabled = true;
  try {
    const res = await api('/api/settings/pick-template');
    if (res?.path) document.getElementById('setting-template-folder').value = res.path;
  } finally {
    btn.textContent = 'Browse…';
    btn.disabled = false;
  }
}

// ── Archive / Restore ──────────────────────────────────────────────────────
function switchArchiveTab(tab) {
  document.getElementById('archive-panel').style.display  = tab === 'archive' ? '' : 'none';
  document.getElementById('restore-panel').style.display  = tab === 'restore' ? '' : 'none';
  document.getElementById('tab-archive').classList.toggle('active', tab === 'archive');
  document.getElementById('tab-restore').classList.toggle('active', tab === 'restore');
  // Auto-load all archived jobs when opening restore tab
  if (tab === 'restore') loadArchivedList();
  if (tab === 'archive') loadActiveList();
}
async function loadActiveList() {
  const from = document.getElementById('archive-from').value;
  const to   = document.getElementById('archive-to').value;
  const listWrap = document.getElementById('archive-list-wrap');
  const emptyEl  = document.getElementById('archive-empty');
  const listEl   = document.getElementById('archive-list');

  listWrap.style.display = 'none';
  emptyEl.classList.add('hidden');
  document.getElementById('btn-export-csv').disabled = true;
  document.getElementById('btn-archive').disabled = true;
  if (from && to && from > to) return;  // invalid range only — allow empty dates

  listEl.innerHTML = '<div style="color:var(--text-muted);padding:8px 0">Loading…</div>';
  listWrap.style.display = '';

  try {
    const qs = from && to ? `?from=${from}&to=${to}` : '';
    const jobs = await api(`/api/jobs/active-list${qs}`);
    if (jobs.length === 0) {
      listWrap.style.display = 'none';
      emptyEl.classList.remove('hidden');
      return;
    }
    listEl.innerHTML = jobs.map(j => `
      <label class="restore-item">
        <input type="checkbox" class="archive-cb" value="${j.id}" onchange="updateArchiveCount()">
        <div class="restore-item-info">
          <span class="restore-job-num">${j.serial}${escHtml(j.client_code)}</span>
          <span class="restore-desc">${escHtml(j.description)}</span>
          <span class="restore-meta">${fmtDate(j.created_at)}${j.isci_count > 0 ? ` \xb7 ${j.isci_count} ISCI` : ''}</span>
        </div>
      </label>
    `).join('');
    document.getElementById('archive-select-all').checked = false;
    updateArchiveCount();
  } catch(e) {
    listEl.innerHTML = `<div style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

function updateArchiveCount() {
  const checked = [...document.querySelectorAll('.archive-cb:checked')];
  const total   = document.querySelectorAll('.archive-cb').length;
  document.getElementById('archive-selected-count').textContent =
    checked.length > 0 ? `${checked.length} of ${total} selected` : '';
  const has = checked.length > 0;
  document.getElementById('btn-export-csv').disabled = !has;
  document.getElementById('btn-archive').disabled = !has;
  document.getElementById('archive-select-all').checked = checked.length === total && total > 0;
}

function toggleArchiveSelectAll(el) {
  document.querySelectorAll('.archive-cb').forEach(cb => cb.checked = el.checked);
  updateArchiveCount();
}

function exportCsv() {
  const ids = [...document.querySelectorAll('.archive-cb:checked')].map(cb => cb.value).join(',');
  if (!ids) return;
  const from = document.getElementById('archive-from').value;
  const to   = document.getElementById('archive-to').value;
  const a = document.createElement('a');
  a.href = `${BASE}/api/jobs/export-csv?ids=${ids}&from=${from}&to=${to}`;
  a.download = `sena-jobs-${from}-to-${to}.csv`;
  a.click();
}

async function loadArchivedList() {
  const from = document.getElementById('restore-from').value;
  const to   = document.getElementById('restore-to').value;
  const listWrap = document.getElementById('restore-list-wrap');
  const emptyEl  = document.getElementById('restore-empty');
  const listEl   = document.getElementById('restore-list');
  const btn      = document.getElementById('btn-restore');

  // Validate date range only when both are provided
  if (from && to && from > to) {
    listWrap.style.display = 'none';
    emptyEl.classList.add('hidden');
    btn.disabled = true;
    return;
  }

  listEl.innerHTML = '<div style="color:var(--text-muted);padding:8px 0">Loading…</div>';
  listWrap.style.display = '';

  try {
    const params = from && to ? `?from=${from}&to=${to}` : '';
    const jobs = await api(`/api/jobs/archived-list${params}`);
    if (jobs.length === 0) {
      listWrap.style.display = 'none';
      emptyEl.classList.remove('hidden');
      return;
    }
    listEl.innerHTML = jobs.map(j => `
      <label class="restore-item">
        <input type="checkbox" class="restore-cb" value="${j.id}" onchange="updateRestoreCount()">
        <div class="restore-item-info">
          <span class="restore-job-num">${j.serial}${escHtml(j.client_code)}</span>
          <span class="restore-desc">${escHtml(j.description)}</span>
          <span class="restore-meta">${fmtDate(j.created_at)}${j.isci_count > 0 ? ` · ${j.isci_count} ISCI` : ''}</span>
        </div>
      </label>
    `).join('');
    document.getElementById('restore-select-all').checked = false;
    updateRestoreCount();
  } catch(e) {
    listEl.innerHTML = `<div style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

function updateRestoreCount() {
  const checked = [...document.querySelectorAll('.restore-cb:checked')];
  const total   = document.querySelectorAll('.restore-cb').length;
  document.getElementById('restore-selected-count').textContent =
    checked.length > 0 ? `${checked.length} of ${total} selected` : '';
  document.getElementById('btn-restore').disabled = checked.length === 0;
  document.getElementById('restore-select-all').checked = checked.length === total && total > 0;
}

function toggleSelectAll(el) {
  document.querySelectorAll('.restore-cb').forEach(cb => cb.checked = el.checked);
  updateRestoreCount();
}

async function restoreRecords() {
  const ids = [...document.querySelectorAll('.restore-cb:checked')].map(cb => Number(cb.value));
  if (ids.length === 0) return;
  try {
    const data = await api('/api/jobs/restore', { method: 'POST', body: { ids } });
    document.getElementById('restore-list-wrap').style.display = 'none';
    const emptyEl = document.getElementById('restore-empty');
    emptyEl.classList.remove('hidden');
    emptyEl.innerHTML = `<span class="preview-done">✓ Restored ${data.restored_jobs} job${data.restored_jobs !== 1 ? 's' : ''} and ${data.restored_isci} ISCI code${data.restored_isci !== 1 ? 's' : ''} to active.</span>`;
    document.getElementById('btn-restore').disabled = true;
    await loadJobs();
  } catch(e) { alert('Restore failed: ' + e.message); }
}

async function archiveRecords() {
  const ids = [...document.querySelectorAll('.archive-cb:checked')].map(cb => Number(cb.value));
  if (ids.length === 0) return;
  const confirmed = confirm(`Archive ${ids.length} selected job${ids.length !== 1 ? 's' : ''}?\n\nThey will be hidden from the main list but stay in the database.`);
  if (!confirmed) return;
  try {
    const data = await api('/api/jobs/archive', { method: 'POST', body: { ids } });
    document.getElementById('archive-list-wrap').style.display = 'none';
    const emptyEl = document.getElementById('archive-empty');
    emptyEl.classList.remove('hidden');
    emptyEl.innerHTML = `<span class="preview-done">✓ Archived ${data.archived_jobs} job${data.archived_jobs !== 1 ? 's' : ''} and ${data.archived_isci} ISCI codes.</span>`;
    document.getElementById('btn-export-csv').disabled = true;
    document.getElementById('btn-archive').disabled = true;
    await loadJobs();
  } catch(e) {
    alert('Archive failed: ' + e.message);
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function logout() {
  await fetch(BASE + '/auth/logout', { method: 'POST' });
  window.location.href = BASE + '/login';
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  try {
    currentUser = await fetch(BASE + '/auth/me').then(r => r.json());
    if (currentUser.username) {
      document.getElementById('nav-username').textContent = currentUser.username;
    }
  } catch {}

  applyRoleUI();
  await loadSettings();
  await fetchClients();
  await populateCreatorFilters();
  await loadJobs();
  initResizableCols(document.getElementById('jobs-table'));
}

init();
