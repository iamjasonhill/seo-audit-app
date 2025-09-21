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
    const { searchType = 'web', monthsBack = 24, staggerDelay = 30000 } = req.body; // Default to 2 years of data, 30s delay between sites
    
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
    
    // Process each site with stagger delay to avoid overwhelming the API
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      try {
        logger.info(`Backfilling data for ${site.siteUrl} (${i + 1}/${sites.length})`);
        const result = await bingIngest.backfillSite(site.siteUrl, searchType, monthsBack);
        results.push({
          siteUrl: site.siteUrl,
          success: true,
          result
        });
        
        // Add delay between sites (except for the last one)
        if (i < sites.length - 1) {
          logger.info(`Waiting ${staggerDelay}ms before processing next site...`);
          await new Promise(resolve => setTimeout(resolve, staggerDelay));
        }
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

// POST /api/bing/complete-setup - Complete setup: backfill all sites and add to scheduler
router.post('/complete-setup', requireAuth, async (req, res) => {
  try {
    logger.info('Complete setup request received', { userId: req.user?.id, role: req.user?.role });
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { monthsBack = 24, staggerDelay = 30000, syncIntervalHours = 24 } = req.body;
    
    logger.info(`Starting complete Bing setup: backfill + scheduler setup`);
    
    // Step 1: Get all available sites from Bing
    const apiKey = process.env.BING_API_KEY || '';
    const bingApi = new BingApiClient(apiKey);
    const sites = await bingApi.getUserSites();
    
    if (!sites || sites.length === 0) {
      return res.status(400).json({ 
        error: 'No sites found in Bing Webmaster Tools' 
      });
    }

    const results = {
      backfill: [],
      scheduler: []
    };
    
    // Step 2: Backfill all sites
    logger.info(`Step 1: Backfilling ${sites.length} sites with ${monthsBack} months of data`);
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      try {
        logger.info(`Backfilling data for ${site.siteUrl} (${i + 1}/${sites.length})`);
        const result = await bingIngest.backfillSite(site.siteUrl, 'web', monthsBack);
        results.backfill.push({
          siteUrl: site.siteUrl,
          success: true,
          result
        });
        
        // Add delay between sites (except for the last one)
        if (i < sites.length - 1) {
          logger.info(`Waiting ${staggerDelay}ms before processing next site...`);
          await new Promise(resolve => setTimeout(resolve, staggerDelay));
        }
      } catch (error) {
        logger.error(`Backfill failed for ${site.siteUrl}:`, error);
        results.backfill.push({
          siteUrl: site.siteUrl,
          success: false,
          error: error.message
        });
      }
    }
    
    // Step 3: Add all sites to scheduler with staggered start times
    logger.info(`Step 2: Adding ${sites.length} sites to scheduler`);
    const staggerMinutes = 5; // 5 minutes between each site's first sync
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      try {
        const priorityOrder = i;
        const nextSyncDueAt = new Date(Date.now() + (i * staggerMinutes * 60 * 1000));
        
        await bingScheduler.addProperty(req.user.id, site.siteUrl, syncIntervalHours, priorityOrder, nextSyncDueAt);
        results.scheduler.push({
          siteUrl: site.siteUrl,
          success: true,
          priorityOrder,
          nextSyncDueAt: nextSyncDueAt.toISOString()
        });
        
        logger.info(`Added ${site.siteUrl} to scheduler (priority ${priorityOrder}, next sync: ${nextSyncDueAt.toISOString()})`);
      } catch (error) {
        logger.error(`Failed to add ${site.siteUrl} to scheduler:`, error);
        results.scheduler.push({
          siteUrl: site.siteUrl,
          success: false,
          error: error.message
        });
      }
    }
    
    const backfillSuccessCount = results.backfill.filter(r => r.success).length;
    const backfillFailureCount = results.backfill.filter(r => !r.success).length;
    const schedulerSuccessCount = results.scheduler.filter(r => r.success).length;
    const schedulerFailureCount = results.scheduler.filter(r => !r.success).length;
    
    res.json({
      success: true,
      message: `Complete setup finished: Backfill ${backfillSuccessCount}/${sites.length} successful, Scheduler ${schedulerSuccessCount}/${sites.length} successful`,
      summary: {
        totalSites: sites.length,
        backfill: {
          successful: backfillSuccessCount,
          failed: backfillFailureCount
        },
        scheduler: {
          successful: schedulerSuccessCount,
          failed: schedulerFailureCount
        }
      },
      results
    });
  } catch (error) {
    logger.error('Complete Bing setup error:', error);
    res.status(500).json({ 
      error: 'Complete setup failed', 
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

// POST /api/bing/sync/discover - Discover and register all available Bing domains
router.post('/sync/discover', requireAuth, async (req, res) => {
  try {
    logger.info(`Bing domain discovery requested by user ${req.user.id}`);
    const registeredSites = await bingScheduler.discoverAndRegisterDomains(req.user.id);
    
    res.json({
      success: true,
      message: `Discovered and registered ${registeredSites.length} Bing domains`,
      registeredSites
    });
  } catch (err) {
    logger.error('Bing domain discovery error:', err.message);
    logger.error('Full error:', err);
    
    // Provide more specific error messages
    let errorMessage = err.message;
    if (err.message.includes('No Bing API key')) {
      errorMessage = 'Bing API key not configured. Please add your Bing Webmaster Tools API key to the environment variables.';
    } else if (err.message.includes('API key')) {
      errorMessage = 'Invalid or expired Bing API key. Please check your API key configuration.';
    }
    
    res.status(500).json({ 
      error: 'BingDiscoveryError', 
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// GET /api/bing/sync/properties - Get all registered Bing properties
router.get('/sync/properties', requireAuth, async (req, res) => {
  try {
    // Check if user is admin
    const me = await databaseService.prisma.user.findUnique({ where: { id: req.user.id } });
    const isAdmin = me && me.role === 'admin';
    
    const properties = await bingScheduler.getRegisteredProperties(req.user.id, isAdmin);
    
    res.json({
      success: true,
      properties,
      isAdmin
    });
  } catch (err) {
    logger.error('Bing sync properties error:', err.message);
    res.status(500).json({ error: 'BingSyncPropertiesError', message: err.message });
  }
});

// POST /api/bing/sync/register - Register a specific domain for syncing
router.post('/sync/register', requireAuth, async (req, res) => {
  try {
    const { siteUrl, syncIntervalHours = 24, priorityOrder = 0 } = req.body;
    
    if (!siteUrl) {
      return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });
    }
    
    await bingScheduler.addProperty(req.user.id, siteUrl, {
      syncIntervalHours,
      priorityOrder
    });
    
    res.json({
      success: true,
      message: `Registered ${siteUrl} for Bing syncing`
    });
  } catch (err) {
    logger.error('Bing sync register error:', err.message);
    res.status(500).json({ error: 'BingSyncRegisterError', message: err.message });
  }
});

// DELETE /api/bing/sync/unregister - Unregister a domain from syncing
router.delete('/sync/unregister', requireAuth, async (req, res) => {
  try {
    const { siteUrl } = req.body;
    
    if (!siteUrl) {
      return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });
    }
    
    await bingScheduler.removeProperty(req.user.id, siteUrl);
    
    res.json({
      success: true,
      message: `Unregistered ${siteUrl} from Bing syncing`
    });
  } catch (err) {
    logger.error('Bing sync unregister error:', err.message);
    res.status(500).json({ error: 'BingSyncUnregisterError', message: err.message });
  }
});

// GET /api/bing/sync/simple - Simple Bing sync (for cron jobs and manual testing)
router.get('/sync/simple', async (req, res) => {
  try {
    // Allow both cron jobs (no auth) and authenticated requests
    const isCronJob = req.headers['x-vercel-cron'] === 'true' ||
                      req.headers['user-agent']?.includes('vercel-cron');

    // If it's not a cron job and no auth, require authentication
    if (!isCronJob && !req.headers.authorization) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Import and run the simple sync
    const { syncAllSites } = require('../../bing_sync_simple');
    const results = await syncAllSites();

    res.json({ success: true, message: 'Simple Bing sync completed', results });
  } catch (err) {
    logger.error('Simple Bing sync error:', err.message);
    res.status(500).json({ error: 'SimpleBingSyncError', message: err.message });
  }
});

// GET /api/bing/scheduler/tick - Manual scheduler tick (for testing and cron jobs)
router.get('/scheduler/tick', async (req, res) => {
  try {
    // Allow both cron jobs (no auth) and authenticated requests
    const isCronJob = req.headers['x-vercel-cron'] === 'true' ||
                      req.headers['user-agent']?.includes('vercel-cron');

    // If it's not a cron job and no auth, require authentication
    if (!isCronJob && !req.headers.authorization) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await bingScheduler.tick();
    res.json({ success: true, message: 'Bing scheduler tick executed' });
  } catch (err) {
    logger.error('Bing scheduler tick error:', err.message);
    res.status(500).json({ error: 'BingSchedulerTickError', message: err.message });
  }
});

// GET /api/bing/test-api - Test Bing API connection and get sites
router.get('/test-api', requireAuth, async (req, res) => {
  try {
    const { BingApiClient } = require('../services/bingApi');
    
    // Get API key from user's stored key or environment
    const apiKeyRow = await databaseService.prisma.bingApiKey.findUnique({ where: { userId: req.user.id } });
    const apiKey = apiKeyRow?.apiKey || process.env.BING_API_KEY;
    
    if (!apiKey) {
      return res.status(400).json({ 
        error: 'No API Key', 
        message: 'No Bing API key found. Please configure your Bing Webmaster Tools API key.' 
      });
    }
    
    const bingApi = new BingApiClient(apiKey);
    const sites = await bingApi.getUserSites();
    
    res.json({
      success: true,
      message: `Found ${sites.length} sites`,
      apiKeyConfigured: !!apiKey,
      sites: sites,
      rawResponse: sites
    });
  } catch (err) {
    logger.error('Bing API test error:', err.message);
    res.status(500).json({ error: 'BingApiTestError', message: err.message });
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

// GET /api/bing/monitor/status - Get Bing data status (quick view)
router.get('/monitor/status', requireAuth, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    let output = '';
    output += '🔍 BING DATA STATUS - ' + new Date().toLocaleString() + '\n';
    output += '='.repeat(50) + '\n';
    
    // Quick summary
    const totalTotals = await prisma.bingTotalsDaily.count();
    const totalQueries = await prisma.bingQueriesDaily.count();
    const totalPages = await prisma.bingPagesDaily.count();
    
    output += `📊 Records: ${totalTotals} totals, ${totalQueries} queries, ${totalPages} pages\n`;
    
    if (totalTotals === 0) {
      output += '❌ No data collected yet\n';
      output += '💡 Register properties and start data collection\n';
    } else {
      // Get properties with data
      const properties = await prisma.$queryRaw`
        SELECT 
          site_url,
          COUNT(DISTINCT date) as days,
          MIN(date) as earliest,
          MAX(date) as latest,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions
        FROM bing_totals_daily 
        GROUP BY site_url 
        ORDER BY days DESC
      `;
      
      output += `\n🌐 Properties (${properties.length}):\n`;
      for (let i = 0; i < properties.length; i++) {
        const prop = properties[i];
        const daysAgo = Math.floor((new Date() - new Date(prop.latest)) / (1000 * 60 * 60 * 24));
        const freshness = daysAgo <= 2 ? '✅' : daysAgo <= 7 ? '⚠️' : '❌';
        
        output += `${i + 1}. ${prop.site_url}\n`;
        output += `   📅 ${prop.earliest.toISOString().split('T')[0]} to ${prop.latest.toISOString().split('T')[0]} (${prop.days} days)\n`;
        output += `   📈 ${prop.clicks.toLocaleString()} clicks, ${prop.impressions.toLocaleString()} impressions\n`;
        
        // Get queries and pages counts for this property
        const queriesCount = await prisma.bingQueriesDaily.count({
          where: { siteUrl: prop.site_url }
        });
        const pagesCount = await prisma.bingPagesDaily.count({
          where: { siteUrl: prop.site_url }
        });
        
        output += `   🔍 Queries: ${queriesCount.toLocaleString()}, 📄 Pages: ${pagesCount.toLocaleString()}\n`;
        output += `   ${freshness} ${daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : daysAgo + ' days ago'}\n`;
      }
      
      // Data growth check
      const recentData = await prisma.bingTotalsDaily.findMany({
        where: {
          date: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        },
        orderBy: { date: 'desc' },
        take: 5
      });
      
      if (recentData.length > 0) {
        output += `\n📈 Recent Activity (last 7 days):\n`;
        recentData.forEach(record => {
          output += `   ${record.date.toISOString().split('T')[0]}: ${record.siteUrl} - ${record.clicks} clicks\n`;
        });
      } else {
        output += `\n⚠️  No recent activity (last 7 days)\n`;
      }
    }
    
    await prisma.$disconnect();
    
    res.json({
      success: true,
      output: output
    });
  } catch (error) {
    logger.error('Bing monitor status error:', error);
    res.status(500).json({ 
      error: 'BingMonitorStatusError', 
      message: error.message 
    });
  }
});

// GET /api/bing/monitor/dashboard - Get detailed Bing dashboard
router.get('/monitor/dashboard', requireAuth, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    let output = '';
    output += '🔍 BING WEBMASTER TOOLS DATA DASHBOARD\n';
    output += '='.repeat(60) + '\n';
    output += `📅 Generated: ${new Date().toLocaleString()}\n\n`;
    
    // Get all Bing properties with data
    output += '📊 BING PROPERTIES WITH DATA:\n';
    output += '-'.repeat(60) + '\n';
    
    const propertiesWithData = await prisma.$queryRaw`
      SELECT 
        site_url,
        COUNT(DISTINCT date) as total_days,
        MIN(date) as earliest_date,
        MAX(date) as latest_date,
        SUM(clicks) as total_clicks,
        SUM(impressions) as total_impressions,
        AVG(ctr) as avg_ctr,
        AVG(position) as avg_position
      FROM bing_totals_daily 
      GROUP BY site_url 
      ORDER BY total_days DESC, total_clicks DESC
    `;
    
    if (propertiesWithData.length === 0) {
      output += '❌ No Bing properties found with data\n';
      output += '💡 Properties need to be registered and data collection started\n\n';
    } else {
      for (let index = 0; index < propertiesWithData.length; index++) {
        const prop = propertiesWithData[index];
        output += `${index + 1}. 🌐 ${prop.site_url}\n`;
        output += `   📅 Date Range: ${prop.earliest_date.toISOString().split('T')[0]} to ${prop.latest_date.toISOString().split('T')[0]}\n`;
        output += `   📊 Total Days: ${prop.total_days}\n`;
        output += `   📈 Total Clicks: ${prop.total_clicks.toLocaleString()}\n`;
        output += `   👁️  Total Impressions: ${prop.total_impressions.toLocaleString()}\n`;
        output += `   📊 Avg CTR: ${(prop.avg_ctr * 100).toFixed(2)}%\n`;
        output += `   🎯 Avg Position: ${prop.avg_position.toFixed(1)}\n`;
        
        // Get queries and pages counts for this property
        const queriesCount = await prisma.bingQueriesDaily.count({
          where: { siteUrl: prop.site_url }
        });
        const pagesCount = await prisma.bingPagesDaily.count({
          where: { siteUrl: prop.site_url }
        });
        
        output += `   🔍 Total Queries: ${queriesCount.toLocaleString()}\n`;
        output += `   📄 Total Pages: ${pagesCount.toLocaleString()}\n\n`;
      }
    }
    
    // Summary statistics
    output += '📊 OVERALL SUMMARY:\n';
    output += '='.repeat(60) + '\n';
    
    const totalTotals = await prisma.bingTotalsDaily.count();
    const totalQueries = await prisma.bingQueriesDaily.count();
    const totalPages = await prisma.bingPagesDaily.count();
    const totalSyncStatus = await prisma.bingSyncStatus.count();
    
    output += `📈 Total Records:\n`;
    output += `   📊 Totals: ${totalTotals.toLocaleString()}\n`;
    output += `   🔍 Queries: ${totalQueries.toLocaleString()}\n`;
    output += `   📄 Pages: ${totalPages.toLocaleString()}\n`;
    output += `   📊 Sync Status: ${totalSyncStatus.toLocaleString()}\n`;
    
    // Check registered properties
    try {
      const registeredProperties = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM bing_user_property
      `;
      output += `\n🏢 Registered Properties: ${registeredProperties[0].count}\n`;
    } catch (error) {
      output += `\n🏢 Registered Properties: ❌ Table not accessible\n`;
    }
    
    // Check API keys
    try {
      const apiKeys = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM bing_api_key
      `;
      output += `🔑 API Keys Configured: ${apiKeys[0].count}\n`;
    } catch (error) {
      output += `🔑 API Keys Configured: ❌ Table not accessible\n`;
    }
    
    // Data growth indicators
    if (totalTotals > 0) {
      output += `\n📈 DATA GROWTH INDICATORS:\n`;
      
      // Check if data is recent
      const recentData = await prisma.bingTotalsDaily.findMany({
        where: {
          date: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
          }
        },
        orderBy: { date: 'desc' },
        take: 1
      });
      
      if (recentData.length > 0) {
        output += `✅ Recent Activity: Data from ${recentData[0].date.toISOString().split('T')[0]}\n`;
      } else {
        output += `⚠️  No Recent Activity: No data in last 7 days\n`;
      }
      
      // Check data completeness
      const allDates = await prisma.$queryRaw`
        SELECT DISTINCT date FROM bing_totals_daily ORDER BY date DESC LIMIT 10
      `;
      
      if (allDates.length > 0) {
        output += `📅 Latest Data Dates:\n`;
        allDates.forEach((record, index) => {
          output += `   ${index + 1}. ${record.date.toISOString().split('T')[0]}\n`;
        });
      }
    }
    
    output += '\n' + '='.repeat(60) + '\n';
    output += '💡 TIP: Run this monitor regularly to track data growth!\n';
    
    await prisma.$disconnect();
    
    res.json({
      success: true,
      output: output
    });
  } catch (error) {
    logger.error('Bing monitor dashboard error:', error);
    res.status(500).json({ 
      error: 'BingMonitorDashboardError', 
      message: error.message 
    });
  }
});

module.exports = router;


