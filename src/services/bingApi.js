const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Minimal Bing Webmaster Tools API client using API key auth.
 * Notes:
 * - Endpoints are under https://ssl.bing.com/webmaster/api.svc/json/{Method}
 * - API key is passed via apikey= query param
 */
class BingApiClient {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.BING_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('BingApiClient initialized without API key');
    }
    this.baseUrl = 'https://ssl.bing.com/webmaster/api.svc/json';
  }

  requireKey() {
    if (!this.apiKey) {
      const err = new Error('Bing API key is required');
      err.status = 400;
      throw err;
    }
  }

  async getUserSites() {
    this.requireKey();
    const url = `${this.baseUrl}/GetUserSites?apikey=${encodeURIComponent(this.apiKey)}`;
    const resp = await axios.get(url);
    // Response format: { d: ["https://example.com/", ...] } or similar depending on account
    const data = resp.data || {};
    const list = Array.isArray(data.d) ? data.d : (Array.isArray(data) ? data : []);
    return list.map(site => ({ siteUrl: String(site) }));
  }
}

module.exports = {
  BingApiClient,
};


