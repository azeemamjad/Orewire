const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { state } = require('../pipeline/state');
const { getAllJobs, getRunningJobs, syncAllJobs } = require('./job-tracker');
const { isNewsPipelineRunning } = require('./news-pipeline');

const execFileAsync = promisify(execFile);

function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '-';
  const gb = n / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = n / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function fmtUptime(sec) {
  if (!sec) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function getPidMetrics(pid) {
  if (!pid) return null;
  if (process.platform === 'win32') {
    try {
      const ps = `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){@{pid=${pid};name=$p.ProcessName;cpuSec=[math]::Round($p.CPU,2);ramMB=[math]::Round($p.WorkingSet64/1MB,1)}|ConvertTo-Json -Compress}`;
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 });
      const raw = stdout.trim();
      if (!raw) return null;
      const p = JSON.parse(raw);
      return {
        pid: p.pid,
        name: p.name,
        cpu: p.cpuSec != null ? `${p.cpuSec}s CPU` : '-',
        ramMB: p.ramMB,
      };
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'pid=,pcpu=,rss=,comm='], { timeout: 5000 });
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 4) return null;
    return {
      pid: parseInt(parts[0], 10),
      cpu: `${parts[1]}%`,
      ramMB: Math.round(parseInt(parts[2], 10) / 1024),
      name: parts.slice(3).join(' '),
    };
  } catch {
    return null;
  }
}

async function getDiskStats() {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select Caption,Size,FreeSpace | ConvertTo-Json -Compress',
      ], { timeout: 8000 });
      const raw = stdout.trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.map((d) => ({
        mount: d.Caption,
        total: fmtBytes(Number(d.Size)),
        free: fmtBytes(Number(d.FreeSpace)),
        usedPct: d.Size ? Math.round((1 - Number(d.FreeSpace) / Number(d.Size)) * 100) : null,
      }));
    } catch {
      return [];
    }
  }
  return [];
}

async function getSystemSnapshot() {
  syncAllJobs();
  const mem = process.memoryUsage();
  const server = {
    pid: process.pid,
    name: 'OreWire API Server',
    uptime: fmtUptime(process.uptime()),
    ramMB: Math.round(mem.rss / (1024 ** 2)),
    heapMB: Math.round(mem.heapUsed / (1024 ** 2)),
    cpu: process.cpuUsage(),
  };

  const host = {
    platform: `${os.type()} ${os.release()}`,
    cpus: os.cpus().length,
    ramTotal: fmtBytes(os.totalmem()),
    ramFree: fmtBytes(os.freemem()),
    ramUsedPct: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    loadAvg: os.loadavg().map((n) => n.toFixed(2)),
    uptime: fmtUptime(os.uptime()),
  };

  const disk = await getDiskStats();

  const appJobs = [];

  if (state.status === 'running') {
    appJobs.push({
      id: 'filing-pipeline',
      label: `Filing pipeline (${state.currentPhase || 'running'})`,
      status: 'running',
      pid: process.pid,
      startedAt: state.startedAt ? new Date(state.startedAt).getTime() : null,
      source: 'memory',
    });
  }

  if (isNewsPipelineRunning()) {
    appJobs.push({
      id: 'news-pipeline',
      label: 'News pipeline (per-company fetch)',
      status: 'running',
      pid: process.pid,
      source: 'memory',
    });
  }

  for (const job of getAllJobs()) {
    appJobs.push({ ...job, source: 'tracker' });
  }

  const seen = new Set();
  const uniqueJobs = [];
  for (const job of appJobs) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    uniqueJobs.push(job);
  }

  const processes = [];
  for (const job of uniqueJobs) {
    const metrics = await getPidMetrics(job.pid);
    processes.push({
      ...job,
      startedAt: job.startedAt || null,
      runningFor: job.startedAt ? fmtUptime((Date.now() - job.startedAt) / 1000) : '-',
      metrics: metrics || { pid: job.pid, name: '-', cpu: '-', ramMB: null },
    });
  }

  processes.unshift({
    id: 'server',
    label: server.name,
    status: 'running',
    pid: server.pid,
    runningFor: server.uptime,
    metrics: { pid: server.pid, name: 'node', cpu: '-', ramMB: server.ramMB },
    source: 'server',
  });

  return {
    server,
    host,
    disk,
    processes,
    runningCount: processes.filter((p) => p.status === 'running').length,
    logCount: state.logs.length,
  };
}

module.exports = { getSystemSnapshot, getPidMetrics, fmtBytes };
