require('dotenv').config({ path: '.env.local' });
const { BingApiClient } = require('./src/services/bingApi');

async function testBingPagesDirect() {
  console.log('🔍 Testing Bing API directly for pages data...\n');

  const apiKey = process.env.BING_API_KEY;
  if (!apiKey) {
    console.error('❌ No BING_API_KEY found in .env.local');
    return;
  }

  const client = new BingApiClient(apiKey);

  // Test both sites
  const sites = [
    'https://backloadingremovals.com.au/',
    'https://movingcars.com.au/'
  ];

  const startDate = '2025-09-01';
  const endDate = '2025-09-21';

  console.log('=' .repeat(100));
  console.log('📊 TESTING BING PAGES API DIRECTLY');
  console.log('=' .repeat(100));
  console.log(`📅 Date range: ${startDate} to ${endDate}`);
  console.log(`🔑 API Key: ...${apiKey.slice(-4)}`);
  console.log('');

  for (const siteUrl of sites) {
    console.log(`\n🌐 Testing: ${siteUrl}`);
    console.log('-'.repeat(60));

    try {
      // Test GetPageStats (the method used by scheduler)
      console.log('📄 Testing GetPageStats endpoint...');

      const pagesData = await client.getPageStats(siteUrl, startDate, endDate, 'web', 1000);

      console.log(`✅ API Response Status: SUCCESS`);
      console.log(`📊 Pages returned: ${pagesData.length}`);
      console.log(`🔍 Data type: ${typeof pagesData}`);

      if (pagesData.length > 0) {
        console.log('📋 Sample page data:');
        pagesData.slice(0, 3).forEach((page, index) => {
          console.log(`   ${index + 1}. ${JSON.stringify(page, null, 2)}`);
        });

        // Analyze the data structure
        console.log('\n📊 Data Analysis:');
        const samplePage = pagesData[0];
        console.log(`   Keys: ${Object.keys(samplePage).join(', ')}`);
        console.log(`   Has clicks: ${'clicks' in samplePage ? 'YES' : 'NO'}`);
        console.log(`   Has impressions: ${'impressions' in samplePage ? 'YES' : 'NO'}`);
        console.log(`   Has page URL: ${'page' in samplePage ? 'YES' : 'NO'}`);
        console.log(`   Has date: ${'date' in samplePage ? 'YES' : 'NO'}`);
      } else {
        console.log('⚠️  No pages data returned');
      }

    } catch (error) {
      console.log(`❌ API Error: ${error.message}`);

      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Status Text: ${error.response.statusText}`);
        console.log(`   Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    }

    console.log('\n' + '='.repeat(60));
  }

  console.log('\n' + '=' .repeat(100));
  console.log('🎯 CONCLUSION:');
  console.log('=' .repeat(100));

  console.log('📋 This test will show us:');
  console.log('   1. Whether Bing API returns pages data');
  console.log('   2. What the data structure looks like');
  console.log('   3. If there are any API errors');
  console.log('   4. Whether the issue is with API or scheduler');

  console.log('\n📊 Expected Results:');
  console.log('   ✅ If API works: We should see pages data with clicks, impressions, etc.');
  console.log('   ❌ If API fails: We\'ll see error messages or empty responses');
  console.log('   🔍 This will tell us if the problem is with the API calls or the scheduler logic');
}

// Run the test
testBingPagesDirect().catch(console.error);
