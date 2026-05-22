const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'job-tracker-smoke-'));
process.env.DB_PATH = path.join(tempRoot, 'test.db');
process.env.SESSION_SECRET = 'test-session-secret';
process.env.BASE_PATH = '/jobtrack';
process.env.NODE_ENV = 'test';

const { app } = require('../server');

let server;
let baseUrl;

function getCookie(response) {
  const header = response.headers.get('set-cookie');
  return header ? header.split(';', 1)[0] : '';
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    redirect: 'manual',
    ...options,
  });
}

async function requestJson(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await request(pathname, {
    ...options,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let body = null;
  if (text) {
    body = JSON.parse(text);
  }

  return { response, body };
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
});

test('unauthenticated API requests redirect to the BASE_PATH login route', async () => {
  const response = await request('/api/jobs', {
    headers: { Accept: 'text/html' },
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/jobtrack/login');
});

test('auth flow blocks inactive users and preserves authenticated sessions', async () => {
  const setup = await requestJson('/auth/setup', {
    method: 'POST',
    body: { username: 'admin', password: 'Password123!' },
  });
  assert.equal(setup.response.status, 200);
  assert.deepEqual(setup.body, { ok: true });

  const login = await requestJson('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Password123!' },
  });
  assert.equal(login.response.status, 200);
  const adminCookie = getCookie(login.response);
  assert.ok(adminCookie);

  const me = await requestJson('/auth/me', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.username, 'admin');
  assert.equal(me.body.role, 'admin');

  const createViewer = await requestJson('/api/users', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { username: 'viewer1', password: 'Password123!', role: 'viewer' },
  });
  assert.equal(createViewer.response.status, 200);

  const deactivateViewer = await requestJson(`/api/users/${createViewer.body.id}`, {
    method: 'PUT',
    headers: { Cookie: adminCookie },
    body: {
      username: createViewer.body.username,
      role: createViewer.body.role,
      active: 0,
    },
  });
  assert.equal(deactivateViewer.response.status, 200);
  assert.equal(deactivateViewer.body.active, 0);

  const inactiveLogin = await requestJson('/auth/login', {
    method: 'POST',
    body: { username: 'viewer1', password: 'Password123!' },
  });
  assert.equal(inactiveLogin.response.status, 401);
  assert.equal(inactiveLogin.body.error, 'Invalid username or password');
});

test('job create, archive, restore, and recreate-folder flows work end-to-end', async () => {
  const login = await requestJson('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Password123!' },
  });
  assert.equal(login.response.status, 200);
  const adminCookie = getCookie(login.response);

  const jobsRoot = path.join(tempRoot, 'jobs-root');
  const saveSettings = await requestJson('/api/settings', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: {
      jobs_root: jobsRoot,
      template_folder: '',
      agency_code: 'SA',
      next_job_serial: '1',
    },
  });
  assert.equal(saveSettings.response.status, 200);

  const clients = await requestJson('/api/clients', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(clients.response.status, 200);
  const defaultClient = clients.body.find((client) => client.code === 'SENA');
  assert.ok(defaultClient);

  const createJob = await requestJson('/api/jobs', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: {
      client_id: defaultClient.id,
      description: 'Smoke Test Job',
      notes: 'created by smoke test',
    },
  });
  assert.equal(createJob.response.status, 200);
  assert.equal(createJob.body.folder_created, 1);
  assert.ok(fs.existsSync(createJob.body.folder_path));

  const activeList = await requestJson('/api/jobs/active-list?from=2000-01-01&to=2100-01-01', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(activeList.response.status, 200);
  assert.ok(activeList.body.some((job) => job.id === createJob.body.id));

  const archived = await requestJson('/api/jobs/archive', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { ids: [createJob.body.id] },
  });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.archived_jobs, 1);

  const archivedList = await requestJson('/api/jobs/archived-list', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(archivedList.response.status, 200);
  assert.ok(archivedList.body.some((job) => job.id === createJob.body.id));

  const restored = await requestJson('/api/jobs/restore', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { ids: [createJob.body.id] },
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.restored_jobs, 1);

  fs.rmSync(createJob.body.folder_path, { recursive: true, force: true });
  assert.equal(fs.existsSync(createJob.body.folder_path), false);

  const recreated = await requestJson(`/api/jobs/${createJob.body.id}/recreate-folder`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(recreated.response.status, 200);
  assert.ok(fs.existsSync(createJob.body.folder_path));
  assert.ok(fs.existsSync(path.join(createJob.body.folder_path, 'Audio')));
});

test('group job filters include nested descendant clients', async () => {
  const login = await requestJson('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Password123!' },
  });
  assert.equal(login.response.status, 200);
  const adminCookie = getCookie(login.response);

  const parent = await requestJson('/api/clients', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { name: 'Sunroad Auto', code: 'SUNROAD', isci_code: 'SR' },
  });
  assert.equal(parent.response.status, 200);

  const child = await requestJson('/api/clients', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { name: 'Kearny Mesa Kia', code: 'KMKIA', isci_code: 'KM', parent_id: parent.body.id },
  });
  assert.equal(child.response.status, 200);

  const grandchild = await requestJson('/api/clients', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { name: 'Future EV', code: 'FUTEV', isci_code: 'FE', parent_id: child.body.id },
  });
  assert.equal(grandchild.response.status, 200);

  const job = await requestJson('/api/jobs', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: {
      client_id: grandchild.body.id,
      description: 'Nested Group Job',
      notes: '',
    },
  });
  assert.equal(job.response.status, 200);

  const filtered = await requestJson(`/api/jobs?group_id=${parent.body.id}`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(filtered.response.status, 200);
  assert.ok(filtered.body.some((row) => row.id === job.body.id));
});

test('client job filters include descendant clients when a parent client is selected', async () => {
  const login = await requestJson('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Password123!' },
  });
  assert.equal(login.response.status, 200);
  const adminCookie = getCookie(login.response);

  const parent = await requestJson('/api/clients', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { name: 'Future Auto Group', code: 'FAG', isci_code: 'FA' },
  });
  assert.equal(parent.response.status, 200);

  const childOne = await requestJson('/api/clients', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { name: 'Future Hyundai', code: 'FHYU', isci_code: 'FH', parent_id: parent.body.id },
  });
  assert.equal(childOne.response.status, 200);

  const childTwo = await requestJson('/api/clients', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { name: 'Future Kia', code: 'FKIA', isci_code: 'FK', parent_id: parent.body.id },
  });
  assert.equal(childTwo.response.status, 200);

  const childThree = await requestJson('/api/clients', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { name: 'Future Ford', code: 'FFRD', isci_code: 'FF', parent_id: parent.body.id },
  });
  assert.equal(childThree.response.status, 200);

  const createdJobs = [];
  for (const client of [childOne.body, childTwo.body, childThree.body]) {
    const job = await requestJson('/api/jobs', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: {
        client_id: client.id,
        description: `Job for ${client.name}`,
        notes: '',
      },
    });
    assert.equal(job.response.status, 200);
    createdJobs.push(job.body.id);
  }

  const filtered = await requestJson(`/api/jobs?client_id=${parent.body.id}`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(filtered.response.status, 200);
  createdJobs.forEach((jobId) => {
    assert.ok(filtered.body.some((row) => row.id === jobId));
  });
});
