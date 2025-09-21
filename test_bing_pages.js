const { BingApiClient } = require('./src/services/bingApi');
require('dotenv').config();

async function testBingPages() {
  console.log('🔍 Testing Bing API for different data types...');

  const siteUrl = 'https://www.allianceremovals.com.au/';
  const apiKey = process.env.BING_API_KEY;

  if (!apiKey) {
    console.error('❌ No BING_API_KEY found in environment');
    return;
  }

  const client = new BingApiClient(apiKey);
  const startDate = '2025-09-19';
  const endDate = '2025-09-20';

  try {
    console.log(`📡 Testing Bing API for ${siteUrl}`);
    console.log(`📅 Date range: ${startDate} to ${endDate}`);

    // Test different API endpoints
    const endpoints = [
      {
        name: 'Totals/Impressions',
        url: `https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=web`
      },
      {
        name: 'Queries',
        url: `https://ssl.bing.com/webmaster/api.svc/json/GetSearchTerms?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=web`
      },
      {
        name: 'Pages',
        url: `https://ssl.bing.com/webmaster/api.svc/json/GetPageTraffic?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=web`
      }
    ];

    for (const endpoint of endpoints) {
      console.log(`\n🌐 Testing ${endpoint.name}...`);
      console.log(`🔗 API URL: ${endpoint.url}`);

      try {
        const response = await fetch(endpoint.url);
        const data = await response.json();

        console.log(`📊 API Response Status: ${response.status}`);

        if (response.status === 200 && data.d) {
          console.log(`✅ Found ${data.d.length} ${endpoint.name.toLowerCase()} records`);
          if (data.d.length > 0) {
            console.log(`📄 Sample record:`, JSON.stringify(data.d[0], null, 2));
          }
        } else {
          console.log(`❌ No ${endpoint.name.toLowerCase()} data found`);
          if (data && data.Message) {
            console.log(`📄 Error message: ${data.Message}`);
          }
        }
      } catch (error) {
        console.log(`❌ Error testing ${endpoint.name}:`, error.message);
      }
    }

  } catch (error) {
    console.error('❌ Error testing Bing API:', error);
  }
}

// Run the test
testBingPages();
