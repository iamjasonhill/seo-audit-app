const axios = require('axios');
const logger = require('./src/utils/logger');

// Simple test to check if Bing API key and endpoints are working
async function testBingAPI() {
  const API_KEY = process.env.BING_API_KEY;
  const testSite = 'https://movingcars.com.au/'; // Use a site we know should work

  logger.info('🧪 Testing Bing API connectivity...');
  logger.info(`API Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : 'undefined'}`);

  // Test the correct v7.0 API endpoint
  const baseUrl = 'https://api.bing.microsoft.com/v7.0/Webmaster';
  const dataTypes = ['QueryStats', 'PageStats'];

  for (const dataType of dataTypes) {
    try {
      logger.info(`\n📡 Testing ${dataType} endpoint`);

      const url = `${baseUrl}/${dataType}?siteUrl=${encodeURIComponent(testSite)}&startDate=2025-09-19&endDate=2025-09-21&aggregation=day&apikey=${API_KEY}`;
      logger.info(`Making request to: ${url}`);

      const config = {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SEO-Audit-App/1.0'
        },
        timeout: 10000
      };

      const response = await axios.get(url, config);
      logger.info(`✅ SUCCESS: ${dataType} returned status ${response.status}`);
      logger.info(`Response data:`, JSON.stringify(response.data, null, 2).substring(0, 500) + '...');

    } catch (error) {
      logger.error(`❌ FAILED: ${dataType}`);
      logger.error(`Error message: ${error.message}`);
      logger.error(`Error code: ${error.code}`);
      logger.error(`Error response:`, error.response?.data);
      logger.error(`Error status: ${error.response?.status}`);
      logger.error(`Error config:`, error.config);
    }
  }

  logger.info('\n🏁 Bing API test completed');
}

testBingAPI().catch(console.error);
