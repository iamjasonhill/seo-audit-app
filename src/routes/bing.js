const express = require('express');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const { BingApiClient } = require('../services/bingApi');

const router = express.Router();

// GET /api/bing/properties?apiKey=... (apiKey optional if set via env)
router.get('/properties', requireAuth, async (req, res) => {
  try {
    const apiKey = (req.query.apiKey || '').trim() || process.env.BING_API_KEY || '';
    const client = new BingApiClient(apiKey);
    const sites = await client.getUserSites();
    res.json({ success: true, properties: sites });
  } catch (err) {
    logger.error('Bing properties error:', err.message);
    res.status(err.status || 500).json({ error: 'BingPropertiesError', message: err.message });
  }
});

module.exports = router;


