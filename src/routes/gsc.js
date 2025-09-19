const express = require('express');
const { google } = require('googleapis');
const gscIngest = require('../services/gscIngest');
const databaseService = require('../services/database');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Helper: load and persist tokens & selection in DB
async function getUserTokens(userId) {
  try {
    const row = await databaseService.prisma.gscOAuthToken.findUnique({ where: { userId } });
    return row || null;
  } catch (_) { return null; }
}

async function saveUserTokens(userId, tokens) {
  const existing = await databaseService.prisma.gscOAuthToken.findUnique({ where: { userId } }).catch(()=>null);
  const refreshToken = tokens.refresh_token || existing?.refreshToken || null;
  const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : (existing?.expiryDate || null);
  const data = {
    userId,
    accessToken: tokens.access_token || null,
    refreshToken,
    scope: tokens.scope || existing?.scope || null,
    tokenType: tokens.token_type || existing?.tokenType || null,
    expiryDate,
  };
  await databaseService.prisma.gscOAuthToken.upsert({
    where: { userId },
    update: data,
    create: data,
  });
}

async function getUserSelection(userId) {
  try {
    const row = await databaseService.prisma.gscUserSelection.findUnique({ where: { userId } });
    return row?.siteUrl || null;
  } catch (_) { return null; }
}

async function setUserSelection(userId, siteUrl) {
  await databaseService.prisma.gscUserSelection.upsert({
    where: { userId },
    update: { siteUrl },
    create: { userId, siteUrl },
  });
}

const getOAuth2Client = () => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth env vars are not configured');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

const ensureGscContext = async (req) => {
  const row = await getUserTokens(req.user.id);
  const selected = await getUserSelection(req.user.id);
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
  const oauth2Client = getOAuth2Client();
  const creds = {};
  if (row.accessToken) creds.access_token = row.accessToken;
  if (row.refreshToken) creds.refresh_token = row.refreshToken;
  if (row.expiryDate) creds.expiry_date = new Date(row.expiryDate).getTime();
  oauth2Client.setCredentials(creds);
  oauth2Client.on('tokens', async (t) => {
    try { await saveUserTokens(req.user.id, t); } catch (_) {}
  });
  return { oauth2Client, selected };
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

// GET /api/gsc/connect - Initiate OAuth flow
router.get('/connect', requireAuth, async (req, res) => {
  try {
    const oauth2Client = getOAuth2Client();
    const scopes = [
      'openid',
      'email',
      'profile',
      // Use full scope to support URL Inspection API
      'https://www.googleapis.com/auth/webmasters'
    ];
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
    });
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
    if (!code) {
      return res.status(400).json({ error: 'MissingCode', message: 'Missing OAuth code' });
    }
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    // Temporarily store tokens in a short-lived cookie, to be bound to the user session in /bind
    res.cookie('gsc_tokens', JSON.stringify(tokens), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });
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

    // Use URL Inspection API
    const resp = await searchconsole.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: url,
        siteUrl: selected
      }
    });

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
    if (!raw) {
      return res.status(400).json({ error: 'NoTokens', message: 'No OAuth tokens to bind' });
    }
    const tokens = JSON.parse(raw);
    await saveUserTokens(req.user.id, tokens);
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
    const tokens = userIdToGscTokens.get(req.user.id);
    if (!tokens) return res.status(401).json({ error: 'NotConnected', message: 'Connect Google first' });
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);
    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
    const resp = await webmasters.sites.list();
    const sites = (resp.data.siteEntry || [])
      .filter(s => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser')
      .map(s => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
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
    const selected = await getUserSelection(req.user.id);
    res.json({ success: true, selected });
  } catch (err) {
    logger.error('GSC selected get error:', err.message);
    res.status(500).json({ error: 'SelectedGetError', message: err.message });
  }
});

// POST /api/gsc/selected - set selected property { siteUrl }
router.post('/selected', requireAuth, async (req, res) => {
  try {
    const row = await getUserTokens(req.user.id);
    if (!row || (!row.accessToken && !row.refreshToken)) {
      return res.status(401).json({ error: 'NotConnected', message: 'Connect Google first' });
    }
    const { siteUrl } = req.body || {};
    if (!siteUrl) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });

    const oauth2Client = getOAuth2Client();
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
    await setUserSelection(req.user.id, siteUrl);
    res.json({ success: true, selected: siteUrl });
  } catch (err) {
    logger.error('GSC selected set error:', err.message);
    res.status(500).json({ error: 'SelectedSetError', message: err.message });
  }
});

// GET /api/gsc/analytics/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/analytics/summary', requireAuth, async (req, res) => {
  try {
    const { oauth2Client, selected } = await ensureGscContext(req);

    const { startDate, endDate, searchType } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);

    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });

    // Totals
    const totalsResp = await webmasters.searchanalytics.query({
      siteUrl: selected,
      requestBody: {
        startDate: range.startDate,
        endDate: range.endDate,
        searchType: st,
        dataState: 'all',
        rowLimit: 1
      }
    });
    const totalsRow = (totalsResp.data.rows && totalsResp.data.rows[0]) || {};
    const totals = {
      clicks: Number(totalsRow.clicks || 0),
      impressions: Number(totalsRow.impressions || 0),
      ctr: Number(totalsRow.ctr || 0),
      position: Number(totalsRow.position || 0),
    };

    // Daily series
    const dailyResp = await webmasters.searchanalytics.query({
      siteUrl: selected,
      requestBody: {
        startDate: range.startDate,
        endDate: range.endDate,
        searchType: st,
        dataState: 'all',
        dimensions: ['date'],
        rowLimit: 5000
      }
    });
    const daily = (dailyResp.data.rows || []).map(r => ({
      date: r.keys && r.keys[0],
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
      ctr: Number(r.ctr || 0),
      position: Number(r.position || 0),
    }));

    res.json({ success: true, property: selected, totals, daily });
  } catch (err) {
    logger.error('GSC analytics summary error:', err.message);
    res.status(500).json({ error: 'AnalyticsSummaryError', message: err.message });
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
    const { oauth2Client, selected } = await ensureGscContext(req);
    const { startDate, endDate, rowLimit = 1000, startRow = 0, searchType } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const rows = await runSaQuery(oauth2Client, selected, {
      startDate: range.startDate,
      endDate: range.endDate,
      searchType: st,
      dataState: 'all',
      dimensions: ['page'],
      rowLimit: Number(rowLimit),
      startRow: Number(startRow),
    });
    const data = rows.map(r => ({ page: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC pages error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'PagesError', message: apiMsg || err.message });
  }
});

// GET /api/gsc/analytics/queries
router.get('/analytics/queries', requireAuth, async (req, res) => {
  try {
    const { oauth2Client, selected } = await ensureGscContext(req);
    const { startDate, endDate, rowLimit = 1000, startRow = 0, searchType } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const rows = await runSaQuery(oauth2Client, selected, {
      startDate: range.startDate,
      endDate: range.endDate,
      searchType: st,
      dataState: 'all',
      dimensions: ['query'],
      rowLimit: Number(rowLimit),
      startRow: Number(startRow),
    });
    const data = rows.map(r => ({ query: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data });
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
    const { oauth2Client, selected } = await ensureGscContext(req);
    const { startDate, endDate, rowLimit = 1000, startRow = 0, searchType } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const rows = await runSaQuery(oauth2Client, selected, {
      startDate: range.startDate,
      endDate: range.endDate,
      searchType: st,
      dataState: 'all',
      dimensions: ['device'],
      rowLimit: Number(rowLimit),
      startRow: Number(startRow),
    });
    const data = rows.map(r => ({ device: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data });
  } catch (err) {
    const apiMsg = err?.response?.data?.error?.message;
    logger.error('GSC device error:', apiMsg || err.message);
    res.status(err.status || 500).json({ error: 'DeviceError', message: apiMsg || err.message });
  }
});

// GET /api/gsc/analytics/country
router.get('/analytics/country', requireAuth, async (req, res) => {
  try {
    const { oauth2Client, selected } = await ensureGscContext(req);
    const { startDate, endDate, rowLimit = 250, startRow = 0, searchType } = req.query;
    const range = getDefaultRange(startDate, endDate);
    const st = getSearchType(searchType);
    const rows = await runSaQuery(oauth2Client, selected, {
      startDate: range.startDate,
      endDate: range.endDate,
      searchType: st,
      dataState: 'all',
      dimensions: ['country'],
      rowLimit: Number(rowLimit),
      startRow: Number(startRow),
    });
    const data = rows.map(r => ({ country: r.keys?.[0], clicks: r.clicks||0, impressions: r.impressions||0, ctr: r.ctr||0, position: r.position||0 }));
    res.json({ success: true, range, data });
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
    const { oauth2Client, selected } = await ensureGscContext(req);
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
    const { oauth2Client, selected } = await ensureGscContext(req);
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
    const { oauth2Client, selected } = ensureGscContext(req);
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
      const { selected } = ensureGscContext(req);
      siteUrl = selected;
    }
    const rows = await gscIngest.getSyncStatus(siteUrl);
    res.json({ success: true, siteUrl, status: rows });
  } catch (err) {
    logger.error('GSC sync-status error:', err.message);
    res.status(500).json({ error: 'SyncStatusError', message: err.message });
  }
});

