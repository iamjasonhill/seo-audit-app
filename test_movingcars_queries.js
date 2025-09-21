const { BingApiClient } = require('./src/services/bingApi');
require('dotenv').config();

async function testMovingcarsQueries() {
  console.log('🔍 Testing Bing API queries data for movingcars.com.au...\n');

  const siteUrl = 'https://movingcars.com.au/';
  const apiKey = process.env.BING_API_KEY;

  if (!apiKey) {
    console.error('❌ No BING_API_KEY found in environment');
    return;
  }

  const client = new BingApiClient(apiKey);

  try {
    console.log(`📡 Testing Bing API for ${siteUrl}`);
    console.log('=' .repeat(60));

    // Test different date ranges
    const dateRanges = [
      { name: 'Recent (last 7 days)', start: '2025-09-14', end: '2025-09-21' },
      { name: 'Last 30 days', start: '2025-08-22', end: '2025-09-21' },
      { name: 'Older data', start: '2025-08-01', end: '2025-08-31' }
    ];

    for (const range of dateRanges) {
      console.log(`\n📅 Testing ${range.name}: ${range.start} to ${range.end}`);

      // Test queries endpoint
      const queriesUrl = `https://ssl.bing.com/webmaster/api.svc/json/GetSearchTerms?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${range.start}&endDate=${range.end}&searchType=web`;

      try {
        console.log(`🔗 API URL: ${queriesUrl}`);

        const response = await fetch(queriesUrl);
        const responseText = await response.text();

        console.log(`📊 Response Status: ${response.status}`);

        if (response.status === 200) {
          if (responseText.includes('<?xml') || responseText.includes('<html')) {
            console.log('❌ API returned HTML/XML (likely error page)');
            console.log('📄 Response preview:', responseText.substring(0, 200) + '...');
          } else {
            try {
              const data = JSON.parse(responseText);
              if (data.d && data.d.length > 0) {
                console.log(`✅ Found ${data.d.length} query records`);
                console.log('📊 Sample query:', JSON.stringify(data.d[0], null, 2));
              } else {
                console.log('❌ No query data returned (empty d array)');
                console.log('📄 Response data:', JSON.stringify(data, null, 2));
              }
            } catch (jsonError) {
              console.log('❌ Invalid JSON response');
              console.log('📄 Response preview:', responseText.substring(0, 200) + '...');
            }
          }
        } else {
          console.log(`❌ API returned status ${response.status}`);
          console.log('📄 Response preview:', responseText.substring(0, 200) + '...');
        }
      } catch (error) {
        console.log(`❌ Error calling queries API: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎯 ANALYSIS:');
    console.log('✅ If we find query data in any date range, the API works');
    console.log('❌ If all date ranges return empty/error, there may be an issue');
    console.log('📋 This will help identify if queries data exists but isn\'t being collected');

  } catch (error) {
    console.error('❌ Error testing Bing API:', error);
  }
}

// Run the test
testMovingcarsQueries();
