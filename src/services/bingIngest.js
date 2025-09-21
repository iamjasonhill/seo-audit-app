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
  async syncDailyTotals(siteUrl, searchType = 'web', daysBack = 30, startDateParam = null, endDateParam = null) {
    const dimension = 'totals';
    logger.info(`Starting Bing daily totals sync for ${siteUrl} (${searchType})`);

    try {
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'running');

      const client = new BingApiClient(this.apiKey);
      
      let startDate, endDate;
      if (startDateParam && endDateParam) {
        startDate = new Date(startDateParam);
        endDate = new Date(endDateParam);
      } else {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(endDate.getDate() - daysBack);
      }

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      logger.info(`Fetching Bing data from ${startDateStr} to ${endDateStr}`);

      // Get daily totals from Bing API with timeout
      const apiPromise = client.getDailyTotals(siteUrl, startDateStr, endDateStr, searchType);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API timeout after 2 minutes')), 2 * 60 * 1000);
      });
      const dailyData = await Promise.race([apiPromise, timeoutPromise]);
      
      logger.info(`Bing API response for ${siteUrl}:`, JSON.stringify(dailyData, null, 2));
      
      if (!dailyData || dailyData.length === 0) {
        logger.warn(`No Bing data found for ${siteUrl}`);
        await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', 'No data available');
        return { success: true, recordsProcessed: 0 };
      }

      let recordsProcessed = 0;
      const batchSize = 50; // Process in batches to avoid memory issues
      const recordsToInsert = [];

      // Process and prepare each day's data for batch insertion
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

          recordsToInsert.push({
            siteUrl,
            date,
            searchType,
            clicks,
            impressions,
            ctr,
            position
          });

        } catch (error) {
          logger.error(`Error processing day data for ${siteUrl}:`, error);
        }
      }

      // Process records in batches
      for (let i = 0; i < recordsToInsert.length; i += batchSize) {
        const batch = recordsToInsert.slice(i, i + batchSize);
        
        try {
          // Use createMany with skipDuplicates for better performance
          await databaseService.prisma.bingTotalsDaily.createMany({
            data: batch,
            skipDuplicates: true
          });
          
          recordsProcessed += batch.length;
          logger.info(`Bing totals: Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(recordsToInsert.length/batchSize)} (${batch.length} records)`);
          
          // Add small delay between batches to avoid overwhelming the database
          if (i + batchSize < recordsToInsert.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
        } catch (error) {
          logger.error(`Error inserting batch for ${siteUrl}:`, error);
          // Fall back to individual upserts for this batch
          for (const record of batch) {
            try {
              await databaseService.prisma.bingTotalsDaily.upsert({
                where: {
                  siteUrl_date_searchType: {
                    siteUrl: record.siteUrl,
                    date: record.date,
                    searchType: record.searchType
                  }
                },
                update: {
                  clicks: record.clicks,
                  impressions: record.impressions,
                  ctr: record.ctr,
                  position: record.position
                },
                create: record
              });
              recordsProcessed++;
            } catch (upsertError) {
              logger.error(`Error upserting individual record for ${siteUrl}:`, upsertError);
            }
          }
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
  async syncQueryData(siteUrl, searchType = 'web', daysBack = 7, startDateParam = null, endDateParam = null) {
    const dimension = 'query';
    logger.info(`Starting Bing query data sync for ${siteUrl} (${searchType})`);

    try {
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'running');

      const client = new BingApiClient(this.apiKey);
      
      let startDate, endDate;
      if (startDateParam && endDateParam) {
        startDate = new Date(startDateParam);
        endDate = new Date(endDateParam);
      } else {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(endDate.getDate() - daysBack);
      }

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Get query data from Bing API with timeout
      const apiPromise = client.getQueryStats(siteUrl, startDateStr, endDateStr, searchType, 1000);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API timeout after 2 minutes')), 2 * 60 * 1000);
      });
      const queryData = await Promise.race([apiPromise, timeoutPromise]);
      
      if (!queryData || queryData.length === 0) {
        logger.warn(`No Bing query data found for ${siteUrl}`);
        await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', 'No data available');
        return { success: true, recordsProcessed: 0 };
      }

      let recordsProcessed = 0;
      const batchSize = 50; // Process in batches to avoid memory issues
      const recordsToInsert = [];

      // Process and prepare query data for batch insertion
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

          if (queryText) { // Store all queries with text, regardless of clicks
            recordsToInsert.push({
              siteUrl,
              date,
              searchType,
              query: queryText,
              clicks,
              impressions,
              ctr,
              position
            });
          }
        } catch (error) {
          logger.error(`Error processing query data for ${siteUrl}:`, error);
        }
      }

      // Process records in batches
      for (let i = 0; i < recordsToInsert.length; i += batchSize) {
        const batch = recordsToInsert.slice(i, i + batchSize);
        
        try {
          // Use createMany with skipDuplicates for better performance
          await databaseService.prisma.bingQueriesDaily.createMany({
            data: batch,
            skipDuplicates: true
          });
          
          recordsProcessed += batch.length;
          logger.info(`Bing queries: Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(recordsToInsert.length/batchSize)} (${batch.length} records)`);
          
          // Add small delay between batches to avoid overwhelming the database
          if (i + batchSize < recordsToInsert.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
        } catch (error) {
          logger.error(`Error inserting query batch for ${siteUrl}:`, error);
          // Fall back to individual upserts for this batch
          for (const record of batch) {
            try {
              await databaseService.prisma.bingQueriesDaily.upsert({
                where: {
                  siteUrl_date_searchType_query: {
                    siteUrl: record.siteUrl,
                    date: record.date,
                    searchType: record.searchType,
                    query: record.query
                  }
                },
                update: {
                  clicks: record.clicks,
                  impressions: record.impressions,
                  ctr: record.ctr,
                  position: record.position
                },
                create: record
              });
              recordsProcessed++;
            } catch (upsertError) {
              logger.error(`Error upserting individual query record for ${siteUrl}:`, upsertError);
            }
          }
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
  async syncPageData(siteUrl, searchType = 'web', daysBack = 7, startDateParam = null, endDateParam = null) {
    const dimension = 'page';
    logger.info(`Starting Bing page data sync for ${siteUrl} (${searchType})`);

    try {
      await this.updateSyncStatus(siteUrl, searchType, dimension, 'running');

      const client = new BingApiClient(this.apiKey);
      
      let startDate, endDate;
      if (startDateParam && endDateParam) {
        startDate = new Date(startDateParam);
        endDate = new Date(endDateParam);
      } else {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(endDate.getDate() - daysBack);
      }

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Get page data from Bing API with timeout
      const apiPromise = client.getPageStats(siteUrl, startDateStr, endDateStr, searchType, 1000);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API timeout after 2 minutes')), 2 * 60 * 1000);
      });
      const pageData = await Promise.race([apiPromise, timeoutPromise]);
      
      if (!pageData || pageData.length === 0) {
        logger.info(`No Bing page data available for ${siteUrl} - this is normal for some sites`);
        logger.info(`Bing API returned empty pages data - pages data is optional and may not be available for all sites`);
        await this.updateSyncStatus(siteUrl, searchType, dimension, 'ok', 'Pages data not available (normal for some sites)');
        return { success: true, recordsProcessed: 0, message: 'Pages data not available' };
      }
      
      logger.info(`Bing API returned ${pageData.length} page records for ${siteUrl}`);

      let recordsProcessed = 0;
      const batchSize = 50; // Process in batches to avoid memory issues
      const recordsToInsert = [];

      // Process and prepare page data for batch insertion
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
          
          // Bing API returns pages data in Query field (contains page URL)
          const pageUrl = page.Query || page.query || page.Page || page.page || '';
          const clicks = parseInt(page.Clicks || page.clicks || 0);
          const impressions = parseInt(page.Impressions || page.impressions || 0);
          const ctr = parseFloat(page.CTR || page.ctr || page.AvgClickPosition || page.avgClickPosition || 0);
          const position = parseFloat(page.Position || page.position || page.AvgImpressionPosition || page.avgImpressionPosition || 0);

          if (pageUrl) { // Store all pages with URLs, regardless of clicks
            recordsToInsert.push({
              siteUrl,
              date,
              searchType,
              page: pageUrl,
              clicks,
              impressions,
              ctr,
              position
            });
          }
        } catch (error) {
          logger.error(`Error processing page data for ${siteUrl}:`, error);
        }
      }

      // Process records in batches
      for (let i = 0; i < recordsToInsert.length; i += batchSize) {
        const batch = recordsToInsert.slice(i, i + batchSize);
        
        try {
          // Use createMany with skipDuplicates for better performance
          await databaseService.prisma.bingPagesDaily.createMany({
            data: batch,
            skipDuplicates: true
          });
          
          recordsProcessed += batch.length;
          logger.info(`Bing pages: Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(recordsToInsert.length/batchSize)} (${batch.length} records)`);
          
          // Add small delay between batches to avoid overwhelming the database
          if (i + batchSize < recordsToInsert.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
        } catch (error) {
          logger.error(`Error inserting page batch for ${siteUrl}:`, error);
          // Fall back to individual upserts for this batch
          for (const record of batch) {
            try {
              await databaseService.prisma.bingPagesDaily.upsert({
                where: {
                  siteUrl_date_searchType_page: {
                    siteUrl: record.siteUrl,
                    date: record.date,
                    searchType: record.searchType,
                    page: record.page
                  }
                },
                update: {
                  clicks: record.clicks,
                  impressions: record.impressions,
                  ctr: record.ctr,
                  position: record.position
                },
                create: record
              });
              recordsProcessed++;
            } catch (upsertError) {
              logger.error(`Error upserting individual page record for ${siteUrl}:`, upsertError);
            }
          }
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
      startDate,
      endDate,
      includeQueries = true,
      includePages = true,
      includeTotals = true
    } = options;

    const results = {
      totals: null,
      queries: null,
      pages: null
    };

    logger.info(`Starting full Bing sync for ${siteUrl}`);

    try {
      if (includeTotals) {
        if (startDate && endDate) {
          results.totals = await this.syncDailyTotals(siteUrl, searchType, null, startDate, endDate);
        } else {
          results.totals = await this.syncDailyTotals(siteUrl, searchType, daysBack);
        }
      }

      if (includeQueries) {
        if (startDate && endDate) {
          results.queries = await this.syncQueryData(siteUrl, searchType, null, startDate, endDate);
        } else {
          results.queries = await this.syncQueryData(siteUrl, searchType, Math.min(daysBack, 7));
        }
      }

      if (includePages) {
        try {
          if (startDate && endDate) {
            results.pages = await this.syncPageData(siteUrl, searchType, null, startDate, endDate);
          } else {
            results.pages = await this.syncPageData(siteUrl, searchType, Math.min(daysBack, 7));
          }
          logger.info(`Bing pages sync completed for ${siteUrl}: ${results.pages?.recordsProcessed || 0} records`);
        } catch (pagesError) {
          logger.info(`Bing pages data not available for ${siteUrl} (optional data): ${pagesError.message}`);
          logger.info(`Continuing sync without pages data for ${siteUrl} - this is normal`);
          results.pages = { success: true, recordsProcessed: 0, message: 'Pages data not available (normal for some sites)' };
        }
      }

      logger.info(`Bing sync completed for ${siteUrl}:`, results);
      return { success: true, results };

    } catch (error) {
      logger.error(`Bing sync failed for ${siteUrl}:`, error);
      throw error;
    }
  }

  /**
   * Backfill historical data for a site with improved error handling and rate limiting
   */
  async backfillSite(siteUrl, searchType = 'web', monthsBack = 6) {
    logger.info(`Starting Bing backfill for ${siteUrl} (${monthsBack} months)`);

    try {
      // Process in smaller chunks to avoid timeouts and rate limits
      const chunkSizeDays = 3; // Process 3 days at a time (reduced from 7)
      const totalDays = monthsBack * 30;
      const totalChunks = Math.ceil(totalDays / chunkSizeDays);
      
      logger.info(`Bing backfill: Processing ${totalChunks} chunks of ${chunkSizeDays} days each`);
      
      let totalResults = {
        totals: { success: true, recordsProcessed: 0 },
        queries: { success: true, recordsProcessed: 0 },
        pages: { success: true, recordsProcessed: 0 }
      };
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);
      
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 5;
      
      // Process each chunk with improved error handling
      for (let chunk = 0; chunk < totalChunks; chunk++) {
        const chunkStart = new Date(startDate);
        chunkStart.setDate(startDate.getDate() + (chunk * chunkSizeDays));
        
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setDate(chunkStart.getDate() + chunkSizeDays - 1);
        
        // Don't go beyond the end date
        if (chunkEnd > endDate) {
          chunkEnd.setTime(endDate.getTime());
        }
        
        logger.info(`Bing backfill: Processing chunk ${chunk + 1}/${totalChunks} (${chunkStart.toISOString().split('T')[0]} to ${chunkEnd.toISOString().split('T')[0]})`);
        
        try {
          // Add timeout wrapper for each chunk
          const chunkPromise = this.syncSite(siteUrl, searchType, {
            startDate: chunkStart,
            endDate: chunkEnd,
            includeQueries: true,
            includePages: true,
            includeTotals: true
          });
          
          // Set a timeout for each chunk (5 minutes)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Chunk timeout after 5 minutes')), 5 * 60 * 1000);
          });
          
          const chunkResults = await Promise.race([chunkPromise, timeoutPromise]);
          
          // Accumulate results
          if (chunkResults.results?.totals) {
            totalResults.totals.recordsProcessed += chunkResults.results.totals.recordsProcessed || 0;
          }
          if (chunkResults.results?.queries) {
            totalResults.queries.recordsProcessed += chunkResults.results.queries.recordsProcessed || 0;
          }
          if (chunkResults.results?.pages) {
            totalResults.pages.recordsProcessed += chunkResults.results.pages.recordsProcessed || 0;
          }
          
          logger.info(`Bing backfill: Chunk ${chunk + 1} completed - Totals: ${chunkResults.results?.totals?.recordsProcessed || 0}, Queries: ${chunkResults.results?.queries?.recordsProcessed || 0}, Pages: ${chunkResults.results?.pages?.recordsProcessed || 0}`);
          
          // Reset consecutive error counter on success
          consecutiveErrors = 0;
          
          // Add progressive delay between chunks to avoid overwhelming the API
          const baseDelay = 2000; // 2 seconds base delay
          const progressiveDelay = Math.min(chunk * 100, 5000); // Progressive delay up to 5 seconds
          const totalDelay = baseDelay + progressiveDelay;
          
          if (chunk < totalChunks - 1) {
            logger.info(`Waiting ${totalDelay}ms before processing next chunk...`);
            await new Promise(resolve => setTimeout(resolve, totalDelay));
          }
          
        } catch (chunkError) {
          consecutiveErrors++;
          logger.error(`Bing backfill: Error in chunk ${chunk + 1} (${consecutiveErrors}/${maxConsecutiveErrors} consecutive errors):`, chunkError.message);
          
          // If we have too many consecutive errors, stop the backfill
          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.error(`Bing backfill: Too many consecutive errors (${consecutiveErrors}), stopping backfill for ${siteUrl}`);
            break;
          }
          
          // Add exponential backoff delay before retrying
          const backoffDelay = Math.min(1000 * Math.pow(2, consecutiveErrors), 30000); // Max 30 seconds
          logger.info(`Waiting ${backoffDelay}ms before continuing...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          
          // Continue with next chunk instead of failing completely
          continue;
        }
      }

      logger.info(`Bing backfill completed for ${siteUrl} - Total: ${totalResults.totals.recordsProcessed} totals, ${totalResults.queries.recordsProcessed} queries, ${totalResults.pages.recordsProcessed} pages`);
      return totalResults;

    } catch (error) {
      logger.error(`Bing backfill failed for ${siteUrl}:`, error);
      throw error;
    }
  }
}

module.exports = new BingIngestService();
