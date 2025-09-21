const cron = require('node-cron');
const axios = require('axios');
const databaseService = require('./src/services/database');
const logger = require('./src/utils/logger');

const BASE_URL = 'https://ssl.bing.com/webmaster/api.svc/json';
const API_KEY = process.env.BING_API_KEY;

async function fetchBingData(siteUrl, startDate, endDate) {
  const results = {};

  try {
    // Configure axios with proper authentication headers
    const config = {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    // Fetch totals
    logger.info(`Fetching totals for ${siteUrl} (${startDate} to ${endDate})`);
    const totalsUrl = `${BASE_URL}/GetSiteStats?siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`;
    const totalsResponse = await axios.get(totalsUrl, config);
    results.totals = totalsResponse.data.d || [];

    // Fetch queries
    logger.info(`Fetching queries for ${siteUrl}`);
    const queriesUrl = `${BASE_URL}/GetQueryStats?siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`;
    const queriesResponse = await axios.get(queriesUrl, config);
    results.queries = queriesResponse.data.d || [];

    // Fetch pages (handle 404 gracefully)
    logger.info(`Fetching pages for ${siteUrl}`);
    const pagesUrl = `${BASE_URL}/GetPageStats?siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`;
    try {
      const pagesResponse = await axios.get(pagesUrl, config);
      results.pages = pagesResponse.data.d || [];
    } catch (err) {
      if (err.response?.status === 404) {
        logger.warn(`No pages data available for ${siteUrl} (this is normal)`);
        results.pages = [];
      } else {
        throw err;
      }
    }

    return results;
  } catch (error) {
    logger.error(`Error fetching Bing data for ${siteUrl}:`, error.message);
    logger.error(`Error details:`, error.response?.data || error.message);
    throw error;
  }
}

async function storeBingData(siteUrl, startDate, endDate, data) {
  const searchType = 'web';
  let totalsProcessed = 0;
  let queriesProcessed = 0;
  let pagesProcessed = 0;

  try {
    // Store totals
    if (data.totals && data.totals.length > 0) {
      for (const record of data.totals) {
        await databaseService.prisma.bingTotalsDaily.upsert({
          where: {
            siteUrl_date_searchType: {
              siteUrl,
              date: new Date(record.Date),
              searchType
            }
          },
          update: {
            clicks: record.Clicks || 0,
            impressions: record.Impressions || 0,
            ctr: record.CTR || 0,
            position: record.Position || 0
          },
          create: {
            siteUrl,
            date: new Date(record.Date),
            searchType,
            clicks: record.Clicks || 0,
            impressions: record.Impressions || 0,
            ctr: record.CTR || 0,
            position: record.Position || 0
          }
        });
        totalsProcessed++;
      }
    }

    // Store queries
    if (data.queries && data.queries.length > 0) {
      for (const record of data.queries) {
        await databaseService.prisma.bingQueriesDaily.upsert({
          where: {
            siteUrl_date_searchType_query: {
              siteUrl,
              date: new Date(record.Date),
              searchType,
              query: record.Query || ''
            }
          },
          update: {
            clicks: record.Clicks || 0,
            impressions: record.Impressions || 0,
            ctr: record.CTR || 0,
            position: record.Position || 0
          },
          create: {
            siteUrl,
            date: new Date(record.Date),
            searchType,
            query: record.Query || '',
            clicks: record.Clicks || 0,
            impressions: record.Impressions || 0,
            ctr: record.CTR || 0,
            position: record.Position || 0
          }
        });
        queriesProcessed++;
      }
    }

    // Store pages
    if (data.pages && data.pages.length > 0) {
      for (const record of data.pages) {
        // Extract page URL from various possible fields
        const pageUrl = record.Query || record.Page || record.Url || record.PageUrl || '';

        await databaseService.prisma.bingPagesDaily.upsert({
          where: {
            siteUrl_date_searchType_page: {
              siteUrl,
              date: new Date(record.Date),
              searchType,
              page: pageUrl
            }
          },
          update: {
            clicks: record.Clicks || 0,
            impressions: record.Impressions || 0,
            ctr: record.CTR || 0,
            position: record.Position || 0
          },
          create: {
            siteUrl,
            date: new Date(record.Date),
            searchType,
            page: pageUrl,
            clicks: record.Clicks || 0,
            impressions: record.Impressions || 0,
            ctr: record.CTR || 0,
            position: record.Position || 0
          }
        });
        pagesProcessed++;
      }
    }

    return { totalsProcessed, queriesProcessed, pagesProcessed };

  } catch (error) {
    logger.error(`Error storing Bing data for ${siteUrl}:`, error.message);
    throw error;
  }
}

async function syncAllSites() {
  logger.info('Starting Bing sync for all sites');

  try {
    // Get all registered Bing sites
    const sites = await databaseService.prisma.$queryRaw`
      SELECT site_url FROM bing_user_property WHERE enabled = true
    `;

    const results = {};
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 2); // Last 2 days

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    for (const site of sites) {
      try {
        logger.info(`Syncing ${site.site_url}`);
        const data = await fetchBingData(site.site_url, startDateStr, endDateStr);
        const stored = await storeBingData(site.site_url, startDateStr, endDateStr, data);

        results[site.site_url] = {
          totals: stored.totalsProcessed,
          queries: stored.queriesProcessed,
          pages: stored.pagesProcessed,
          success: true
        };

        logger.info(`${site.site_url}: Totals: ${stored.totalsProcessed}, Queries: ${stored.queriesProcessed}, Pages: ${stored.pagesProcessed}`);

        // Small delay between sites
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        logger.error(`Failed to sync ${site.site_url}:`, error.message);
        results[site.site_url] = {
          success: false,
          error: error.message
        };
      }
    }

    logger.info('Bing sync completed');
    return results;

  } catch (error) {
    logger.error('Bing sync failed:', error);
    throw error;
  }
}

// Schedule to run every minute
cron.schedule('* * * * *', async () => {
  logger.info('Bing sync cron job triggered');
  try {
    await syncAllSites();
  } catch (error) {
    logger.error('Bing sync cron job failed:', error);
  }
});

logger.info('Bing sync scheduler started');

// Manual trigger for testing
async function manualSync() {
  logger.info('Manual Bing sync triggered');
  return await syncAllSites();
}

module.exports = {
  syncAllSites,
  manualSync,
  fetchBingData,
  storeBingData
};
