const { google } = require('googleapis');
const databaseService = require('./database');

async function getUserTokens(userId) {
  try {
    return await databaseService.prisma.gscOAuthToken.findUnique({ where: { userId } });
  } catch (_) { return null; }
}

async function saveUserTokens(userId, tokens) {
  const existing = await databaseService.prisma.gscOAuthToken.findUnique({ where: { userId } }).catch(()=>null);
  const refreshToken = tokens.refresh_token || existing?.refreshToken || null;
  const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : (existing?.expiryDate || null);
  const data = {
    userId,
    accessToken: tokens.access_token || existing?.accessToken || null,
    refreshToken,
    scope: tokens.scope || existing?.scope || null,
    tokenType: tokens.token_type || existing?.tokenType || null,
    expiryDate,
  };
  await databaseService.prisma.gscOAuthToken.upsert({ where: { userId }, update: data, create: data });
}

async function getUserSelection(userId) {
  try {
    const row = await databaseService.prisma.gscUserSelection.findUnique({ where: { userId } });
    return row?.siteUrl || null;
  } catch (_) { return null; }
}

async function setUserSelection(userId, siteUrl) {
  await databaseService.prisma.gscUserSelection.upsert({ where: { userId }, update: { siteUrl }, create: { userId, siteUrl } });
}

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth env vars are not configured');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

module.exports = {
  getUserTokens,
  saveUserTokens,
  getUserSelection,
  setUserSelection,
  getOAuth2Client,
};
