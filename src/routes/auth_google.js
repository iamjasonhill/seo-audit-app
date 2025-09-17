const express = require('express');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const router = express.Router();

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_LOGIN_REDIRECT_URI; // e.g., http://localhost:3000/api/auth/google/callback
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth env vars not configured for login');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// GET /api/auth/google/connect
router.get('/connect', async (req, res) => {
  try {
    const oauth2 = getOAuth2Client();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['openid', 'email', 'profile'],
    });
    res.json({ success: true, authUrl: url });
  } catch (e) {
    logger.error('Google login connect error:', e.message);
    res.status(500).json({ error: 'OAuthInitError', message: e.message });
  }
});

// GET /api/auth/google/callback
router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'MissingCode', message: 'Missing OAuth code' });
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const info = await oauth2Api.userinfo.get();
    const email = info?.data?.email || '';
    const verified = !!info?.data?.verified_email;

    const allowed = (process.env.ADMIN_GOOGLE_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!verified || !allowed.includes(email.toLowerCase())) {
      logger.warn('Google login rejected for email:', email);
      return res.status(401).json({ error: 'Unauthorized', message: 'Email not permitted' });
    }

    // Mint JWT for the existing admin user (id:1)
    const token = jwt.sign(
      { userId: 1, username: 'admin', role: 'admin' },
      process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '24h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    return res.redirect('/dashboard');
  } catch (e) {
    logger.error('Google login callback error:', e.message);
    res.status(500).json({ error: 'OAuthCallbackError', message: e.message });
  }
});

module.exports = router;


