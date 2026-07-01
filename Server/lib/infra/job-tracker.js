const fs = require('fs');
const path = require('path');

const JOBS_FILE = path.join(__dirname, '../data/jobs.json');
const jobs = {};

function ensureDir() {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
  } catch {
    /* ignore */
  }
}

function loadJobs() {
  ensureDir();
  if (!fs.existsSync(JOBS_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    Object.assign(jobs, parsed);
  } catch {
    /* ignore corrupt file */
  }
}

function saveJobs() {
  ensureDir();
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getJob(id) {
  return jobs[id] || null;
}

function isJobRunning(id) {
  syncJob(id);
  const job = jobs[id];
  return !!(job && job.status === 'running');
}

function syncJob(id) {
  const job = jobs[id];
  if (!job || job.status !== 'running') return job;
  if (job.pid && !isPidAlive(job.pid)) {
    job.status = 'stale';
    job.endedAt = Date.now();
    saveJobs();
  }
  return job;
}

function syncAllJobs() {
  for (const id of Object.keys(jobs)) syncJob(id);
}

function startJob(id, { label, pid, type = 'process', meta = {} } = {}) {
  jobs[id] = {
    id,
    label: label || id,
    type,
    pid: pid || process.pid,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    meta: meta || {},
  };
  saveJobs();
  return jobs[id];
}

function updateJobPid(id, pid) {
  if (!jobs[id]) return;
  jobs[id].pid = pid;
  saveJobs();
}

function endJob(id, status = 'completed') {
  if (!jobs[id]) return;
  jobs[id].status = status;
  jobs[id].endedAt = Date.now();
  saveJobs();
}

function removeJob(id) {
  delete jobs[id];
  saveJobs();
}

function getAllJobs() {
  syncAllJobs();
  return Object.values(jobs).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function getRunningJobs() {
  return getAllJobs().filter((j) => j.status === 'running');
}

loadJobs();

module.exports = {
  getJob,
  isJobRunning,
  isPidAlive,
  syncJob,
  syncAllJobs,
  startJob,
  updateJobPid,
  endJob,
  removeJob,
  getAllJobs,
  getRunningJobs,
};
