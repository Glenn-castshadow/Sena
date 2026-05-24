function getNextSerial(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'next_job_serial'").get();
  return parseInt(row.value, 10);
}

function bumpSerial(db, serial) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'next_job_serial'").run(String(serial + 1));
}

function getClientById(db, clientId) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
}

// Walk up the parent chain and return the top-level ancestor's code.
// e.g. Future Kia of Clovis → Future Auto Group → Sena Advertising → returns 'SENA'
function getRootClientCode(db, clientId) {
  const seen = new Set();
  let current = db.prepare('SELECT id, code, parent_id FROM clients WHERE id = ?').get(clientId);
  while (current && current.parent_id) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    current = db.prepare('SELECT id, code, parent_id FROM clients WHERE id = ?').get(current.parent_id);
  }
  return current ? current.code : null;
}

function getDescendantClientIds(db, rootClientId) {
  return db.prepare(`
    WITH RECURSIVE client_tree(id) AS (
      SELECT id FROM clients WHERE id = ?
      UNION ALL
      SELECT c.id
      FROM clients c
      JOIN client_tree ct ON c.parent_id = ct.id
    )
    SELECT id FROM client_tree
  `).all(rootClientId).map(row => row.id);
}

function listJobs(db, filters) {
  const { search, status, client_id, group_id, created_by_id } = filters;
  let sql = `
    SELECT j.*, c.name as client_name, c.code as client_code,
           c.parent_id, p.name as group_name, p.code as group_code,
           u.username as created_by_username
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    LEFT JOIN clients p ON c.parent_id = p.id
    LEFT JOIN users u ON j.created_by_id = u.id
    WHERE 1=1
  `;
  const params = [];

  // status can be: active | billable | voided | archived
  // or a comma-separated list e.g. "active,billable"
  // Default (no filter): show active + billable, hide archived + voided
  const VALID_STATUSES = ['active', 'billable', 'invoiced', 'voided', 'archived'];
  if (status) {
    const requested = status.split(',').map(s => s.trim()).filter(s => VALID_STATUSES.includes(s));
    if (requested.length === 1) {
      sql += ' AND j.status = ?';
      params.push(requested[0]);
    } else if (requested.length > 1) {
      sql += ` AND j.status IN (${requested.map(() => '?').join(', ')})`;
      params.push(...requested);
    }
  } else {
    // Default: show active, billable, and invoiced; voided/archived off by default
    sql += " AND j.status IN ('active', 'billable', 'invoiced')";
  }

  if (group_id) {
    // Match jobs where:
    // 1. The job's billing client is in the group/descendants, OR
    // 2. The job has ISCI codes belonging to a client in the group/descendants
    // This handles the common case where jobs are billed to SENA but the
    // actual advertiser client (e.g. Future Kia Clovis) is tracked via ISCI codes.
    const descendantIds = getDescendantClientIds(db, group_id);
    const ph = descendantIds.map(() => '?').join(', ');
    sql += ` AND (
      j.client_id IN (${ph})
      OR EXISTS (
        SELECT 1 FROM isci_codes i WHERE i.job_id = j.id AND i.client_id IN (${ph})
      )
    )`;
    params.push(...descendantIds, ...descendantIds);
  } else if (client_id) {
    const descendantIds = getDescendantClientIds(db, client_id);
    const ph = descendantIds.map(() => '?').join(', ');
    sql += ` AND (
      j.client_id IN (${ph})
      OR EXISTS (
        SELECT 1 FROM isci_codes i WHERE i.job_id = j.id AND i.client_id IN (${ph})
      )
    )`;
    params.push(...descendantIds, ...descendantIds);
  }

  if (created_by_id) {
    sql += ' AND j.created_by_id = ?';
    params.push(created_by_id);
  }

  if (search) {
    sql += ' AND (j.job_number LIKE ? OR j.description LIKE ? OR j.notes LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY j.serial DESC';
  return db.prepare(sql).all(...params);
}

// Lists non-archived jobs; from/to are optional date filters
function listActiveJobsInRange(db, from, to) {
  let sql = `
    SELECT j.id, j.job_number, j.serial, j.description, j.created_at, j.status,
           c.name as client_name, c.code as client_code,
           (SELECT COUNT(*) FROM isci_codes WHERE job_id = j.id AND status != 'archived') as isci_count
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    WHERE j.status != 'archived'
  `;
  const params = [];
  if (from && to) {
    sql += ' AND date(j.created_at) >= date(?) AND date(j.created_at) <= date(?)';
    params.push(from, to);
  }
  sql += ' ORDER BY j.serial DESC';
  return db.prepare(sql).all(...params);
}

function listArchivedJobs(db, from, to) {
  let sql = `
    SELECT j.id, j.job_number, j.serial, j.description, j.created_at,
           c.name as client_name, c.code as client_code,
           (SELECT COUNT(*) FROM isci_codes WHERE job_id = j.id AND status = 'archived') as isci_count
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    WHERE j.status = 'archived'
  `;
  const params = [];

  if (from && to) {
    sql += ' AND date(j.created_at) >= date(?) AND date(j.created_at) <= date(?)';
    params.push(from, to);
  }

  sql += ' ORDER BY j.serial DESC';
  return db.prepare(sql).all(...params);
}

function getArchiveRange(db, from, to) {
  return db.prepare(`
    SELECT j.*, c.name as client_name, c.code as client_code,
           u.username as created_by_username
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    LEFT JOIN users u ON j.created_by_id = u.id
    WHERE j.status != 'archived'
      AND date(j.created_at) >= date(?)
      AND date(j.created_at) <= date(?)
    ORDER BY j.serial ASC
  `).all(from, to);
}

function getJobsForExport(db, ids) {
  return ids.map((id) => db.prepare(`
    SELECT j.*, c.name as client_name, c.code as client_code,
           u.username as created_by_username
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    LEFT JOIN users u ON j.created_by_id = u.id
    WHERE j.id = ?
  `).get(id)).filter(Boolean);
}

function getIsciExportRows(db, jobId) {
  return db.prepare(`
    SELECT i.*, c.name as client_name
    FROM isci_codes i
    JOIN clients c ON i.client_id = c.id
    WHERE i.job_id = ? AND i.status != 'archived'
  `).all(jobId);
}

function archiveJobs(db, ids) {
  let archivedIsci = 0;
  db.transaction(() => {
    for (const id of ids) {
      db.prepare("UPDATE jobs SET status = 'archived' WHERE id = ?").run(id);
      archivedIsci += db.prepare("UPDATE isci_codes SET status = 'archived' WHERE job_id = ? AND status != 'archived'").run(id).changes;
    }
  })();
  return { archived_jobs: ids.length, archived_isci: archivedIsci };
}

function restoreJobs(db, ids) {
  let restoredIsci = 0;
  db.transaction(() => {
    for (const id of ids) {
      db.prepare("UPDATE jobs SET status = 'active' WHERE id = ? AND status = 'archived'").run(id);
      restoredIsci += db.prepare("UPDATE isci_codes SET status = 'active' WHERE job_id = ? AND status = 'archived'").run(id).changes;
    }
  })();
  return { restored_jobs: ids.length, restored_isci: restoredIsci };
}

function getJobDetails(db, jobId) {
  const job = db.prepare(`
    SELECT j.*, c.name as client_name, c.code as client_code
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    WHERE j.id = ?
  `).get(jobId);

  if (!job) return null;

  job.isci_codes = db.prepare('SELECT * FROM isci_codes WHERE job_id = ? ORDER BY serial').all(job.id);
  return job;
}

function getJobById(db, jobId) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
}

function insertJob(db, job) {
  return db.prepare(
    'INSERT INTO jobs (serial, job_number, client_id, description, folder_path, folder_created, notes, created_by_id) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    job.serial,
    job.job_number,
    job.client_id,
    job.description,
    job.folder_path,
    job.folder_created,
    job.notes,
    job.created_by_id
  );
}

function getJobSummary(db, jobId) {
  return db.prepare(`
    SELECT j.*, c.name as client_name, c.code as client_code
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    WHERE j.id = ?
  `).get(jobId);
}

function updateJobStatus(db, jobId, status) {
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, jobId);
}

function updateJobNotes(db, jobId, notes) {
  db.prepare('UPDATE jobs SET notes = ? WHERE id = ?').run(notes, jobId);
}

function updateJobFolder(db, jobId, folderPath) {
  db.prepare('UPDATE jobs SET folder_path = ?, folder_created = 1 WHERE id = ?').run(folderPath, jobId);
}

module.exports = {
  archiveJobs,
  bumpSerial,
  getArchiveRange,
  getClientById,
  getDescendantClientIds,
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
};
