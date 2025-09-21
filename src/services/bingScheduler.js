const os = require('os');
const databaseService = require('./database');
const { BingApiClient } = require('./bingApi');
const bingIngest = require('./bingIngest');
const logger = require('../utils/logger');

const SEARCH_TYPES = ['web']; // Bing primarily uses 'web' search type

function iso(d) { return d.toISOString().slice(0,10); }

async function persistSyncStatus(siteUrl, searchType, options) {
  const {
    status,
    message = null,
    dimension = 'page',
    lastSyncedDate,
    lastRunAt,
  } = options;

  const now = lastRunAt ?? new Date();
  const hasLastSyncedDate = Object.prototype.hasOwnProperty.call(options, 'lastSyncedDate');

  const updateData = {
    lastRunAt: now,
    status,
    message,
  };

  if (hasLastSyncedDate) {
    updateData.lastSyncedDate = lastSyncedDate;
  }

  const createData = {
    siteUrl,
    searchType,
    dimension,
    lastSyncedDate: hasLastSyncedDate ? lastSyncedDate : null,
    lastRunAt: now,
    status,
    message,
  };

  await databaseService.prisma.bingSyncStatus.upsert({
    where: {
      siteUrl_searchType_dimension: {
        siteUrl,
        searchType,
        dimension,
      },
    },
    update: updateData,
    create: createData,
  });
}

async function acquireLock(lockId, ttlMs, who) {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  try {
    const existing = await databaseService.prisma.bingSyncLock.findUnique({ where: { id: lockId } });
    if (!existing || !existing.lockedUntil || existing.lockedUntil < now) {
      await databaseService.prisma.bingSyncLock.upsert({
        where: { id: lockId },
        update: { lockedUntil: until, lockedBy: who },
        create: { id: lockId, lockedUntil: until, lockedBy: who },
      });
      return true;
    }
    return false;
  } catch (e) {
    logger.warn('Bing scheduler lock error:', e.message);
    return false;
  }
}

async function extendLock(lockId, ttlMs, who) {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  try {
    await databaseService.prisma.bingSyncLock.update({ where: { id: lockId }, data: { lockedUntil: until, lockedBy: who } });
  } catch (_) {}
}

async function releaseLock(lockId) {
  try { await databaseService.prisma.bingSyncLock.delete({ where: { id: lockId } }); } catch (_) {}
}

async function getCoverageFromDb(siteUrl, searchType) {
  const first = await databaseService.prisma.bingTotalsDaily.findFirst({ 
    where: { siteUrl, searchType }, 
    select: { date: true }, 
    orderBy: { date: 'asc' } 
  });
  const last = await databaseService.prisma.bingTotalsDaily.findFirst({ 
    where: { siteUrl, searchType }, 
    select: { date: true }, 
    orderBy: { date: 'desc' } 
  });
  return {
    start: first?.date || null,
    end: last?.date || null,
  };
}

async function isUpToDate(siteUrl, searchType) {
  const cov = await getCoverageFromDb(siteUrl, searchType);
  if (!cov.end) return false;
  const today = new Date();
  const target = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()-2));
  return cov.end >= target;
}

async function computeWindow(siteUrl, searchType) {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()-2));
  const cov = await getCoverageFromDb(siteUrl, searchType);
  if (!cov.start || !cov.end) {
    // No coverage yet: start with 7 days backfill (weekly chunks)
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()-7));
    return { startDate: iso(start), endDate: iso(end), historic: true };
  }
  if (cov.end >= end) return null; // up to date
  const start = new Date(cov.end.getTime() + 24*60*60*1000);
  return { startDate: iso(start), endDate: iso(end), historic: false };
}

async function ensureBingApiClient(userId) {
  // First try to get API key from user's stored key
  const apiKeyRow = await databaseService.prisma.bingApiKey.findUnique({ where: { userId } });
  let apiKey = apiKeyRow?.apiKey;
  
  // If no user-specific key, fall back to environment variable
  if (!apiKey) {
    apiKey = process.env.BING_API_KEY;
    logger.info(`No user-specific Bing API key found for user ${userId}, using environment variable`);
  }
  
  if (!apiKey) {
    throw new Error('No Bing API key found. Please configure your Bing Webmaster Tools API key in environment variables or user settings.');
  }
  
  logger.info(`Using Bing API key for user ${userId} (${apiKeyRow ? 'user-specific' : 'environment'})`);
  return new BingApiClient(apiKey);
}

class BingScheduler {
  constructor() {
    this.running = false;
    this.timer = null;
    this.lockId = 'bing-scheduler';
    this.lockTtlMs = 120000; // 2 minutes
    this.who = `${os.hostname()}#${process.pid}`;
  }

  start(intervalMs = 300000) { // 5 minutes default interval
    if (this.timer) {
      logger.info('Bing Scheduler already running, skipping start');
      return;
    }
    logger.info('Bing Scheduler starting with interval:', intervalMs);
    try {
      this.timer = setInterval(() => this.tick().catch(e => logger.error('Bing scheduler tick error:', e.message)), intervalMs);
      logger.info('Bing Scheduler timer set successfully');
      // kick immediately
      logger.info('Bing Scheduler executing initial tick...');
      this.tick().catch(e => logger.error('Bing scheduler initial tick error:', e.message));
      logger.info('Bing Scheduler start method completed');
    } catch (error) {
      logger.error('Error in Bing Scheduler start method:', error);
      throw error;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running) return;
    const got = await acquireLock(this.lockId, this.lockTtlMs, this.who);
    if (!got) return;
    this.running = true;
    try {
      await this.processNextDomain();
    } finally {
      this.running = false;
      await releaseLock(this.lockId);
    }
  }

  async findNextDueProperty() {
    const now = new Date();
    const rows = await databaseService.prisma.$queryRawUnsafe(`
      SELECT * FROM bing_user_property 
      WHERE enabled = true 
        AND (next_sync_due_at IS NULL OR next_sync_due_at <= $1)
      ORDER BY next_sync_due_at ASC, priority_order ASC, last_full_sync_at ASC
      LIMIT 10
    `, now);
    return rows[0] || null;
  }

  async processNextDomain() {
    const prop = await this.findNextDueProperty();
    if (!prop) return; // nothing due
    const { user_id: userId, site_url: siteUrl } = prop;
    logger.info(`Bing Scheduler: processing ${siteUrl} for user ${userId}`);

    // Define startDate and endDate for use throughout the method
    let startDate, endDate;

    try {
      const bingApi = await ensureBingApiClient(userId);

      // Decide ranges per type (like GSC scheduler)
      const tasks = [];
      for (const st of SEARCH_TYPES) {
        const win = await computeWindow(siteUrl, st);
        if (win) tasks.push({ st, ...win });
      }

      if (tasks.length === 0) {
        // Totals are up to date, but check if we need to process queries and pages
        logger.info(`Bing Scheduler: Totals are up to date for ${siteUrl}, checking if queries/pages processing is needed`);
        
        // Check if we have queries and pages data
        const queriesCount = await databaseService.prisma.bingQueriesDaily.count({ where: { siteUrl } });
        const pagesCount = await databaseService.prisma.bingPagesDaily.count({ where: { siteUrl } });
        
        if (queriesCount === 0 || pagesCount === 0) {
          logger.info(`Bing Scheduler: Missing queries (${queriesCount}) or pages (${pagesCount}) data for ${siteUrl}, processing needed`);

          // Process queries and pages directly instead of creating a task
          const today = new Date();
          endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()-2));
          startDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()-30));

          try {
            const queriesPagesResult = await this.processQueriesAndPages(siteUrl, userId, startDate, endDate);
            logger.info(`Bing Scheduler: Queries/pages processing completed for ${siteUrl} - ${queriesPagesResult.processedChunks}/${queriesPagesResult.totalChunks} chunks processed`);
          } catch (error) {
            logger.error(`Bing Scheduler: Error processing queries/pages for ${siteUrl}:`, error);
          }
        } else {
          // Everything is up to date; schedule next interval
          const next = new Date(Date.now() + (prop.sync_interval_hours || 24) * 3600 * 1000);
          await databaseService.prisma.$executeRawUnsafe(`
            UPDATE bing_user_property 
            SET last_full_sync_at = NOW(), next_sync_due_at = $1, updated_at = NOW()
            WHERE id = $2
          `, next, prop.id);
          logger.info(`Bing Scheduler: ${siteUrl} is fully up to date, next sync scheduled for ${next.toISOString()}`);
          return;
        }
      }

      // Merge to a single window spanning min start/max end across required types
      const minStart = tasks.reduce((d, t) => d && d < new Date(t.startDate) ? d : new Date(t.startDate), null) || new Date(tasks[0].startDate);
      const maxEnd = tasks.reduce((d, t) => d && d > new Date(t.endDate) ? d : new Date(t.endDate), null) || new Date(tasks[0].endDate);
      const searchTypes = tasks.map(t => t.st);

      // Set startDate and endDate for use in queries/pages processing
      startDate = minStart;
      endDate = maxEnd;

      // Process in smaller chunks to avoid Vercel timeout limits
      const chunkSizeDays = 2; // Reduced from 7 to 2 days
      const totalDays = Math.ceil((maxEnd - minStart) / (1000 * 60 * 60 * 24));
      const totalChunks = Math.ceil(totalDays / chunkSizeDays);
      
      logger.info(`Bing Scheduler: Processing ${totalChunks} chunks of ${chunkSizeDays} days each for ${siteUrl} (${totalDays} days total)`);
      
      let processedChunks = 0;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;
      const maxChunksPerRun = 10; // Limit chunks per run to avoid timeout
      
      // Limit the number of chunks processed in a single run
      const chunksToProcess = Math.min(totalChunks, maxChunksPerRun);
      
      for (let chunk = 0; chunk < chunksToProcess; chunk++) {
        const chunkStart = new Date(minStart);
        chunkStart.setDate(minStart.getDate() + (chunk * chunkSizeDays));
        
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setDate(chunkStart.getDate() + chunkSizeDays - 1);
        
        // Don't go beyond the max end date
        if (chunkEnd > maxEnd) {
          chunkEnd.setTime(maxEnd.getTime());
        }
        
        logger.info(`Bing Scheduler: Processing chunk ${chunk + 1}/${chunksToProcess} for ${siteUrl} (${iso(chunkStart)} to ${iso(chunkEnd)})`);
        
        try {
          // Process only totals first to get basic data quickly
        // Check if we need to process queries and pages
        const queriesCount = await databaseService.prisma.bingQueriesDaily.count({ where: { siteUrl } });
        const pagesCount = await databaseService.prisma.bingPagesDaily.count({ where: { siteUrl } });
        
        const results = await bingIngest.syncSite(siteUrl, 'web', {
          startDate: chunkStart,
          endDate: chunkEnd,
          includeQueries: queriesCount === 0, // Process queries if missing
          includePages: pagesCount === 0,     // Process pages if missing
          includeTotals: true                 // Always process totals
        });
          
          processedChunks++;
          consecutiveErrors = 0; // Reset error counter on success
          
          logger.info(`Bing Scheduler: Chunk ${chunk + 1} completed for ${siteUrl} - Totals: ${results.results?.totals?.recordsProcessed || 0}`);
          
          // Add delay between chunks to avoid overwhelming the API
          if (chunk < chunksToProcess - 1) {
            const delay = 2000; // Reduced to 2 seconds between chunks
            logger.info(`Waiting ${delay}ms before processing next chunk...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
        } catch (chunkError) {
          consecutiveErrors++;
          logger.error(`Bing Scheduler: Error in chunk ${chunk + 1} for ${siteUrl} (${consecutiveErrors}/${maxConsecutiveErrors} consecutive errors):`, chunkError.message);
          
          // If we have too many consecutive errors, stop processing this domain
          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.error(`Bing Scheduler: Too many consecutive errors (${consecutiveErrors}), stopping sync for ${siteUrl}`);
            break;
          }
          
          // Add exponential backoff delay before retrying
          const backoffDelay = Math.min(1000 * Math.pow(2, consecutiveErrors), 10000); // Max 10 seconds
          logger.info(`Waiting ${backoffDelay}ms before continuing...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          
          // Continue with next chunk instead of failing completely
          continue;
        }
      }

      // After processing totals, also process queries and pages if totals are up to date
      let queriesPagesProcessed = false;
      if (await isUpToDate(siteUrl, 'web')) {
        logger.info(`Bing Scheduler: Totals are up to date for ${siteUrl}, now processing queries and pages`);
        try {
          const queriesPagesResult = await this.processQueriesAndPages(siteUrl, userId, startDate, endDate);
          queriesPagesProcessed = true;
          logger.info(`Bing Scheduler: Queries/pages processing completed for ${siteUrl} - ${queriesPagesResult.processedChunks}/${queriesPagesResult.totalChunks} chunks`);
        } catch (error) {
          logger.error(`Bing Scheduler: Error processing queries/pages for ${siteUrl}:`, error);
        }
      }

      // Check if we're up to date or if we've hit the chunk limit
      let complete = true;
      let hitChunkLimit = chunksToProcess >= maxChunksPerRun;
      
      for (const st of SEARCH_TYPES) {
        if (!(await isUpToDate(siteUrl, st))) { 
          complete = false; 
          break; 
        }
      }
      
      // Schedule next sync based on completion status
      let next;
      if (complete && queriesPagesProcessed) {
        // Fully up to date including queries/pages - schedule normal interval
        next = new Date(Date.now() + (prop.sync_interval_hours || 24) * 3600 * 1000);
        logger.info(`Bing Scheduler: ${siteUrl} is fully up to date (totals + queries/pages), scheduling normal interval`);
      } else if (hitChunkLimit || !queriesPagesProcessed) {
        // Hit chunk limit or still need to process queries/pages - schedule quick retry
        next = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
        const reason = hitChunkLimit ? 'chunk limit' : 'queries/pages processing needed';
        logger.info(`Bing Scheduler: ${siteUrl} ${reason} (${processedChunks}/${totalChunks} chunks processed), scheduling quick retry`);
      } else {
        // Not complete but didn't hit limit - schedule normal retry
        next = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
        logger.info(`Bing Scheduler: ${siteUrl} not complete (${processedChunks}/${totalChunks} chunks processed), scheduling retry`);
      }
      
      await databaseService.prisma.$executeRawUnsafe(`
        UPDATE bing_user_property 
        SET last_full_sync_at = NOW(), next_sync_due_at = $1, updated_at = NOW()
        WHERE id = $2
      `, next, prop.id);
      
      logger.info(`Bing Scheduler: ${siteUrl} sync session complete (${processedChunks}/${totalChunks} chunks processed), next sync scheduled for ${next.toISOString()}`);
      
    } catch (e) {
      logger.error('Bing Scheduler domain sync error:', e.message);
      // Backoff 15 minutes
      const next = new Date(Date.now() + 15*60*1000);
      await databaseService.prisma.$executeRawUnsafe(`
        UPDATE bing_user_property 
        SET next_sync_due_at = $1, updated_at = NOW()
        WHERE id = $2
      `, next, prop.id);
    }
  }

  // Method to add a property to the scheduler
  async addProperty(userId, siteUrl, options = {}) {
    const { syncIntervalHours = 24, priorityOrder = 0 } = options;
    
    try {
      // Use raw SQL to avoid Prisma model dependency
      await databaseService.prisma.$executeRawUnsafe(`
        INSERT INTO bing_user_property (user_id, site_url, enabled, sync_interval_hours, priority_order, next_sync_due_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (user_id, site_url) 
        DO UPDATE SET 
          enabled = $3,
          sync_interval_hours = $4,
          priority_order = $5,
          updated_at = NOW()
      `, userId, siteUrl, true, syncIntervalHours, priorityOrder, new Date());
      
      logger.info(`Added Bing property ${siteUrl} for user ${userId} to scheduler`);
    } catch (error) {
      logger.error(`Error adding Bing property ${siteUrl} for user ${userId}:`, error.message);
      throw error;
    }
  }

  // Method to remove a property from the scheduler
  async removeProperty(userId, siteUrl) {
    try {
      await databaseService.prisma.$executeRawUnsafe(`
        DELETE FROM bing_user_property 
        WHERE user_id = $1 AND site_url = $2
      `, userId, siteUrl);
      
      logger.info(`Removed Bing property ${siteUrl} for user ${userId} from scheduler`);
    } catch (error) {
      logger.error(`Error removing Bing property ${siteUrl} for user ${userId}:`, error.message);
      throw error;
    }
  }

  // Method to discover and auto-register all available Bing domains for a user
  async discoverAndRegisterDomains(userId) {
    try {
      logger.info(`Starting Bing domain discovery for user ${userId}`);
      
      const bingApi = await ensureBingApiClient(userId);
      logger.info(`Bing API client created for user ${userId}`);
      
      const sites = await bingApi.getUserSites();
      logger.info(`Bing API returned ${sites ? sites.length : 0} sites for user ${userId}`);
      
      if (!sites || sites.length === 0) {
        logger.warn(`No Bing sites found for user ${userId}. This could mean:`);
        logger.warn(`1. No sites are verified in Bing Webmaster Tools`);
        logger.warn(`2. The API key doesn't have access to any sites`);
        logger.warn(`3. The API key is invalid or expired`);
        return [];
      }

      logger.info(`Discovered ${sites.length} Bing sites for user ${userId}:`, sites.map(s => s.siteUrl));
      
      const registeredSites = [];
      const now = new Date();
      
      for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        try {
          // Validate site URL
          if (!site.siteUrl || site.siteUrl === 'undefined' || site.siteUrl === 'null') {
            logger.warn(`Skipping invalid site URL: ${JSON.stringify(site)}`);
            continue;
          }
          
          logger.info(`Processing site ${i + 1}/${sites.length}: ${site.siteUrl}`);
          logger.info(`Site object: ${JSON.stringify(site)}`);
          
          // Check if already registered
          const existing = await databaseService.prisma.$queryRawUnsafe(`
            SELECT id FROM bing_user_property 
            WHERE user_id = $1 AND site_url = $2
          `, userId, site.siteUrl);
          
          if (existing.length > 0) {
            logger.info(`Bing site ${site.siteUrl} already registered for user ${userId}`);
            continue;
          }
          
          // Register new site with staggered start times (5 minutes apart)
          const priorityOrder = i;
          const nextSyncDueAt = new Date(now.getTime() + (i * 5 * 60 * 1000)); // 5 minutes apart
          
          logger.info(`Inserting site into database: userId=${userId}, siteUrl=${site.siteUrl}, priority=${priorityOrder}`);
          
          await databaseService.prisma.$executeRawUnsafe(`
            INSERT INTO bing_user_property (user_id, site_url, enabled, sync_interval_hours, priority_order, next_sync_due_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          `, userId, site.siteUrl, true, 24, priorityOrder, nextSyncDueAt);
          
          logger.info(`Successfully inserted site: ${site.siteUrl}`);
          
          registeredSites.push({
            siteUrl: site.siteUrl,
            priorityOrder,
            nextSyncDueAt: nextSyncDueAt.toISOString()
          });
          
          logger.info(`Registered new Bing site ${site.siteUrl} for user ${userId} (priority ${priorityOrder}, next sync: ${nextSyncDueAt.toISOString()})`);
          
        } catch (error) {
          logger.error(`Error registering Bing site ${site.siteUrl} for user ${userId}:`, error.message);
        }
      }
      
      logger.info(`Auto-registration complete for user ${userId}: ${registeredSites.length} new sites registered`);
      return registeredSites;
      
    } catch (error) {
      logger.error(`Error discovering Bing domains for user ${userId}:`, error.message);
      if (error.message.includes('No Bing API key')) {
        throw new Error('Bing API key not configured. Please add your Bing Webmaster Tools API key to the environment variables.');
      }
      throw error;
    }
  }

  // Method to get all registered properties for a user (or all users if admin)
  async getRegisteredProperties(userId, isAdmin = false) {
    try {
      const whereClause = isAdmin ? '' : 'WHERE user_id = $1';
      const params = isAdmin ? [] : [userId];
      
      logger.info(`Getting registered properties for user ${userId}, isAdmin: ${isAdmin}`);
      
      const properties = await databaseService.prisma.$queryRawUnsafe(`
        SELECT bup.*, u.email, u.username
        FROM bing_user_property bup
        LEFT JOIN users u ON bup.user_id = u.id
        ${whereClause}
        ORDER BY bup.priority_order ASC, bup.next_sync_due_at ASC
      `, ...params);
      
      logger.info(`Retrieved ${properties.length} properties from database`);
      logger.info(`First property: ${JSON.stringify(properties[0] || {})}`);
      
      return properties;
    } catch (error) {
      logger.error(`Error getting registered Bing properties:`, error.message);
      throw error;
    }
  }

  // Method to process queries and pages for a site (separate from totals)
  async processQueriesAndPages(siteUrl, userId, startDate, endDate) {
    logger.info(`Bing Scheduler: Processing queries and pages for ${siteUrl} (${startDate} to ${endDate})`);

    try {
      await ensureBingApiClient(userId);

      const searchType = 'web';
      const chunkSizeDays = 1; // Process 1 day at a time for queries/pages
      const baseStartDate = new Date(startDate);
      const baseEndDate = new Date(endDate);
      const msPerDay = 24 * 60 * 60 * 1000;

      let resumeDate = new Date(baseStartDate);

      try {
        const status = await databaseService.prisma.bingSyncStatus.findUnique({
          where: {
            siteUrl_searchType_dimension: {
              siteUrl,
              searchType,
              dimension: 'page',
            },
          },
        });

        if (status?.lastSyncedDate) {
          const nextDay = new Date(status.lastSyncedDate);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          if (nextDay > resumeDate) {
            resumeDate = nextDay;
          }
        } else {
          const latestPage = await databaseService.prisma.bingPagesDaily.findFirst({
            where: { siteUrl, searchType },
            select: { date: true },
            orderBy: { date: 'desc' },
          });

          if (latestPage?.date) {
            const nextDay = new Date(latestPage.date);
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            if (nextDay > resumeDate) {
              resumeDate = nextDay;
            }
          }
        }
      } catch (statusError) {
        logger.warn(`Bing Scheduler: Failed to read pages sync status for ${siteUrl}: ${statusError.message}`);
      }

      if (resumeDate > baseEndDate) {
        logger.info(`Bing Scheduler: Pages resume date ${iso(resumeDate)} is beyond end date ${iso(baseEndDate)} for ${siteUrl}, skipping.`);
        return { processedChunks: 0, totalChunks: 0 };
      }

      const diffDays = Math.floor((baseEndDate - resumeDate) / msPerDay);
      if (diffDays < 0) {
        logger.info(`Bing Scheduler: No queries/pages work needed for ${siteUrl}; resume date ${iso(resumeDate)} beyond ${iso(baseEndDate)}`);
        return { processedChunks: 0, totalChunks: 0 };
      }

      const totalDays = diffDays + 1;
      const totalChunks = Math.ceil(totalDays / chunkSizeDays);
      const maxChunksPerRun = 5; // Limit chunks per run for queries/pages

      const chunksToProcess = Math.min(totalChunks, maxChunksPerRun);

      let processedChunks = 0;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;

      for (let chunk = 0; chunk < chunksToProcess; chunk++) {
        const chunkStart = new Date(resumeDate);
        chunkStart.setUTCDate(resumeDate.getUTCDate() + (chunk * chunkSizeDays));

        if (chunkStart > baseEndDate) {
          logger.info(`Bing Scheduler: Chunk start ${iso(chunkStart)} beyond end date ${iso(baseEndDate)} for ${siteUrl}, stopping.`);
          break;
        }

        const chunkEnd = new Date(chunkStart);
        chunkEnd.setUTCDate(chunkStart.getUTCDate() + chunkSizeDays - 1);

        // Don't go beyond the end date
        if (chunkEnd > baseEndDate) {
          chunkEnd.setTime(baseEndDate.getTime());
        }

        logger.info(`Bing Scheduler: Processing queries/pages chunk ${chunk + 1}/${chunksToProcess} for ${siteUrl} (${chunkStart.toISOString().split('T')[0]} to ${chunkEnd.toISOString().split('T')[0]})`);

        try {
          const results = await bingIngest.syncSite(siteUrl, searchType, {
            startDate: chunkStart,
            endDate: chunkEnd,
            includeQueries: true,
            includePages: true,
            includeTotals: false // Skip totals as they're already processed
          });

          processedChunks++;
          consecutiveErrors = 0;

          await persistSyncStatus(siteUrl, searchType, {
            status: 'ok',
            lastSyncedDate: chunkEnd,
            message: null,
          });

          logger.info(`Bing Scheduler: Queries/pages chunk ${chunk + 1} completed for ${siteUrl} - Queries: ${results.results?.queries?.recordsProcessed || 0}, Pages: ${results.results?.pages?.recordsProcessed || 0}`);

          // Add delay between chunks
          if (chunk < chunksToProcess - 1) {
            const delay = 3000; // 3 seconds between chunks for queries/pages
            logger.info(`Waiting ${delay}ms before processing next queries/pages chunk...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }

        } catch (chunkError) {
          consecutiveErrors++;
          logger.error(`Bing Scheduler: Error in queries/pages chunk ${chunk + 1} for ${siteUrl} (${consecutiveErrors}/${maxConsecutiveErrors} consecutive errors):`, chunkError.message);

          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.error(`Bing Scheduler: Too many consecutive errors (${consecutiveErrors}), stopping queries/pages sync for ${siteUrl}`);
            break;
          }

          try {
            const baseMsg =
              (chunkError && typeof chunkError.message === 'string')
                ? chunkError.message
                : String(chunkError);
            // Include failing range and cap size to protect DB column
            const errMessage = (`[${iso(chunkStart)}..${iso(chunkEnd)}] ${baseMsg}`).slice(0, 1024);
            await persistSyncStatus(siteUrl, searchType, {
              status: 'error',
              message: errMessage,
            });
          } catch (statusPersistError) {
            logger.warn(`Bing Scheduler: Failed to persist queries/pages error status for ${siteUrl}: ${statusPersistError.message}`);
          }

          const backoffDelay = Math.min(1000 * Math.pow(2, consecutiveErrors), 10000);
          logger.info(`Waiting ${backoffDelay}ms before continuing...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
      }

      logger.info(`Bing Scheduler: Queries/pages processing completed for ${siteUrl} (${processedChunks}/${chunksToProcess} chunks processed)`);
      return { processedChunks, totalChunks: chunksToProcess };

    } catch (error) {
      logger.error(`Bing Scheduler: Error processing queries/pages for ${siteUrl}:`, error);
      throw error;
    }
  }
}

module.exports = new BingScheduler();
