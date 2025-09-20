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
    // Response format: { d: [{"Url": "https://example.com/", ...}, ...] } 
    const data = resp.data || {};
    const list = Array.isArray(data.d) ? data.d : (Array.isArray(data) ? data : []);
    return list.map(site => {
      // Handle both string and object responses
      // Bing API returns objects with 'Url' property (capital U)
      const siteUrl = typeof site === 'string' ? site : (site?.Url || site?.siteUrl || site?.url || String(site));
      return { siteUrl };
    });
  }

  /**
   * Get search performance data for a site
   * @param {string} siteUrl - The site URL
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} searchType - 'web' or 'image' (default: 'web')
   */
  async getSearchPerformance(siteUrl, startDate, endDate, searchType = 'web') {
    this.requireKey();
    const url = `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}`;
    const resp = await axios.get(url);
    const data = resp.data || {};
    return data.d || [];
  }

  /**
   * Get query-level performance data
   * @param {string} siteUrl - The site URL
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} searchType - 'web' or 'image' (default: 'web')
   * @param {number} limit - Number of results to return (default: 1000)
   */
  async getQueryStats(siteUrl, startDate, endDate, searchType = 'web', limit = 1000) {
    this.requireKey();
    const url = `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&limit=${limit}`;
    const resp = await axios.get(url);
    const data = resp.data || {};
    return data.d || [];
  }

  /**
   * Get page-level performance data
   * @param {string} siteUrl - The site URL
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} searchType - 'web' or 'image' (default: 'web')
   * @param {number} limit - Number of results to return (default: 1000)
   */
  async getPageStats(siteUrl, startDate, endDate, searchType = 'web', limit = 1000) {
    this.requireKey();
    const url = `${this.baseUrl}/GetPageStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&limit=${limit}`;
    const resp = await axios.get(url);
    const data = resp.data || {};
    return data.d || [];
  }

  /**
   * Get daily totals for a site (aggregated data)
   * @param {string} siteUrl - The site URL
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} searchType - 'web' or 'image' (default: 'web')
   */
  async getDailyTotals(siteUrl, startDate, endDate, searchType = 'web') {
    this.requireKey();
    const url = `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&groupBy=date`;
    logger.info(`Bing API URL: ${url}`);
    const resp = await axios.get(url);
    logger.info(`Bing API response status: ${resp.status}`);
    logger.info(`Bing API response data:`, JSON.stringify(resp.data, null, 2));
    const data = resp.data || {};
    return data.d || [];
  }
}

module.exports = {
  BingApiClient,
};


