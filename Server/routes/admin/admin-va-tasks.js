const express = require('express');
const db = require('../../db');
const { syncVaTasks } = require('../../lib/va-tasks-sync');

const router = express.Router();

function formatTask(row) {
  return {
    id: row.id,
    module: row.module,
    errorType: row.error_type,
    title: row.title,
    description: row.description || null,
    actionUrl: row.action_url || null,
    severity: row.severity || 'medium',
    occurrenceCount: row.occurrence_count || 1,
    sampleDetail: row.sample_detail || null,
    status: row.status,
    assignedNote: row.assigned_note || null,
    autoManaged: Boolean(row.auto_managed),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by || null,
  };
}

// GET /api/admin/va-tasks/open-count
router.get('/open-count', async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS count FROM va_tasks WHERE status IN ('open', 'in_progress')`,
    );
    res.json({ count: r.rows[0]?.count || 0 });
  } catch (err) {
    console.error('VA tasks open count failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load count' });
  }
});

// POST /api/admin/va-tasks/sync
router.post('/sync', async (_req, res) => {
  try {
    const result = await syncVaTasks();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('VA tasks sync failed:', err?.message || err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// GET /api/admin/va-tasks
router.get('/', async (req, res) => {
  try {
    const filter = String(req.query.filter || 'open').toLowerCase();
    let clause = "WHERE status IN ('open', 'in_progress')";
    if (filter === 'all') clause = '';
    else if (filter === 'done') clause = "WHERE status IN ('done', 'resolved', 'dismissed')";
    else if (filter === 'open') clause = "WHERE status IN ('open', 'in_progress')";

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const orderBy = `
      ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        last_seen_at DESC
    `;

    const [countResult, dataResult] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total FROM va_tasks ${clause}`),
      db.query(
        `SELECT * FROM va_tasks ${clause} ${orderBy} LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ]);

    const total = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      total,
      items: dataResult.rows.map(formatTask),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error('VA tasks list failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load tasks' });
  }
});

// PATCH /api/admin/va-tasks/:id
router.patch('/:id', express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const { status, assignedNote } = req.body || {};
    const allowed = new Set(['open', 'in_progress', 'done', 'dismissed', 'resolved']);
    if (status && !allowed.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const sets = [];
    const vals = [];
    let i = 1;

    if (status) {
      sets.push(`status = $${i++}`);
      vals.push(status);
      if (['done', 'dismissed', 'resolved'].includes(status)) {
        sets.push(`resolved_at = NOW()`);
        sets.push(`resolved_by = $${i++}`);
        vals.push('va');
      } else {
        sets.push(`resolved_at = NULL`);
        sets.push(`resolved_by = NULL`);
      }
    }
    if (assignedNote !== undefined) {
      sets.push(`assigned_note = $${i++}`);
      vals.push(assignedNote ? String(assignedNote).trim().slice(0, 2000) : null);
    }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(id);
    const r = await db.query(
      `UPDATE va_tasks SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals,
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Task not found' });
    res.json(formatTask(r.rows[0]));
  } catch (err) {
    console.error('VA task update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

module.exports = router;
