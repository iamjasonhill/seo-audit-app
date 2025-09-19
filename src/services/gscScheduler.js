const os = require('os');
const databaseService = require('./database');
const gscAuth = require('./gscAuth');
const gscIngest = require('./gscIngest');
const logger = require('../utils/logger');

const SEARCH_TYPES = ['web', 'image', 'video'];

function iso(d) { return d.toISOString().slice(0,10); }

async function acquireLock(lockId, ttlMs, who) {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  try {
    const existing = await databaseService.prisma.gscSyncLock.findUnique({ where: { id: lockId } });
    if (!existing || !existing.lockedUntil || existing.lockedUntil < now) {
      await databaseService.prisma.gscSyncLock.upsert({
        where: { id: lockId },
        update: { lockedUntil: until, lockedBy: who },
        create: { id: lockId, lockedUntil: until, lockedBy: who },
      });
      return true;
    }
    return false;
  } catch (e) {
    logger.warn('Scheduler lock error:', e.message);
    return false;
  }
}

async function extendLock(lockId, ttlMs, who) {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  try {
    await databaseService.prisma.gscSyncLock.update({ where: { id: lockId }, data: { lockedUntil: until, lockedBy: who } });
  } catch (_) {}
}

async function releaseLock(lockId) {
  try { await databaseService.prisma.gscSyncLock.delete({ where: { id: lockId } }); } catch (_) {}
}

async function getCoverageFromDb(siteUrl, searchType) {
  const first = await databaseService.prisma.gscTotalsDaily.findFirst({ where: { siteUrl, searchType }, select: { date: true }, orderBy: { date: 'asc' } });
  const last = await databaseService.prisma.gscTotalsDaily.findFirst({ where: { siteUrl, searchType }, select: { date: true }, orderBy: { date: 'desc' } });
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
    // No coverage yet: full 16 months backfill
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth()-16, end.getUTCDate()));
    return { startDate: iso(start), endDate: iso(end), historic: true };
  }
  if (cov.end >= end) return null; // up to date
  const start = new Date(cov.end.getTime() + 24*60*60*1000);
  return { startDate: iso(start), endDate: iso(end), historic: false };
}

async function ensureOAuthClient(userId) {
  const row = await gscAuth.getUserTokens(userId);
  if (!row || (!row.accessToken && !row.refreshToken)) {
    throw new Error('No OAuth tokens for user');
  }
  const oauth2Client = gscAuth.getOAuth2Client();
  const creds = {};
  if (row.accessToken) creds.access_token = row.accessToken;
  if (row.refreshToken) creds.refresh_token = row.refreshToken;
  if (row.expiryDate) creds.expiry_date = new Date(row.expiryDate).getTime();
  oauth2Client.setCredentials(creds);
  oauth2Client.on('tokens', async (t) => { try { await gscAuth.saveUserTokens(userId, t); } catch (_) {} });
  return oauth2Client;
}

class GscScheduler {
  constructor() {
    this.running = false;
    this.timer = null;
    this.lockId = 'scheduler';
    this.lockTtlMs = 120000; // 2 minutes
    this.who = `${os.hostname()}#${process.pid}`;
  }

  start(intervalMs = 60000) {
    if (this.timer) return;
    logger.info('GSC Scheduler starting');
    this.timer = setInterval(() => this.tick().catch(e => logger.error('Scheduler tick error:', e.message)), intervalMs);
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
    const rows = await databaseService.prisma.gscUserProperty.findMany({
      where: { enabled: true, OR: [{ nextSyncDueAt: null }, { nextSyncDueAt: { lte: now } }] },
      orderBy: [ { nextSyncDueAt: 'asc' }, { priorityOrder: 'asc' }, { lastFullSyncAt: 'asc' } ],
      take: 10,
    });
    return rows[0] || null;
  }

  async processNextDomain() {
    const prop = await this.findNextDueProperty();
    if (!prop) return; // nothing due
    const { userId, siteUrl } = prop;
    logger.info(`Scheduler: syncing ${siteUrl} for user ${userId}`);
    const oauth2Client = await ensureOAuthClient(userId);

    // Decide ranges per type
    const tasks = [];
    for (const st of SEARCH_TYPES) {
      const win = await computeWindow(siteUrl, st);
      if (win) tasks.push({ st, ...win });
    }

    if (tasks.length === 0) {
      // Up to date; schedule next interval
      const next = new Date(Date.now() + (prop.syncIntervalHours || 24) * 3600 * 1000);
      await databaseService.prisma.gscUserProperty.update({ where: { id: prop.id }, data: { lastFullSyncAt: new Date(), nextSyncDueAt: next } });
      return;
    }

    // Merge to a single window spanning min start/max end across required types
    const minStart = tasks.reduce((d, t) => d && d < new Date(t.startDate) ? d : new Date(t.startDate), null) || new Date(tasks[0].startDate);
    const maxEnd = tasks.reduce((d, t) => d && d > new Date(t.endDate) ? d : new Date(t.endDate), null) || new Date(tasks[0].endDate);
    const searchTypes = tasks.map(t => t.st);

    try {
      await gscIngest.backfillProperty(oauth2Client, siteUrl, {
        startDate: iso(minStart),
        endDate: iso(maxEnd),
        searchTypes,
      });
      // Decide next due time
      let complete = true;
      for (const st of SEARCH_TYPES) {
        if (!(await isUpToDate(siteUrl, st))) { complete = false; break; }
      }
      const next = complete ? new Date(Date.now() + (prop.syncIntervalHours || 24) * 3600 * 1000) : new Date();
      await databaseService.prisma.gscUserProperty.update({ where: { id: prop.id }, data: { lastFullSyncAt: new Date(), nextSyncDueAt: next } });
    } catch (e) {
      logger.error('Scheduler domain sync error:', e.message);
      // Backoff 15 minutes
      const next = new Date(Date.now() + 15*60*1000);
      await databaseService.prisma.gscUserProperty.update({ where: { id: prop.id }, data: { nextSyncDueAt: next } });
    }
  }
}

module.exports = new GscScheduler();


