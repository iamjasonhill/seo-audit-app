const express = require('express');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const { BingApiClient } = require('../services/bingApi');
const bingIngest = require('../services/bingIngest');
const databaseService = require('../services/database');

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

// POST /api/bing/sync - Sync data for a specific site
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const { siteUrl, searchType = 'web', daysBack = 30, includeQueries = true, includePages = true } = req.body;
    
    if (!siteUrl) {
      return res.status(400).json({ error: 'Missing siteUrl parameter' });
    }

    logger.info(`Manual Bing sync requested for ${siteUrl}`);
    
    const results = await bingIngest.syncSite(siteUrl, searchType, {
      daysBack,
      includeQueries,
      includePages,
      includeTotals: true
    });

    res.json({ success: true, results });
  } catch (err) {
    logger.error('Bing sync error:', err.message);
    res.status(err.status || 500).json({ error: 'BingSyncError', message: err.message });
  }
});

// POST /api/bing/backfill - Backfill historical data for a site
router.post('/backfill', requireAuth, async (req, res) => {
  try {
    const { siteUrl, searchType = 'web', monthsBack = 6 } = req.body;
    
    if (!siteUrl) {
      return res.status(400).json({ error: 'Missing siteUrl parameter' });
    }

    logger.info(`Bing backfill requested for ${siteUrl} (${monthsBack} months)`);
    
    const results = await bingIngest.backfillSite(siteUrl, searchType, monthsBack);

    res.json({ success: true, results });
  } catch (err) {
    logger.error('Bing backfill error:', err.message);
    res.status(err.status || 500).json({ error: 'BingBackfillError', message: err.message });
  }
});

// GET /api/bing/sync-status - Get sync status for all sites
router.get('/sync-status', requireAuth, async (req, res) => {
  try {
    const statuses = await databaseService.prisma.bingSyncStatus.findMany({
      orderBy: [
        { siteUrl: 'asc' },
        { searchType: 'asc' },
        { dimension: 'asc' }
      ]
    });

    res.json({ success: true, statuses });
  } catch (err) {
    logger.error('Bing sync status error:', err.message);
    res.status(err.status || 500).json({ error: 'BingSyncStatusError', message: err.message });
  }
});

// GET /api/bing/data/:siteUrl - Get Bing data for a specific site
router.get('/data/:siteUrl', requireAuth, async (req, res) => {
  try {
    const { siteUrl } = req.params;
    const { searchType = 'web', days = 30, dataType = 'totals' } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - parseInt(days));

    let data = [];

    switch (dataType) {
      case 'totals':
        data = await databaseService.prisma.bingTotalsDaily.findMany({
          where: {
            siteUrl: decodeURIComponent(siteUrl),
            searchType,
            date: { gte: startDate, lte: endDate }
          },
          orderBy: { date: 'desc' }
        });
        break;
      
      case 'queries':
        data = await databaseService.prisma.bingQueriesDaily.findMany({
          where: {
            siteUrl: decodeURIComponent(siteUrl),
            searchType,
            date: { gte: startDate, lte: endDate }
          },
          orderBy: [{ date: 'desc' }, { clicks: 'desc' }],
          take: 1000
        });
        break;
      
      case 'pages':
        data = await databaseService.prisma.bingPagesDaily.findMany({
          where: {
            siteUrl: decodeURIComponent(siteUrl),
            searchType,
            date: { gte: startDate, lte: endDate }
          },
          orderBy: [{ date: 'desc' }, { clicks: 'desc' }],
          take: 1000
        });
        break;
      
      default:
        return res.status(400).json({ error: 'Invalid dataType. Use: totals, queries, or pages' });
    }

    res.json({ success: true, data, siteUrl: decodeURIComponent(siteUrl), searchType, days: parseInt(days) });
  } catch (err) {
    logger.error('Bing data fetch error:', err.message);
    res.status(err.status || 500).json({ error: 'BingDataError', message: err.message });
  }
});

module.exports = router;


