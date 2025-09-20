const os = require('os');
const databaseService = require('./database');
const { BingApiClient } = require('./bingApi');
const bingIngest = require('./bingIngest');
const logger = require('../utils/logger');

const SEARCH_TYPES = ['web']; // Bing primarily uses 'web' search type

function iso(d) { return d.toISOString().slice(0,10); }

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
    // No coverage yet: start with 30 days backfill to avoid overwhelming the API
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()-30));
    return { startDate: iso(start), endDate: iso(end), historic: true };
  }
  if (cov.end >= end) return null; // up to date
  const start = new Date(cov.end.getTime() + 24*60*60*1000);
  return { startDate: iso(start), endDate: iso(end), historic: false };
}

async function ensureBingApiClient(userId) {
  const apiKeyRow = await databaseService.prisma.bingApiKey.findUnique({ where: { userId } });
  if (!apiKeyRow || !apiKeyRow.apiKey) {
    throw new Error('No Bing API key for user');
  }
  return new BingApiClient(apiKeyRow.apiKey);
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
    if (this.timer) return;
    logger.info('Bing Scheduler starting');
    this.timer = setInterval(() => this.tick().catch(e => logger.error('Bing scheduler tick error:', e.message)), intervalMs);
    // kick immediately
    this.tick().catch(()=>{});
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
    const { userId, siteUrl } = prop;
    logger.info(`Bing Scheduler: processing ${siteUrl} for user ${userId}`);
    
    try {
      const bingApi = await ensureBingApiClient(userId);

      // Check if this is a first-time sync (no previous sync)
      const isFirstSync = !prop.last_full_sync_at;
      
      if (isFirstSync) {
        logger.info(`Bing Scheduler: First sync detected for ${siteUrl}, performing full 24-month backfill`);
        
        // Perform full backfill for first sync
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 24);
        
        try {
          const results = await bingIngest.backfillSite(siteUrl, 'web', 24);
          logger.info(`Bing Scheduler: Completed 24-month backfill for ${siteUrl} - ${JSON.stringify(results)}`);
        } catch (error) {
          logger.error(`Bing Scheduler: Error during backfill for ${siteUrl}:`, error.message);
          throw error;
        }
        
        // Schedule next sync in regular interval
        const next = new Date(Date.now() + (prop.sync_interval_hours || 24) * 3600 * 1000);
        await databaseService.prisma.$executeRawUnsafe(`
          UPDATE bing_user_property 
          SET last_full_sync_at = NOW(), next_sync_due_at = $1, updated_at = NOW()
          WHERE id = $2
        `, next, prop.id);
        
        logger.info(`Bing Scheduler: ${siteUrl} backfill complete, next sync scheduled for ${next.toISOString()}`);
        return;
      }

      // Regular sync for subsequent runs
      const tasks = [];
      for (const st of SEARCH_TYPES) {
        const win = await computeWindow(siteUrl, st);
        if (win) tasks.push({ st, ...win });
      }

      if (tasks.length === 0) {
        // Up to date; schedule next interval
        const next = new Date(Date.now() + (prop.sync_interval_hours || 24) * 3600 * 1000);
        await databaseService.prisma.$executeRawUnsafe(`
          UPDATE bing_user_property 
          SET last_full_sync_at = NOW(), next_sync_due_at = $1, updated_at = NOW()
          WHERE id = $2
        `, next, prop.id);
        logger.info(`Bing Scheduler: ${siteUrl} is up to date, next sync scheduled for ${next.toISOString()}`);
        return;
      }

      // Process each task (search type) separately to avoid overwhelming the API
      for (const task of tasks) {
        try {
          logger.info(`Bing Scheduler: processing ${siteUrl} (${task.st}) from ${task.startDate} to ${task.endDate}`);
          
          // Calculate days to process
          const startDate = new Date(task.startDate);
          const endDate = new Date(task.endDate);
          const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
          
          // Limit to 30 days per sync to avoid API timeouts
          const maxDays = 30;
          const actualEndDate = daysDiff > maxDays ? 
            new Date(startDate.getTime() + maxDays * 24 * 60 * 60 * 1000) : 
            endDate;
          
          const results = await bingIngest.syncSite(siteUrl, task.st, {
            startDate: startDate,
            endDate: actualEndDate,
            includeQueries: true,  // Include queries data
            includePages: true,    // Include pages data
            includeTotals: true
          });
          
          logger.info(`Bing Scheduler: completed ${siteUrl} (${task.st}) - ${JSON.stringify(results)}`);
          
        } catch (error) {
          logger.error(`Bing Scheduler: error processing ${siteUrl} (${task.st}):`, error.message);
        }
      }

      // Check if we're up to date
      let complete = true;
      for (const st of SEARCH_TYPES) {
        if (!(await isUpToDate(siteUrl, st))) { 
          complete = false; 
          break; 
        }
      }
      
      // Schedule next sync
      const next = complete ? 
        new Date(Date.now() + (prop.sync_interval_hours || 24) * 3600 * 1000) : 
        new Date(Date.now() + 5 * 60 * 1000); // 5 minutes if not complete
      
      await databaseService.prisma.$executeRawUnsafe(`
        UPDATE bing_user_property 
        SET last_full_sync_at = NOW(), next_sync_due_at = $1, updated_at = NOW()
        WHERE id = $2
      `, next, prop.id);
      
      logger.info(`Bing Scheduler: ${siteUrl} sync complete, next sync scheduled for ${next.toISOString()}`);
      
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
}

module.exports = new BingScheduler();
