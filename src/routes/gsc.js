const express = require('express');
const { google } = require('googleapis');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// In-memory stores (replace with DB persistence later)
const userIdToGscTokens = new Map();
const userIdToSelectedProperty = new Map();

const getOAuth2Client = () => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth env vars are not configured');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
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
    const tokens = userIdToGscTokens.get(req.user.id);
    if (!tokens) return res.status(401).json({ error: 'NotConnected', message: 'Connect Google first' });
    const selected = userIdToSelectedProperty.get(req.user.id);
    if (!selected) return res.status(400).json({ error: 'NoProperty', message: 'Select a property first' });

    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'BadRequest', message: 'url is required' });

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);
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
    userIdToGscTokens.set(req.user.id, tokens);
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
    const selected = userIdToSelectedProperty.get(req.user.id) || null;
    res.json({ success: true, selected });
  } catch (err) {
    logger.error('GSC selected get error:', err.message);
    res.status(500).json({ error: 'SelectedGetError', message: err.message });
  }
});

// POST /api/gsc/selected - set selected property { siteUrl }
router.post('/selected', requireAuth, async (req, res) => {
  try {
    const tokens = userIdToGscTokens.get(req.user.id);
    if (!tokens) return res.status(401).json({ error: 'NotConnected', message: 'Connect Google first' });
    const { siteUrl } = req.body || {};
    if (!siteUrl) return res.status(400).json({ error: 'BadRequest', message: 'siteUrl is required' });

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);
    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });
    const resp = await webmasters.sites.list();
    const sites = (resp.data.siteEntry || [])
      .filter(s => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser')
      .map(s => s.siteUrl);
    if (!sites.includes(siteUrl)) {
      return res.status(400).json({ error: 'InvalidProperty', message: 'Property not accessible for this account' });
    }
    userIdToSelectedProperty.set(req.user.id, siteUrl);
    res.json({ success: true, selected: siteUrl });
  } catch (err) {
    logger.error('GSC selected set error:', err.message);
    res.status(500).json({ error: 'SelectedSetError', message: err.message });
  }
});

// GET /api/gsc/analytics/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/analytics/summary', requireAuth, async (req, res) => {
  try {
    const tokens = userIdToGscTokens.get(req.user.id);
    if (!tokens) return res.status(401).json({ error: 'NotConnected', message: 'Connect Google first' });
    const selected = userIdToSelectedProperty.get(req.user.id);
    if (!selected) return res.status(400).json({ error: 'NoProperty', message: 'Select a property first' });

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'BadRequest', message: 'startDate and endDate are required (YYYY-MM-DD)' });
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(tokens);
    const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });

    // Totals
    const totalsResp = await webmasters.searchanalytics.query({
      siteUrl: selected,
      requestBody: {
        startDate,
        endDate,
        searchType: 'web',
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
        startDate,
        endDate,
        searchType: 'web',
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


