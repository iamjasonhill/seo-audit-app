const express = require('express');
const databaseService = require('../services/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  // Fetch user role from DB each request for simplicity
  databaseService.prisma.user.findUnique({ where: { id: req.user.id } })
    .then(u => {
      if (!u || u.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
      next();
    }).catch(() => res.status(500).json({ error: 'ServerError' }));
}

// List users
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await databaseService.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ success: true, users });
});

// Create user (email, role; status active by default)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, role = 'user' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'BadRequest', message: 'email is required' });
  try {
    const user = await databaseService.prisma.user.upsert({
      where: { email },
      update: { role, status: 'active' },
      create: { email, role, status: 'active' },
    });
    res.json({ success: true, user });
  } catch (e) {
    res.status(500).json({ error: 'CreateError', message: e.message });
  }
});

// Update user (role/status)
router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { role, status } = req.body || {};
  try {
    const user = await databaseService.prisma.user.update({ where: { id }, data: { role, status } });
    res.json({ success: true, user });
  } catch (e) {
    res.status(500).json({ error: 'UpdateError', message: e.message });
  }
});

// List domains per user (user -> registered properties)
router.get('/user-properties', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await databaseService.prisma.user.findMany({ orderBy: { id: 'asc' } });
    const props = await databaseService.prisma.gscUserProperty.findMany({ orderBy: [{ userId: 'asc' }, { priorityOrder: 'asc' }] });
    const map = users.map(u => ({
      user: { id: u.id, email: u.email, username: u.username, role: u.role, status: u.status },
      properties: props.filter(p => p.userId === u.id).map(p => ({ siteUrl: p.siteUrl, enabled: p.enabled, priorityOrder: p.priorityOrder, lastFullSyncAt: p.lastFullSyncAt, nextSyncDueAt: p.nextSyncDueAt }))
    }));
    res.json({ success: true, items: map });
  } catch (e) {
    res.status(500).json({ error: 'ListError', message: e.message });
  }
});

module.exports = router;


