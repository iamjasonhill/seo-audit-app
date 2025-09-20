const { BingApiClient } = require('./bingApi');
const databaseService = require('./database');
const logger = require('../utils/logger');

/**
 * Bing Webmaster Tools data ingestion service
 * Handles syncing and backfilling Bing search performance data
 */
class BingIngestService {
  constructor() {
    this.apiKey = process.env.BING_API_KEY;
    if (!this.apiKey) {
      logger.warn('BingIngestService: No BING_API_KEY found in environment');
    }
  }

  /**
   * Get or create sync status record
   */
  async getSyncStatus(siteUrl, searchType, dimension) {
    try {
      let status = await databaseService.prisma.bingSyncStatus.findFirst({
        where: { siteUrl, searchType, dimension }
      });

      if (!status) {
        status = await databaseService.prisma.bingSyncStatus.create({
          data: { siteUrl, searchType, dimension, status: 'pending' }
        });
      }

      return status;
    } catch (error) {
      logger.error('Error getting Bing sync status:', error);
      throw error;
    }
  }

  /**
   * Update sync status
   */
  async updateSyncStatus(siteUrl, searchType, dimension, status, message = null, lastSyncedDate = null) {
    try {
      await databaseService.prisma.bingSyncStatus.upsert({
        where: {
          siteUrl_searchType_dimension: {
            siteUrl,
            searchType,
            dimension
          }
        },
        update: {
          status,
          message,
          lastSyncedDate,
          lastRunAt: new Date()
        },
        create: {
          siteUrl,
          searchType,
          dimension,
          status,
          message,
          lastSyncedDate,
          lastRunAt: new Date()
        }
      });
    } catch (error) {
      logger.error('Error updating Bing sync status:', error);
      throw error;
    }
  }

  /**
   * Sync daily totals for a site
   */
  async syncDailyTotals(siteUrl, searchType = 'web', daysBack = 30) {
    const dimension = 'totals';
    logger.info(`Starting Bing daily totals sync for ${siteUrl} (${searchType})`);

    try {
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'running');

      const client = new BingApiClient(this.apiKey);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - daysBack);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      logger.info(`Fetching Bing data from ${startDateStr} to ${endDateStr}`);

      // Get daily totals from Bing API
      const dailyData = await client.getDailyTotals(siteUrl, startDateStr, endDateStr, searchType);
      
      logger.info(`Bing API response for ${siteUrl}:`, JSON.stringify(dailyData, null, 2));
      
      if (!dailyData || dailyData.length === 0) {
        logger.warn(`No Bing data found for ${siteUrl}`);
        await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', 'No data available');
        return { success: true, recordsProcessed: 0 };
      }

      let recordsProcessed = 0;

      // Process and store each day's data
      for (const dayData of dailyData) {
        try {
          // Handle different date formats from Bing API
          let date;
          const dateValue = dayData.Date || dayData.date || dayData.DateKey || dayData.dateKey;
          if (dateValue) {
            // Try different date parsing approaches
            if (typeof dateValue === 'string') {
              // Handle Microsoft /Date(timestamp)/ format
              if (dateValue.startsWith('/Date(') && dateValue.endsWith(')/')) {
                const timestamp = dateValue.match(/\/Date\((\d+)/);
                if (timestamp) {
                  date = new Date(parseInt(timestamp[1]));
                }
              }
              // Handle YYYY-MM-DD format
              else if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                date = new Date(dateValue + 'T00:00:00.000Z');
              } else {
                date = new Date(dateValue);
              }
            } else {
              date = new Date(dateValue);
            }
          }
          
          // Validate date
          if (!date || isNaN(date.getTime())) {
            logger.warn(`Invalid date for dayData:`, dayData);
            continue;
          }
          
          const clicks = parseInt(dayData.Clicks || dayData.clicks || 0);
          const impressions = parseInt(dayData.Impressions || dayData.impressions || 0);
          const ctr = parseFloat(dayData.CTR || dayData.ctr || 0);
          const position = parseFloat(dayData.Position || dayData.position || 0);

          await databaseService.prisma.bingTotalsDaily.upsert({
            where: {
              siteUrl_date_searchType: {
                siteUrl,
                date,
                searchType
              }
            },
            update: {
              clicks,
              impressions,
              ctr,
              position
            },
            create: {
              siteUrl,
              date,
              searchType,
              clicks,
              impressions,
              ctr,
              position
            }
          });

          recordsProcessed++;
        } catch (error) {
          logger.error(`Error processing day data for ${siteUrl}:`, error);
        }
      }

      await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', null, endDate);
      logger.info(`Bing daily totals sync completed for ${siteUrl}: ${recordsProcessed} records`);

      return { success: true, recordsProcessed };

    } catch (error) {
      logger.error(`Bing daily totals sync failed for ${siteUrl}:`, error);
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'error', error.message);
      throw error;
    }
  }

  /**
   * Sync query data for a site
   */
  async syncQueryData(siteUrl, searchType = 'web', daysBack = 7) {
    const dimension = 'query';
    logger.info(`Starting Bing query data sync for ${siteUrl} (${searchType})`);

    try {
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'running');

      const client = new BingApiClient(this.apiKey);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - daysBack);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Get query data from Bing API
      const queryData = await client.getQueryStats(siteUrl, startDateStr, endDateStr, searchType, 1000);
      
      if (!queryData || queryData.length === 0) {
        logger.warn(`No Bing query data found for ${siteUrl}`);
        await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', 'No data available');
        return { success: true, recordsProcessed: 0 };
      }

      let recordsProcessed = 0;

      // Process and store query data
      for (const query of queryData) {
        try {
          // Handle different date formats from Bing API
          let date;
          const dateValue = query.Date || query.date || query.DateKey || query.dateKey;
          if (dateValue) {
            if (typeof dateValue === 'string') {
              // Handle Microsoft /Date(timestamp)/ format
              if (dateValue.startsWith('/Date(') && dateValue.endsWith(')/')) {
                const timestamp = dateValue.match(/\/Date\((\d+)/);
                if (timestamp) {
                  date = new Date(parseInt(timestamp[1]));
                }
              }
              // Handle YYYY-MM-DD format
              else if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                date = new Date(dateValue + 'T00:00:00.000Z');
              } else {
                date = new Date(dateValue);
              }
            } else {
              date = new Date(dateValue);
            }
          }
          
          // Validate date
          if (!date || isNaN(date.getTime())) {
            logger.warn(`Invalid date for query:`, query);
            continue;
          }
          
          const queryText = query.Query || query.query || '';
          const clicks = parseInt(query.Clicks || query.clicks || 0);
          const impressions = parseInt(query.Impressions || query.impressions || 0);
          const ctr = parseFloat(query.CTR || query.ctr || 0);
          const position = parseFloat(query.Position || query.position || 0);

          if (queryText && clicks > 0) { // Only store queries with actual clicks
            await databaseService.prisma.bingQueriesDaily.upsert({
              where: {
                siteUrl_date_searchType_query: {
                  siteUrl,
                  date,
                  searchType,
                  query: queryText
                }
              },
              update: {
                clicks,
                impressions,
                ctr,
                position
              },
              create: {
                siteUrl,
                date,
                searchType,
                query: queryText,
                clicks,
                impressions,
                ctr,
                position
              }
            });

            recordsProcessed++;
          }
        } catch (error) {
          logger.error(`Error processing query data for ${siteUrl}:`, error);
        }
      }

      await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', null, endDate);
      logger.info(`Bing query data sync completed for ${siteUrl}: ${recordsProcessed} records`);

      return { success: true, recordsProcessed };

    } catch (error) {
      logger.error(`Bing query data sync failed for ${siteUrl}:`, error);
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'error', error.message);
      throw error;
    }
  }

  /**
   * Sync page data for a site
   */
  async syncPageData(siteUrl, searchType = 'web', daysBack = 7) {
    const dimension = 'page';
    logger.info(`Starting Bing page data sync for ${siteUrl} (${searchType})`);

    try {
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'running');

      const client = new BingApiClient(this.apiKey);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - daysBack);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Get page data from Bing API
      const pageData = await client.getPageStats(siteUrl, startDateStr, endDateStr, searchType, 1000);
      
      if (!pageData || pageData.length === 0) {
        logger.warn(`No Bing page data found for ${siteUrl}`);
        await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', 'No data available');
        return { success: true, recordsProcessed: 0 };
      }

      let recordsProcessed = 0;

      // Process and store page data
      for (const page of pageData) {
        try {
          // Handle different date formats from Bing API
          let date;
          const dateValue = page.Date || page.date || page.DateKey || page.dateKey;
          if (dateValue) {
            if (typeof dateValue === 'string') {
              // Handle Microsoft /Date(timestamp)/ format
              if (dateValue.startsWith('/Date(') && dateValue.endsWith(')/')) {
                const timestamp = dateValue.match(/\/Date\((\d+)/);
                if (timestamp) {
                  date = new Date(parseInt(timestamp[1]));
                }
              }
              // Handle YYYY-MM-DD format
              else if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                date = new Date(dateValue + 'T00:00:00.000Z');
              } else {
                date = new Date(dateValue);
              }
            } else {
              date = new Date(dateValue);
            }
          }
          
          // Validate date
          if (!date || isNaN(date.getTime())) {
            logger.warn(`Invalid date for page:`, page);
            continue;
          }
          
          const pageUrl = page.Page || page.page || '';
          const clicks = parseInt(page.Clicks || page.clicks || 0);
          const impressions = parseInt(page.Impressions || page.impressions || 0);
          const ctr = parseFloat(page.CTR || page.ctr || 0);
          const position = parseFloat(page.Position || page.position || 0);

          if (pageUrl && clicks > 0) { // Only store pages with actual clicks
            await databaseService.prisma.bingPagesDaily.upsert({
              where: {
                siteUrl_date_searchType_page: {
                  siteUrl,
                  date,
                  searchType,
                  page: pageUrl
                }
              },
              update: {
                clicks,
                impressions,
                ctr,
                position
              },
              create: {
                siteUrl,
                date,
                searchType,
                page: pageUrl,
                clicks,
                impressions,
                ctr,
                position
              }
            });

            recordsProcessed++;
          }
        } catch (error) {
          logger.error(`Error processing page data for ${siteUrl}:`, error);
        }
      }

      await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', null, endDate);
      logger.info(`Bing page data sync completed for ${siteUrl}: ${recordsProcessed} records`);

      return { success: true, recordsProcessed };

    } catch (error) {
      logger.error(`Bing page data sync failed for ${siteUrl}:`, error);
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'error', error.message);
      throw error;
    }
  }

  /**
   * Full sync for a site (all data types)
   */
  async syncSite(siteUrl, searchType = 'web', options = {}) {
    const { 
      daysBack = 30, 
      includeQueries = true, 
      includePages = true,
      includeTotals = true 
    } = options;

    logger.info(`Starting full Bing sync for ${siteUrl}`);

    const results = {
      totals: null,
      queries: null,
      pages: null
    };

    try {
      if (includeTotals) {
        results.totals = await this.syncDailyTotals(siteUrl, searchType, daysBack);
      }

      if (includeQueries) {
        results.queries = await this.syncQueryData(siteUrl, searchType, Math.min(daysBack, 7));
      }

      if (includePages) {
        results.pages = await this.syncPageData(siteUrl, searchType, Math.min(daysBack, 7));
      }

      logger.info(`Bing sync completed for ${siteUrl}:`, results);
      return { success: true, results };

    } catch (error) {
      logger.error(`Bing sync failed for ${siteUrl}:`, error);
      throw error;
    }
  }

  /**
   * Backfill historical data for a site
   */
  async backfillSite(siteUrl, searchType = 'web', monthsBack = 6) {
    logger.info(`Starting Bing backfill for ${siteUrl} (${monthsBack} months)`);

    try {
      const results = await this.syncSite(siteUrl, searchType, {
        daysBack: monthsBack * 30,
        includeQueries: false, // Limit queries to recent data only
        includePages: false,   // Limit pages to recent data only
        includeTotals: true    // Backfill totals for full period
      });

      logger.info(`Bing backfill completed for ${siteUrl}`);
      return results;

    } catch (error) {
      logger.error(`Bing backfill failed for ${siteUrl}:`, error);
      throw error;
    }
  }
}

module.exports = new BingIngestService();
