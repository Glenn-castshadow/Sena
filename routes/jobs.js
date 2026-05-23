const express = require('express');
const router = express.Router();
const db = require('../database');
const {
  createFolderAtPath,
  getSetting,
  getSubfolders,
  makeJobFolderName,
  openFolderPicker,
  recreateFolderAtPath,
} = require('../lib/jobs-folders');
const {
  archiveJobs,
  bumpSerial,
  getArchiveRange,
  getClientById,
  getRootClientCode,
  getIsciExportRows,
  getJobById,
  getJobDetails,
  getJobSummary,
  getJobsForExport,
  getNextSerial,
  insertJob,
  listActiveJobsInRange,
  listArchivedJobs,
  listJobs,
  restoreJobs,
  updateJobFolder,
  updateJobNotes,
  updateJobStatus,
} = require('../lib/jobs-repository');

function parseIdList(ids) {
  return ids.split(',').map(Number).filter(Boolean);
}

function escapeCsv(value) {
  const stringValue = String(value ?? '');
  return stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
}

function buildCsvRows(jobs) {
  const headers = ['Job Number', 'Client', 'Description', 'Folder', 'Created', 'Status', 'Notes', 'Created By'];
  const rows = jobs.map((job) => [
    job.job_number,
    job.client_name,
    job.description,
    job.folder_path || '',
    job.created_at || '',
    job.status,
    (job.notes || '').replace(/\n/g, ' '),
    job.created_by_username || '',
  ].map(escapeCsv).join(','));

  const isciHeaders = ['', 'ISCI Code', 'Client', 'Type', 'Description', 'Linked Job', 'Created', 'Status'];
  const isciRows = [];

  for (const job of jobs) {
    for (const isci of getIsciExportRows(db, job.id)) {
      isciRows.push([
        '',
        isci.code,
        isci.client_name,
        isci.media_type === 'H' ? 'HD Video' : 'Radio',
        isci.description || '',
        job.job_number,
        isci.created_at || '',
        isci.status,
      ].map(escapeCsv).join(','));
    }
  }

  return [headers.join(','), ...rows, '', 'ISCI CODES', isciHeaders.join(','), ...isciRows].join('\r\n');
}

router.get('/', (req, res) => {
  res.json(listJobs(db, req.query));
});

// from/to are optional; omit to get all non-archived jobs
router.get('/active-list', (req, res) => {
  const { from, to } = req.query;
  res.json(listActiveJobsInRange(db, from || null, to || null));
});

router.get('/export-csv', (req, res) => {
  const { ids, from, to } = req.query;
  let jobs;
  const label = from && to ? `${from}-to-${to}` : 'export';

  if (ids) {
    jobs = getJobsForExport(db, parseIdList(ids));
  } else {
    if (!from || !to) return res.status(400).json({ error: 'ids or from+to required' });
    jobs = getArchiveRange(db, from, to);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sena-jobs-${label}.csv"`);
  res.send(buildCsvRows(jobs));
});

router.post('/archive', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  res.json(archiveJobs(db, ids));
});

router.get('/archived-list', (req, res) => {
  const { from, to } = req.query;
  res.json(listArchivedJobs(db, from, to));
});

router.post('/restore', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  res.json(restoreJobs(db, ids));
});

router.get('/:id', (req, res) => {
  const job = getJobDetails(db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

router.post('/', (req, res) => {
  const { client_id, description, notes } = req.body;
  if (!client_id || !description) {
    return res.status(400).json({ error: 'client_id and description are required' });
  }

  const client = getClientById(db, client_id);
  if (!client) return res.status(400).json({ error: 'Client not found' });

  const serial = getNextSerial(db);
  // Use the top-level ancestor's code for the job number
  // e.g. Future Kia of Clovis → Future Auto Group → Sena Advertising → 'SENA'
  const billingCode = getRootClientCode(db, client_id) || client.code;
  const jobNumber = makeJobFolderName(serial, billingCode, description);
  const jobsRoot = getSetting(db, 'jobs_root') || '';
  let folderPath = '';
  let folderCreated = 0;

  if (jobsRoot) {
    try {
      folderPath = createFolderAtPath(db, jobsRoot, jobNumber);
      folderCreated = 1;
    } catch {
      folderPath = require('path').join(jobsRoot, jobNumber);
    }
  }

  const createdById = req.session?.userId || null;
  const result = insertJob(db, {
    serial,
    job_number: jobNumber,
    client_id,
    description,
    folder_path: folderPath,
    folder_created: folderCreated,
    notes: notes || null,
    created_by_id: createdById,
  });

  bumpSerial(db, serial);
  res.json(getJobSummary(db, result.lastInsertRowid));
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'billable', 'invoiced', 'voided', 'archived'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  updateJobStatus(db, req.params.id, status);
  res.json({ ok: true });
});

router.patch('/:id/notes', (req, res) => {
  updateJobNotes(db, req.params.id, req.body.notes);
  res.json({ ok: true });
});

router.post('/:id/pick-and-create', async (req, res) => {
  const job = getJobById(db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const defaultRoot = getSetting(db, 'jobs_root') || '';
  const parentPath = await openFolderPicker(`Select parent folder for: ${job.job_number}`, defaultRoot);
  if (!parentPath) return res.json({ cancelled: true });

  try {
    const folderPath = createFolderAtPath(db, parentPath, job.job_number);
    updateJobFolder(db, job.id, folderPath);
    res.json({ ok: true, folder_path: folderPath, folder_name: job.job_number });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Returns info the local helper needs to pick + create a folder on the client machine
router.get('/:id/folder-info', (req, res) => {
  const job = getJobById(db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({
    job_number: job.job_number,
    default_path: getSetting(db, 'jobs_root') || '',
    subfolders: getSubfolders(db),
  });
});

// Called by the frontend after the local helper has created the folder
router.post('/:id/set-folder-path', (req, res) => {
  const { folder_path } = req.body;
  if (!folder_path) return res.status(400).json({ error: 'folder_path is required' });
  const job = getJobById(db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  updateJobFolder(db, job.id, folder_path);
  res.json({ ok: true, folder_path });
});

router.post('/:id/recreate-folder', (req, res) => {
  const job = getJobById(db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  if (!job.folder_path) return res.status(400).json({ error: 'No folder path saved for this job' });

  try {
    recreateFolderAtPath(db, job.folder_path);
    updateJobFolder(db, job.id, job.folder_path);
    res.json({ ok: true, folder_path: job.folder_path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
