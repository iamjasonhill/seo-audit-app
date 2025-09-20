const express = require('express');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const { BingApiClient } = require('../services/bingApi');
const bingIngest = require('../services/bingIngest');
const bingScheduler = require('../services/bingScheduler');
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

// POST /api/bing/backfill-all - Bulk backfill all available sites
router.post('/backfill-all', requireAuth, async (req, res) => {
  try {
    const { searchType = 'web', monthsBack = 24 } = req.body; // Default to 2 years of data
    
    logger.info(`Starting bulk Bing backfill for all sites (${monthsBack} months)`);
    
    // Get all available sites from Bing
    const apiKey = process.env.BING_API_KEY || '';
    const bingApi = new BingApiClient(apiKey);
    const sites = await bingApi.getUserSites();
    
    if (!sites || sites.length === 0) {
      return res.status(400).json({ 
        error: 'No sites found in Bing Webmaster Tools' 
      });
    }

    const results = [];
    
    // Process each site
    for (const site of sites) {
      try {
        logger.info(`Backfilling data for ${site.siteUrl}`);
        const result = await bingIngest.backfillSite(site.siteUrl, searchType, monthsBack);
        results.push({
          siteUrl: site.siteUrl,
          success: true,
          result
        });
      } catch (error) {
        logger.error(`Backfill failed for ${site.siteUrl}:`, error);
        results.push({
          siteUrl: site.siteUrl,
          success: false,
          error: error.message
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    res.json({
      success: true,
      message: `Bulk backfill completed: ${successCount} successful, ${failureCount} failed`,
      summary: {
        totalSites: sites.length,
        successful: successCount,
        failed: failureCount
      },
      results
    });
  } catch (error) {
    logger.error('Bulk Bing backfill error:', error);
    res.status(500).json({ 
      error: 'Bulk backfill failed', 
      message: error.message 
    });
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
    const { searchType = 'web', days = 30, dataType = 'totals', startDate, endDate } = req.query;
    
    let start, end;
    
    if (startDate && endDate) {
      // Use provided date range
      start = new Date(startDate);
      end = new Date(endDate);
      logger.info(`Bing data request: ${siteUrl}, startDate: ${startDate}, endDate: ${endDate}, parsed start: ${start}, parsed end: ${end}`);
    } else {
      // Fallback to days-based calculation
      end = new Date();
      start = new Date();
      start.setDate(end.getDate() - parseInt(days));
      logger.info(`Bing data request: ${siteUrl}, using days: ${days}, calculated start: ${start}, calculated end: ${end}`);
    }

    let data = [];

    switch (dataType) {
      case 'totals':
        data = await databaseService.prisma.bingTotalsDaily.findMany({
          where: {
            siteUrl: decodeURIComponent(siteUrl),
            searchType,
            date: { gte: start, lte: end }
          },
          orderBy: { date: 'desc' }
        });
        break;
      
      case 'queries':
        data = await databaseService.prisma.bingQueriesDaily.findMany({
          where: {
            siteUrl: decodeURIComponent(siteUrl),
            searchType,
            date: { gte: start, lte: end }
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
            date: { gte: start, lte: end }
          },
          orderBy: [{ date: 'desc' }, { clicks: 'desc' }],
          take: 1000
        });
        break;
      
      default:
        return res.status(400).json({ error: 'Invalid dataType. Use: totals, queries, or pages' });
    }

    logger.info(`Bing data response: ${dataType}, records: ${data.length}, siteUrl: ${decodeURIComponent(siteUrl)}`);
    res.json({ success: true, data, siteUrl: decodeURIComponent(siteUrl), searchType, days: parseInt(days) });
  } catch (err) {
    logger.error('Bing data fetch error:', err.message);
    res.status(err.status || 500).json({ error: 'BingDataError', message: err.message });
  }
});

// POST /api/bing/scheduler/add - Add a property to the scheduler
router.post('/scheduler/add', requireAuth, async (req, res) => {
  try {
    const { siteUrl, syncIntervalHours = 24, priorityOrder = 0 } = req.body;
    const userId = req.user.id;
    
    if (!siteUrl) {
      return res.status(400).json({ error: 'Site URL is required' });
    }

    await bingScheduler.addProperty(userId, siteUrl, { syncIntervalHours, priorityOrder });
    
    res.json({
      success: true,
      message: `Added ${siteUrl} to Bing scheduler`
    });
  } catch (error) {
    logger.error('Bing scheduler add error:', error);
    res.status(500).json({ 
      error: 'Failed to add property to scheduler', 
      message: error.message 
    });
  }
});

// DELETE /api/bing/scheduler/remove - Remove a property from the scheduler
router.delete('/scheduler/remove', requireAuth, async (req, res) => {
  try {
    const { siteUrl } = req.body;
    const userId = req.user.id;
    
    if (!siteUrl) {
      return res.status(400).json({ error: 'Site URL is required' });
    }

    await bingScheduler.removeProperty(userId, siteUrl);
    
    res.json({
      success: true,
      message: `Removed ${siteUrl} from Bing scheduler`
    });
  } catch (error) {
    logger.error('Bing scheduler remove error:', error);
    res.status(500).json({ 
      error: 'Failed to remove property from scheduler', 
      message: error.message 
    });
  }
});

// GET /api/bing/scheduler/properties - Get scheduled properties for user
router.get('/scheduler/properties', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const properties = await databaseService.prisma.bingUserProperty.findMany({
      where: { userId },
      orderBy: [
        { priorityOrder: 'asc' },
        { nextSyncDueAt: 'asc' },
        { lastFullSyncAt: 'asc' }
      ]
    });

    res.json({
      success: true,
      properties
    });
  } catch (error) {
    logger.error('Bing scheduler properties error:', error);
    res.status(500).json({ 
      error: 'Failed to get scheduled properties', 
      message: error.message 
    });
  }
});

// POST /api/bing/setup-tables - Create missing tables (admin only)
router.post('/setup-tables', requireAuth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Create tables if they don't exist using raw SQL
    const createTablesSQL = `
      CREATE TABLE IF NOT EXISTS bing_user_property (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        site_url TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        sync_interval_hours INTEGER DEFAULT 24,
        priority_order INTEGER DEFAULT 0,
        last_full_sync_at TIMESTAMP,
        next_sync_due_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, site_url)
      );

      CREATE INDEX IF NOT EXISTS idx_bing_user_property_scheduler 
      ON bing_user_property(enabled, next_sync_due_at, priority_order, last_full_sync_at);

      CREATE TABLE IF NOT EXISTS bing_sync_lock (
        id TEXT PRIMARY KEY,
        locked_until TIMESTAMP NOT NULL,
        locked_by TEXT NOT NULL
      );
    `;

    await databaseService.prisma.$executeRawUnsafe(createTablesSQL);

    res.json({
      success: true,
      message: 'Bing scheduler tables created successfully'
    });
  } catch (error) {
    logger.error('Bing setup tables error:', error);
    res.status(500).json({ 
      error: 'Failed to create tables', 
      message: error.message 
    });
  }
});

module.exports = router;


