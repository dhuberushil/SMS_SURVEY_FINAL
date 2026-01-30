const express = require('express');
const router = express.Router();
const corsList = require('../services/corsList');
const logger = require('../logger');

function requireAdminKey(req, res, next) {
  const key = process.env.ADMIN_API_KEY || null;
  if (!key) return res.status(503).json({ error: 'admin key not configured' });
  const provided = req.headers['x-admin-key'] || req.body && req.body.adminKey;
  if (!provided || provided !== key) {
    logger.warn('Unauthorized admin access attempt from %s', req.ip);
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

// GET /api/admin/cors -> list current allowed origins
router.get('/cors', requireAdminKey, (req, res) => {
  return res.json({ allowed: corsList.getAllowed() });
});

// POST /api/admin/cors { origin }
router.post('/cors', requireAdminKey, (req, res) => {
  const origin = req.body && req.body.origin;
  if (!origin) return res.status(400).json({ error: 'origin required' });
  const ok = corsList.addOrigin(origin);
  if (!ok) return res.status(400).json({ error: 'invalid origin' });
  return res.json({ allowed: corsList.getAllowed() });
});

// DELETE /api/admin/cors { origin }
router.delete('/cors', requireAdminKey, (req, res) => {
  const origin = req.body && req.body.origin;
  if (!origin) return res.status(400).json({ error: 'origin required' });
  const removed = corsList.removeOrigin(origin);
  if (!removed) return res.status(404).json({ error: 'origin not found' });
  return res.json({ allowed: corsList.getAllowed() });
});

// POST /api/admin/cors/reset -> reset to initial env-derived list
router.post('/cors/reset', requireAdminKey, (req, res) => {
  corsList.resetToInitial();
  return res.json({ allowed: corsList.getAllowed() });
});

module.exports = router;
