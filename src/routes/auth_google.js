const express = require('express');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const databaseService = require('../services/database');

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

    if (!verified || !email) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Google account not verified' });
    }

    // Only allow existing active users; update profile but don't auto-create new ones
    const existing = await databaseService.prisma.user.findUnique({ where: { email } });
    if (!existing || existing.status !== 'active') {
      logger.warn('Login blocked for non-registered or inactive user:', email);
      return res.status(401).json({ error: 'Unauthorized', message: 'This account is not enabled. Contact the administrator.' });
    }
    const name = info?.data?.name || existing.name || null;
    const picture = info?.data?.picture || existing.picture || null;
    const user = await databaseService.prisma.user.update({ where: { id: existing.id }, data: { name, picture } });

    // Mint JWT for this userId
    const token = jwt.sign(
      { userId: user.id, username: user.name || user.email },
      process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '30d' }
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


