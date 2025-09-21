const { BingApiClient } = require('./src/services/bingApi');
const logger = require('./src/utils/logger');

// Test with a specific site that has data but shows 0 pages
const testSite = 'https://movingcars.com.au/';
const startDate = '2025-09-15';
const endDate = '2025-09-21';

async function testPagesSync() {
  logger.info(`Testing pages sync for ${testSite}`);

  try {
    const client = new BingApiClient(process.env.BING_API_KEY);

    logger.info('Testing GetPageStats endpoint...');
    const pageStats = await client.getPageStats(testSite, startDate, endDate, 'web', 1000);
    logger.info(`GetPageStats result: ${pageStats.length} records`);
    logger.info(`Sample page data:`, JSON.stringify(pageStats.slice(0, 3), null, 2));

    logger.info('Testing GetPagePerformance endpoint...');
    // Try direct axios call to see what endpoints are actually available
    const axios = require('axios');
    const baseUrl = 'https://ssl.bing.com/webmaster/api.svc/json';
    const apiKey = process.env.BING_API_KEY;

    // Test the actual Bing API endpoints to see what's available
    const testUrls = [
      `${baseUrl}/GetPageStats?apikey=${encodeURIComponent(apiKey)}&siteUrl=${encodeURIComponent(testSite)}&startDate=${startDate}&endDate=${endDate}&searchType=web`,
      `${baseUrl}/GetPagePerformance?apikey=${encodeURIComponent(apiKey)}&siteUrl=${encodeURIComponent(testSite)}&startDate=${startDate}&endDate=${endDate}&searchType=web`,
      `${baseUrl}/GetSearchTerms?apikey=${encodeURIComponent(apiKey)}&siteUrl=${encodeURIComponent(testSite)}&startDate=${startDate}&endDate=${endDate}&searchType=web`,
      `${baseUrl}/GetQueryStats?apikey=${encodeURIComponent(apiKey)}&siteUrl=${encodeURIComponent(testSite)}&startDate=${startDate}&endDate=${endDate}&searchType=web`
    ];

    for (const url of testUrls) {
      try {
        logger.info(`Testing direct API call: ${url.split('?')[0]}`);
        const resp = await axios.get(url);
        logger.info(`Status: ${resp.status}`);
        logger.info(`Data keys:`, Object.keys(resp.data || {}));
        logger.info(`Data length:`, resp.data?.d?.length || 0);
        if (resp.data?.d?.length > 0) {
          logger.info(`Sample record:`, JSON.stringify(resp.data.d[0], null, 2));
        }
      } catch (error) {
        logger.error(`API call failed: ${error.response?.status} - ${error.message}`);
        if (error.response?.data) {
          logger.error(`Response data:`, JSON.stringify(error.response.data, null, 2));
        }
      }
    }

  } catch (error) {
    logger.error('Test failed:', error);
  }
}

testPagesSync();
