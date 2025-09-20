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
    // Try both GetUserSites and GetSites as per the research
    const possibleEndpoints = ['GetUserSites', 'GetSites'];
    
    for (const endpoint of possibleEndpoints) {
      try {
        const url = `${this.baseUrl}/${endpoint}?apikey=${encodeURIComponent(this.apiKey)}`;
        logger.info(`Trying Bing API endpoint: ${endpoint}`);
        const resp = await axios.get(url);
        logger.info(`Bing API ${endpoint} response:`, JSON.stringify(resp.data, null, 2));
        
        // Response format: { d: [{"Url": "https://example.com/", ...}, ...] } 
        const data = resp.data || {};
        const list = Array.isArray(data.d) ? data.d : (Array.isArray(data) ? data : []);
        
        if (list.length > 0) {
          logger.info(`Found sites with endpoint: ${endpoint}`);
          return list.map(site => {
            // Handle both string and object responses
            // Bing API returns objects with 'Url' property (capital U)
            const siteUrl = typeof site === 'string' ? site : (site?.Url || site?.siteUrl || site?.url || String(site));
            return { siteUrl };
          });
        }
      } catch (error) {
        logger.warn(`Endpoint ${endpoint} failed:`, error.message);
      }
    }
    
    logger.warn('No working sites endpoint found');
    return [];
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
    
    // Try different possible endpoints and parameter combinations for query stats
    const possibleUrls = [
      `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&limit=${limit}`,
      `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}`,
      `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`,
      `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&rowLimit=${limit}`,
      `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&rowLimit=${limit}`,
      // Try alternative endpoint names
      `${this.baseUrl}/GetQueryPerformance?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&limit=${limit}`,
      `${this.baseUrl}/GetQueryPerformance?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}`,
      `${this.baseUrl}/GetQueryPerformance?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`
    ];
    
    for (const url of possibleUrls) {
      try {
        logger.info(`Trying Bing API GetQueryStats URL: ${url}`);
        const resp = await axios.get(url);
        logger.info(`Bing API GetQueryStats response status: ${resp.status}`);
        logger.info(`Bing API GetQueryStats response data:`, JSON.stringify(resp.data, null, 2));
        const data = resp.data || {};
        if (data.d && data.d.length > 0) {
          logger.info(`Found query data with URL: ${url}`);
          return data.d;
        } else if (data.d && data.d.length === 0) {
          logger.info(`Query data endpoint working but no data returned: ${url}`);
          return [];
        }
      } catch (error) {
        logger.warn(`GetQueryStats URL failed: ${url}`, error.message);
      }
    }
    
    logger.warn('No working GetQueryStats URL found');
    return [];
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
    
    // Try different possible endpoints and parameter combinations for page stats
    const possibleUrls = [
      `${this.baseUrl}/GetPageStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&limit=${limit}`,
      `${this.baseUrl}/GetPageStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}`,
      `${this.baseUrl}/GetPageStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`,
      `${this.baseUrl}/GetPageStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&rowLimit=${limit}`,
      `${this.baseUrl}/GetPageStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&rowLimit=${limit}`,
      // Try alternative endpoint names
      `${this.baseUrl}/GetPagePerformance?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}&limit=${limit}`,
      `${this.baseUrl}/GetPagePerformance?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}`,
      `${this.baseUrl}/GetPagePerformance?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`
    ];
    
    for (const url of possibleUrls) {
      try {
        logger.info(`Trying Bing API GetPageStats URL: ${url}`);
        const resp = await axios.get(url);
        logger.info(`Bing API GetPageStats response status: ${resp.status}`);
        logger.info(`Bing API GetPageStats response data:`, JSON.stringify(resp.data, null, 2));
        const data = resp.data || {};
        if (data.d && data.d.length > 0) {
          logger.info(`Found page data with URL: ${url}`);
          return data.d;
        } else if (data.d && data.d.length === 0) {
          logger.info(`Page data endpoint working but no data returned: ${url}`);
          return [];
        }
      } catch (error) {
        logger.warn(`GetPageStats URL failed: ${url}`, error.message);
      }
    }
    
    logger.warn('No working GetPageStats URL found');
    return [];
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
    // Try different parameter formats for GetRankAndTrafficStats
    const possibleUrls = [
      `${this.baseUrl}/GetRankAndTrafficStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}`,
      `${this.baseUrl}/GetRankAndTrafficStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`,
      `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}`,
      `${this.baseUrl}/GetQueryStats?apikey=${encodeURIComponent(this.apiKey)}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`
    ];
    
    for (const url of possibleUrls) {
      try {
        logger.info(`Trying Bing API URL: ${url}`);
        const resp = await axios.get(url);
        logger.info(`Bing API response status: ${resp.status}`);
        logger.info(`Bing API response data:`, JSON.stringify(resp.data, null, 2));
        const data = resp.data || {};
        if (data.d && data.d.length > 0) {
          logger.info(`Found data with URL: ${url}`);
          return data.d;
        }
      } catch (error) {
        logger.warn(`URL failed: ${url}`, error.message);
      }
    }
    
    logger.warn('No working daily totals URL found');
    return [];
  }
}

module.exports = {
  BingApiClient,
};


