const express = require('express');
const { google } = require('googleapis');
const gscIngest = require('../services/gscIngest');
const jwt = require('jsonwebtoken');
const databaseService = require('../services/database');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const gscAuth = require('../services/gscAuth');
const gscScheduler = require('../services/gscScheduler');

const router = express.Router();

// Attempt to bind tokens from cookie if present
async function autoBindFromCookie(req, res) {
  try {
    const raw = req.cookies?.gsc_tokens;
    if (!raw) return false;
    const tokens = JSON.parse(raw);
    await gscAuth.saveUserTokens(req.user.id, tokens);
    try { if (res && res.clearCookie) res.clearCookie('gsc_tokens'); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

const ensureGscContext = async (req, overrideUserId) => {
  const targetUserId = overrideUserId || req.user.id;
  let row = await gscAuth.getUserTokens(targetUserId);
  const selected = await gscAuth.getUserSelection(targetUserId);
  if (!row || (!row.accessToken && !row.refreshToken)) {
    // Try to bind from cookie automatically
    await autoBindFromCookie(req, /* res */ undefined);
    row = await gscAuth.getUserTokens(targetUserId);
  }
  if (!row || (!row.accessToken && !row.refreshToken)) {
    const err = new Error('Connect Google first');
    err.status = 401; err.code = 'NotConnected';
    throw err;
  }
  if (!selected) {
    const err = new Error('Select a property first');
    err.status = 400; err.code = 'NoProperty';
    throw err;
  }
  const oauth2Client = gscAuth.getOAuth2Client();
  const creds = {};
  if (row.accessToken) creds.access_token = row.accessToken;
  if (row.refreshToken) creds.refresh_token = row.refreshToken;
  if (row.expiryDate) creds.expiry_date = new Date(row.expiryDate).getTime();
  oauth2Client.setCredentials(creds);
  oauth2Client.on('tokens', async (t) => {
    try { await gscAuth.saveUserTokens(targetUserId, t); } catch (_) {}
  });
  return { oauth2Client, selected, userId: targetUserId };
};

const getDefaultRange = (startDate, endDate) => {
  if (startDate && endDate) return { startDate, endDate };
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 27);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
};

const getSearchType = (searchType) => {
  const allowed = new Set(['web', 'image', 'video', 'news', 'discover']);
  const st = (searchType || 'web').toString().toLowerCase();
  return allowed.has(st) ? st : 'web';
};

// DB-backed analytics helpers
const parseIso = (s) => new Date(`${s}T00:00:00.000Z`);
async function isCovered(siteUrl, searchType, dimension, endDateIso) {
  try {
    const status = await databaseService.prisma.gscSyncStatus.findFirst({
      where: { siteUrl, searchType, dimension },
    });
    if (!status || !status.lastSyncedDate) return false;
    const end = parseIso(endDateIso);
    return new Date(status.lastSyncedDate) >= end && status.status === 'ok';
  } catch (_) { return false; }
}

async function getSummaryFromDb(siteUrl, searchType, range) {
  const start = parseIso(range.startDate);
  const end = parseIso(range.endDate);
  const rows = await databaseService.prisma.gscTotalsDaily.findMany({
    where: { siteUrl, searchType, date: { gte: start, lte: end } },
    select: { date: true, clicks: true, impressions: true, ctr: true, position: true },
    orderBy: { date: 'asc' }
  });
  const sumClicks = rows.reduce((a, r) => a + (r.clicks || 0), 0);
  const sumImpr = rows.reduce((a, r) => a + (r.impressions || 0), 0);
  const weightedPosNum = rows.reduce((a, r) => a + (r.position || 0) * (r.impressions || 0), 0);
  const totals = {
    clicks: sumClicks,
    impressions: sumImpr,
    ctr: sumImpr > 0 ? (sumClicks / sumImpr) : 0,
    position: sumImpr > 0 ? (weightedPosNum / sumImpr) : 0,
  };
  const daily = rows.map(r => ({
    date: r.date.toISOString().slice(0, 10),
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  }));
  return { totals, daily };
}

async function getCoverageFromDb(siteUrl, searchType) {
  const first = await databaseService.prisma.gscTotalsDaily.findFirst({
    where: { siteUrl, searchType },
    select: { date: true },
    orderBy: { date: 'asc' }
  });
  const last = await databaseService.prisma.gscTotalsDaily.findFirst({
    where: { siteUrl, searchType },
    select: { date: true },
    orderBy: { date: 'desc' }
  });
  return {
    start: first?.date ? first.date.toISOString().slice(0,10) : null,
    end: last?.date ? last.date.toISOString().slice(0,10) : null,
  };
}

async function groupByDimFromDb(model, key, siteUrl, searchType, range, startRowNum, rowLimitNum) {
  const start = parseIso(range.startDate);
  const end = parseIso(range.endDate);
  const rows = await databaseService.prisma[model].findMany({
    where: { siteUrl, searchType, date: { gte: start, lte: end } },
    select: { [key]: true, clicks: true, impressions: true, ctr: true, position: true },
  });
  const aggMap = new Map();
  for (const r of rows) {
    const k = r[key] || '';
    const prev = aggMap.get(k) || { clicks: 0, impressions: 0, posNum: 0 };
    const clicks = (r.clicks || 0);
    const impr = (r.impressions || 0);
    prev.clicks += clicks;
    prev.impressions += impr;
    prev.posNum += (r.position || 0) * impr;
    aggMap.set(k, prev);
  }
  const agg = Array.from(aggMap.entries()).map(([k, v]) => ({
    [key]: k,
    clicks: v.clicks,
    impressions: v.impressions,
    ctr: v.impressions > 0 ? (v.clicks / v.impressions) : 0,
    position: v.impressions > 0 ? (v.posNum / v.impressions) : 0,
  }));
  agg.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
  const startRow = Math.max(0, Number(startRowNum) || 0);
  const limit = Math.max(1, Math.min(25000, Number(rowLimitNum) || 1000));
  return agg.slice(startRow, startRow + limit);
}

async function ensureRegisteredProperty(userId, siteUrl, opts = {}) {
  try {
    const now = new Date();
    await databaseService.prisma.gscUserProperty.upsert({
      where: { userId_siteUrl: { userId, siteUrl } },
      update: { enabled: opts.enabled ?? true, priorityOrder: opts.priorityOrder ?? 0, syncIntervalHours: opts.syncIntervalHours ?? 24, nextSyncDueAt: now },
      create: { userId, siteUrl, enabled: opts.enabled ?? true, priorityOrder: opts.priorityOrder ?? 0, syncIntervalHours: opts.syncIntervalHours ?? 24, nextSyncDueAt: now },
    });
  } catch (e) { /* ignore */ }
}

async function respondNotReady(req, res, siteUrl, searchType) {
  await ensureRegisteredProperty(req.user.id, siteUrl);
  try { gscScheduler.tick().catch(()=>{}); } catch (_) {}
  const prop = await databaseService.prisma.gscUserProperty.findUnique({ where: { userId_siteUrl: { userId: req.user.id, siteUrl } } }).catch(()=>null);
  return res.status(202).json({ success: false, error: 'NotReady', message: 'Data sync in progress', siteUrl, searchType, nextSyncDueAt: prop?.nextSyncDueAt || null });
}

// GET /api/gsc/connect - Initiate OAuth flow
router.get('/connect', requireAuth, async (req, res) => {
  try {
    const oauth2Client = gscAuth.getOAuth2Client();
    const scopes = [ 'openid', 'email', 'profile', 'https://www.googleapis.com/auth/webmasters' ];
    const url = oauth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
    res.json({ success: true, authUrl: url });
  } catch (err) {
    logger.error('GSC connect error:', err.message);
    res.status(500).json({ error: 'OAuthInitError', message: err.message });
  }
});

// GET /api/gsc/callback - OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'MissingCode', message: 'Missing OAuth code' });
    const oauth2Client = gscAuth.getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    try {
      const appToken = req.cookies?.token;
      if (appToken) {
        const decoded = jwt.verify(appToken, process.env.SESSION_SECRET || 'your-secret-key-change-in-production');
        if (decoded?.userId) {
          await gscAuth.saveUserTokens(decoded.userId, tokens);
          return res.redirect('/dashboard');
        }
      }
    } catch (_) {}
    try { await gscAuth.saveUserTokens(1, tokens); } catch (_) {}
    res.cookie('gsc_tokens', JSON.stringify(tokens), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 10 * 60 * 1000 });
    return res.redirect('/dashboard');
  } catch (err) {
    logger.error('GSC callback error:', err.message);
    res.status(500).json({ error: 'OAuthCallbackError', message: err.message });
  }
});

// POST /api/gsc/url/inspect { url }
router.post('/url/inspect', requireAuth, async (req, res) => {
  try {
    const { oauth2Client, selected } = await ensureGscContext(req);
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'BadRequest', message: 'url is required' });
    const searchconsole = google.searchconsole({ version: 'v1', auth: oauth2Client });
    const resp = await searchconsole.urlInspection.index.inspect({ requestBody: { inspectionUrl: url, siteUrl: selected } });
    const result = resp.data?.inspectionResult || {};
    res.json({ success: true, result });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC URL inspect error:', apiMsg || err.message);
    res.status(500).json({ error: 'UrlInspectError', message: apiMsg || err.message });
  }
});

// POST /api/gsc/bind - Bind tokens from cookie to the current authenticated user
router.post('/bind', requireAuth, async (req, res) => {
  try {
    const raw = req.cookies?.gsc_tokens;
    if (!raw) return res.status(400).json({ error: 'NoTokens', message: 'No OAuth tokens to bind' });
    const tokens = JSON.parse(raw);
    await gscAuth.saveUserTokens(req.user.id, tokens);
    res.clearCookie('gsc_tokens');
    res.json({ success: true });
  } catch (err) {
    logger.error('GSC bind error:', err.message);
    res.status(500).json({ error: 'BindError', message: err.message });
  }
});

// GET /api/gsc/properties - List verified properties for the connected account
router.get('/properties', requireAuth, async (req, res) => {
  try {
    const row = await gscAuth.getUserTokens(req.user.id);
    if (!row || (!row.accessToken && !row.refreshToken)) return res.status(401).json({ error: 'NotConnected', message: 'Connect Google first' });
    const oauth2Client = gscAuth.getOAuth2Client();
    const creds = {};
    if (row.accessToken) creds.access_token = row.accessToken;
    if (row.refreshToken) creds.refresh_token = row.refreshToken;
    if (row.expiryDate) creds.expiry_date = new Date(row.expiryDate).getTime();
    oauth2Client.setCredentials(creds);
    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
    const resp = await webmasters.sites.list();
    const sites = (resp.data.siteEntry || [])
      .filter(s => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser')
      .map(s => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
      .sort((a,b)=> String(a.siteUrl).localeCompare(String(b.siteUrl), undefined, { sensitivity:'base' }));

    // Auto-register all listed properties for background syncing (create if missing)
    try {
      const now = new Date();
      for (let i=0;i<sites.length;i++) {
        const s = sites[i];
        const exists = await databaseService.prisma.gscUserProperty.findUnique({ where: { userId_siteUrl: { userId: req.user.id, siteUrl: s.siteUrl } } });
        if (!exists) {
          await databaseService.prisma.gscUserProperty.create({ data: { userId: req.user.id, siteUrl: s.siteUrl, enabled: true, priorityOrder: i, syncIntervalHours: 24, nextSyncDueAt: now } });
        } else if (exists.priorityOrder !== i) {
          // Update priority to alphabetical index but avoid rescheduling
          await databaseService.prisma.gscUserProperty.update({ where: { id: exists.id }, data: { priorityOrder: i } });
        }
      }
    } catch (e) {
      logger.warn('Auto-register properties failed:', e.message);
    }
    res.json({ success: true, properties: sites });
  } catch (err) {
    logger.error('GSC properties error:', err.message);
    res.status(500).json({ error: 'PropertiesError', message: err.message });
  }
});

module.exports = router;

// Additional endpoints: selected property & analytics

// GET /api/gsc/selected - get currently selected property
router.get('/selected', requireAuth, async (req, res) => {
  try {
    let selected = await gscAuth.getUserSelection(req.user.id);
    // If not set yet, try to default to the first accessible property
    if (!selected) {
      const row = await gscAuth.getUserTokens(req.user.id);
      if (row && (row.accessToken || row.refreshToken)) {
        const oauth2Client = gscAuth.getOAuth2Client();
        const creds = {};
        if (row.accessToken) creds.access_token = row.accessToken;
        if (row.refreshToken) creds.refresh_token = row.refreshToken;
        if (row.expiryDate) creds.expiry_date = new Date(row.expiryDate).getTime();
        oauth2Client.setCredentials(creds);
        const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
        const resp = await webmasters.sites.list();
        const first = (resp.data.siteEntry || [])
          .filter(s => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser')
          .map(s => s.siteUrl)[0];
        if (first) {
          await gscAuth.setUserSelection(req.user.id, first);
          selected = first;
        }
      }
    }
    res.json({ success: true, selected: selected || null });
  } catch (err) {
    logger.error('GSC selected get error:', err.message);
    res.status(500).json({ error: 'SelectedGetError', message: err.message });
  }
});

// POST /api/gsc/selected - set selected property { siteUrl }
router.post('/selected', requireAuth, async (req, res) => {
  try {
    const row = await gscAuth.getUserTokens(req.user.id);
    if (!row || (!row.accessToken && !row.refreshToken)) {
      return res.status(401).json({ error: 'NotConnected', message: 'Connect Google first' });
    }
    const { siteUrl } = req.body || {};
    if (!siteUrl) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });

    const oauth2Client = gscAuth.getOAuth2Client();
    const creds = {};
    if (row.accessToken) creds.access_token = row.accessToken;
    if (row.refreshToken) creds.refresh_token = row.refreshToken;
    if (row.expiryDate) creds.expiry_date = new Date(row.expiryDate).getTime();
    oauth2Client.setCredentials(creds);
    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
    const resp = await webmasters.sites.list();
    const sites = (resp.data.siteEntry || [])
      .filter(s => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser')
      .map(s => s.siteUrl);
    if (!sites.includes(siteUrl)) {
      return res.status(400).json({ error: 'InvalidProperty', message: 'Property not accessible for this account' });
    }
    await gscAuth.setUserSelection(req.user.id, siteUrl);
    res.json({ success: true, selected: siteUrl });
  } catch (err) {
    logger.error('GSC selected set error:', err.message);
    res.status(500).json({ error: 'SelectedSetError', message: err.message });
  }
});

// GET /api/gsc/analytics/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/analytics/summary', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, searchType, siteUrl: siteParam } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const site = siteParam || await gscAuth.getUserSelection(req.user.id);
    if (!site) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });
    // Prefer DB whenever coverage overlaps the requested range.
    const coverage = await getCoverageFromDb(site, st);
    if (coverage && coverage.start && coverage.end) {
      const effEnd = (new Date(coverage.end) < new Date(range.endDate)) ? coverage.end : range.endDate;
      if (new Date(effEnd) >= new Date(range.startDate)) {
        const effRange = { startDate: range.startDate, endDate: effEnd };
        const { totals, daily } = await getSummaryFromDb(site, st, effRange);
        return res.json({ success: true, property: site, totals, daily, source: 'db', coverage });
      }
    }
    if (process.env.GSC_DB_ONLY === 'true') {
      return respondNotReady(req, res, site, st);
    }
    // Fallback to live API (requires Google context)
    const { oauth2Client } = await ensureGscContext(req);
    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
    const totalsResp = await webmasters.searchanalytics.query({
      siteUrl: site,
      requestBody: { startDate: range.startDate, endDate: range.endDate, searchType: st, dataState: 'all', rowLimit: 1 }
    });
    const totalsRow = (totalsResp.data.rows && totalsResp.data.rows[0]) || {};
    const totals = { clicks: Number(totalsRow.clicks || 0), impressions: Number(totalsRow.impressions || 0), ctr: Number(totalsRow.ctr || 0), position: Number(totalsRow.position || 0) };
    const dailyResp = await webmasters.searchanalytics.query({
      siteUrl: site,
      requestBody: { startDate: range.startDate, endDate: range.endDate, searchType: st, dataState: 'all', dimensions: ['date'], rowLimit: 5000 }
    });
    const daily = (dailyResp.data.rows || []).map(r => ({ date: r.keys && r.keys[0], clicks: Number(r.clicks || 0), impressions: Number(r.impressions || 0), ctr: Number(r.ctr || 0), position: Number(r.position || 0) }));
    res.json({ success: true, property: site, totals, daily, source: 'live' });
  } catch (err) {
    logger.error('GSC analytics summary error:', err.message);
    res.status(500).json({ error: 'AnalyticsSummaryError', message: err.message });
  }
});

// GET /api/gsc/coverage?searchType=web
router.get('/coverage', requireAuth, async (req, res) => {
  try {
    // Coverage is derived from our DB; it does not require Google API or a selected property.
    // Respect explicit siteUrl if provided, otherwise fall back to the user's selected property.
    const st = getSearchType(req.query.searchType);
    let siteUrl = req.query.siteUrl;
    if (!siteUrl) {
      siteUrl = await gscAuth.getUserSelection(req.user.id);
      if (!siteUrl) {
        return res.json({ success: true, coverage: null });
      }
    }
    const coverage = await getCoverageFromDb(siteUrl, st);
    return res.json({ success: true, coverage });
  } catch (err) {
    logger.error('GSC coverage error:', err.message);
    res.status(500).json({ error: 'CoverageError', message: err.message });
  }
});

// Generic helper to run a Search Analytics query
async function runSaQuery(oauth2Client, selected, body) {
  const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
  const resp = await webmasters.searchanalytics.query({
    siteUrl: selected,
    requestBody: body,
  });
  const rows = resp.data.rows || [];
  return rows;
}

// GET /api/gsc/analytics/pages
router.get('/analytics/pages', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, rowLimit = 1000, startRow = 0, searchType, siteUrl: siteParam } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const site = siteParam || await gscAuth.getUserSelection(req.user.id);
    if (!site) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });
    // Prefer DB
    if (await isCovered(site, st, 'page', range.endDate)) {
      const data = await groupByDimFromDb('gscPagesDaily', 'page', site, st, range, startRow, rowLimit);
      return res.json({ success: true, range, data, source: 'db' });
    }
    if (process.env.GSC_DB_ONLY === 'true') {
      return respondNotReady(req, res, site, st);
    }
    const { oauth2Client } = await ensureGscContext(req);
    const rows = await runSaQuery(oauth2Client, site, { startDate: range.startDate, endDate: range.endDate, searchType: st, dataState: 'all', dimensions: ['page'], rowLimit: Number(rowLimit), startRow: Number(startRow) });
    const data = rows.map(r => ({ page: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data, source: 'live' });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC pages error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'PagesError', message: apiMsg || err.message });
  }
});

// GET /api/gsc/analytics/queries
router.get('/analytics/queries', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, rowLimit = 1000, startRow = 0, searchType, siteUrl: siteParam } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const site = siteParam || await gscAuth.getUserSelection(req.user.id);
    if (!site) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });
    if (await isCovered(site, st, 'query', range.endDate)) {
      const data = await groupByDimFromDb('gscQueriesDaily', 'query', site, st, range, startRow, rowLimit);
      return res.json({ success: true, range, data, source: 'db' });
    }
    if (process.env.GSC_DB_ONLY === 'true') {
      return respondNotReady(req, res, site, st);
    }
    const { oauth2Client } = await ensureGscContext(req);
    const rows = await runSaQuery(oauth2Client, site, { startDate: range.startDate, endDate: range.endDate, searchType: st, dataState: 'all', dimensions: ['query'], rowLimit: Number(rowLimit), startRow: Number(startRow) });
    const data = rows.map(r => ({ query: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data, source: 'live' });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC queries error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'QueriesError', message: apiMsg || err.message });
  }
});

// GET /api/gsc/analytics/page-queries?page=URL
router.get('/analytics/page-queries', requireAuth, async (req, res) => {
  try {
    const { oauth2Client, selected } = await ensureGscContext(req);
    const { startDate, endDate, page, rowLimit = 1000, startRow = 0, searchType } = req.query;
    if (!page) return res.status(400).json({ error: 'BadRequest', message: 'page is required' });
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const rows = await runSaQuery(oauth2Client, selected, {
      startDate: range.startDate,
      endDate: range.endDate,
      searchType: st,
      dataState: 'all',
      dimensions: ['query'],
      dimensionFilterGroups: [{
        filters: [{ dimension: 'page', operator: 'equals', expression: page }]
      }],
      rowLimit: Number(rowLimit),
      startRow: Number(startRow),
    });
    const data = rows.map(r => ({ query: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, page, data });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC page-queries error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'PageQueriesError', message: apiMsg || err.message });
  }
});

// GET /api/gsc/analytics/device
router.get('/analytics/device', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, rowLimit = 1000, startRow = 0, searchType, siteUrl: siteParam } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const site = siteParam || await gscAuth.getUserSelection(req.user.id);
    if (!site) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });
    if (await isCovered(site, st, 'device', range.endDate)) {
      const data = await groupByDimFromDb('gscDeviceDaily', 'device', site, st, range, startRow, rowLimit);
      return res.json({ success: true, range, data, source: 'db' });
    }
    if (process.env.GSC_DB_ONLY === 'true') {
      return respondNotReady(req, res, site, st);
    }
    const { oauth2Client } = await ensureGscContext(req);
    const rows = await runSaQuery(oauth2Client, site, { startDate: range.startDate, endDate: range.endDate, searchType: st, dataState: 'all', dimensions: ['device'], rowLimit: Number(rowLimit), startRow: Number(startRow) });
    const data = rows.map(r => ({ device: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data, source: 'live' });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC device error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'DeviceError', message: apiMsg || err.message });
  }
});

// GET /api/gsc/analytics/country
router.get('/analytics/country', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, rowLimit = 250, startRow = 0, searchType, siteUrl: siteParam } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const site = siteParam || await gscAuth.getUserSelection(req.user.id);
    if (!site) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });
    if (await isCovered(site, st, 'country', range.endDate)) {
      const data = await groupByDimFromDb('gscCountryDaily', 'country', site, st, range, startRow, rowLimit);
      return res.json({ success: true, range, data, source: 'db' });
    }
    if (process.env.GSC_DB_ONLY === 'true') {
      return respondNotReady(req, res, site, st);
    }
    const { oauth2Client } = await ensureGscContext(req);
    const rows = await runSaQuery(oauth2Client, site, { startDate: range.startDate, endDate: range.endDate, searchType: st, dataState: 'all', dimensions: ['country'], rowLimit: Number(rowLimit), startRow: Number(startRow) });
    const data = rows.map(r => ({ country: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data, source: 'live' });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC country error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'CountryError', message: apiMsg || err.message });
  }
});

// GET /api/gsc/analytics/appearance
router.get('/analytics/appearance', requireAuth, async (req, res) => {
  try {
    const { oauth2Client, selected } = await ensureGscContext(req);
    const { startDate, endDate, rowLimit = 1000, startRow = 0, searchType } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    if (process.env.GSC_DB_ONLY === 'true') {
      return respondNotReady(req, res, selected, getSearchType(searchType));
    }
    const rows = await runSaQuery(oauth2Client, selected, {
      startDate: range.startDate,
      endDate: range.endDate,
      searchType: st,
      dataState: 'all',
      dimensions: ['searchAppearance'],
      rowLimit: Number(rowLimit),
      startRow: Number(startRow),
    });
    const data = rows.map(r => ({ appearance: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC appearance error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'AppearanceError', message: apiMsg || err.message });
  }
});

// Sitemaps
router.get('/sitemaps', requireAuth, async (req, res) => {
  try {
    // Admin override: allow specifying siteUrl and/or userId to inspect another user's property
    const siteUrlOverride = req.query.siteUrl;
    const userIdOverride = req.query.userId ? Number(req.query.userId) : undefined;
    let selected = null;
    let oauth2Client = null;
    if (userIdOverride && userIdOverride !== req.user.id) {
      // Verify admin role before impersonating
      const me = await databaseService.prisma.user.findUnique({ where: { id: req.user.id } }).catch(()=>null);
      if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Forbidden', message: 'Admin only' });
      const ctx = await ensureGscContext(req, userIdOverride);
      oauth2Client = ctx.oauth2Client;
      selected = siteUrlOverride || ctx.selected;
    } else {
      const ctx = await ensureGscContext(req);
      oauth2Client = ctx.oauth2Client;
      selected = siteUrlOverride || ctx.selected;
    }
    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
    const resp = await webmasters.sitemaps.list({ siteUrl: selected });
    const sitemaps = (resp.data.sitemap || resp.data.sitemap || resp.data.sitemaps || resp.data)?.sitemap || resp.data?.sitemap || resp.data?.items || [];
    // Normalize
    const list = (resp.data.sitemap || resp.data.items || []).map(s => ({
      path: s.path,
      isIndex: !!s.isSitemapsIndex,
      lastSubmitted: s.lastSubmitted,
      lastDownloaded: s.lastDownloaded,
      warnings: s.warnings || 0,
      errors: s.errors || 0,
      contents: s.contents || []
    }));
    res.json({ success: true, sitemaps: list });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC sitemaps list error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'SitemapsListError', message: apiMsg || err.message });
  }
});

router.post('/sitemaps/submit', requireAuth, async (req, res) => {
  try {
    const siteUrlOverride = req.query.siteUrl;
    const userIdOverride = req.query.userId ? Number(req.query.userId) : undefined;
    let selected = null;
    let oauth2Client = null;
    if (userIdOverride && userIdOverride !== req.user.id) {
      const me = await databaseService.prisma.user.findUnique({ where: { id: req.user.id } }).catch(()=>null);
      if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Forbidden', message: 'Admin only' });
      const ctx = await ensureGscContext(req, userIdOverride);
      oauth2Client = ctx.oauth2Client;
      selected = siteUrlOverride || ctx.selected;
    } else {
      const ctx = await ensureGscContext(req);
      oauth2Client = ctx.oauth2Client;
      selected = siteUrlOverride || ctx.selected;
    }
    const { sitemapUrl } = req.body || {};
    if (!sitemapUrl) return res.status(400).json({ error: 'BadRequest', message: 'sitemapUrl is required' });
    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
    await webmasters.sitemaps.submit({ siteUrl: selected, feedpath: sitemapUrl });
    res.json({ success: true });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC sitemaps submit error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'SitemapsSubmitError', message: apiMsg || err.message });
  }
});

// POST /api/gsc/backfill { startDate?, endDate?, searchTypes? }
router.post('/backfill', requireAuth, async (req, res) => {
  try {
    const { oauth2Client, selected } = await ensureGscContext(req);
    const { startDate, endDate, searchTypes } = req.body || {};

    await gscIngest.backfillProperty(oauth2Client, selected, {
      startDate,
      endDate,
      searchTypes: Array.isArray(searchTypes) && searchTypes.length
        ? searchTypes
        : ['web', 'image', 'video']
    });

    res.json({ success: true, message: 'Backfill completed' });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC backfill error:', apiMsg || err.message);
    res.status(500).json({ error: 'BackfillError', message: apiMsg || err.message });
  }
});

// GET /api/gsc/sync-status?siteUrl=...
router.get('/sync-status', requireAuth, async (req, res) => {
  try {
    let siteUrl = req.query.siteUrl;
    if (!siteUrl) {
      const { selected } = await ensureGscContext(req);
      siteUrl = selected;
    }
    const rows = await gscIngest.getSyncStatus(siteUrl);
    res.json({ success: true, siteUrl, status: rows });
  } catch (err) {
    logger.error('GSC sync-status error:', err.message);
    res.status(500).json({ error: 'SyncStatusError', message: err.message });
  }
});

// Scheduler tick endpoint (stateless) – safe to call from Vercel Cron
router.get('/scheduler/tick', async (req, res) => {
  try {
    await gscScheduler.tick();
    res.json({ success: true, message: 'Tick executed' });
  } catch (err) {
    logger.error('Scheduler tick error:', err.message);
    res.status(500).json({ error: 'SchedulerTickError', message: err.message });
  }
});

// Register a property for background syncing
router.post('/sync/register', requireAuth, async (req, res) => {
  try {
    const { siteUrl, priorityOrder = 0, syncIntervalHours = 24, enabled = true, userId: overrideUserId } = req.body || {};
    if (!siteUrl) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });
    // Admin can register on behalf of another user by providing userId
    let ownerUserId = req.user.id;
    if (overrideUserId && Number(overrideUserId) !== req.user.id) {
      const me = await databaseService.prisma.user.findUnique({ where: { id: req.user.id } }).catch(()=>null);
      if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Forbidden', message: 'Admin only' });
      ownerUserId = Number(overrideUserId);
    }
    await databaseService.prisma.gscUserProperty.upsert({
      where: { userId_siteUrl: { userId: ownerUserId, siteUrl } },
      update: { enabled, priorityOrder, syncIntervalHours, nextSyncDueAt: new Date() },
      create: { userId: ownerUserId, siteUrl, enabled, priorityOrder, syncIntervalHours, nextSyncDueAt: new Date() },
    });
    try { gscScheduler.tick().catch(()=>{}); } catch (_) {}
    res.json({ success: true });
  } catch (err) {
    logger.error('GSC sync register error:', err.message);
    res.status(500).json({ error: 'SyncRegisterError', message: err.message });
  }
});

// List registered properties
router.get('/sync/properties', requireAuth, async (req, res) => {
  try {
    // Determine caller role
    const me = await databaseService.prisma.user.findUnique({ where: { id: req.user.id } }).catch(()=>null);
    const isAdmin = !!me && me.role === 'admin';
    const rows = await databaseService.prisma.gscUserProperty.findMany({
      where: isAdmin ? {} : { userId: req.user.id },
      orderBy: [ { priorityOrder: 'asc' } ]
    });
    // Attach owner info for admin view
    let properties = rows;
    if (isAdmin) {
      const userIds = Array.from(new Set(rows.map(r => r.userId)));
      const users = await databaseService.prisma.user.findMany({ where: { id: { in: userIds } } });
      const idToUser = new Map(users.map(u => [u.id, u]));
      properties = rows.map(r => ({
        ...r,
        owner: (() => { const u = idToUser.get(r.userId); return u ? { id: u.id, email: u.email, username: u.username } : null; })()
      }));
    }
    res.json({ success: true, properties, isAdmin });
  } catch (err) {
    logger.error('GSC sync properties error:', err.message);
    res.status(500).json({ error: 'SyncPropertiesError', message: err.message });
  }
});

