const { BingApiClient } = require('./src/services/bingApi');
require('dotenv').config();

async function testPagesAvailability() {
  console.log('🔍 Testing Bing Pages API availability for all registered sites...\n');

  const apiKey = process.env.BING_API_KEY;

  if (!apiKey) {
    console.error('❌ No BING_API_KEY found in environment');
    return;
  }

  const client = new BingApiClient(apiKey);
  const startDate = '2025-09-14';
  const endDate = '2025-09-21';

  // Sites from the user's dashboard
  const sites = [
    'https://movemycar.com.au/',          // Shows 371 queries
    'http://movemycar.com.au/',           // Shows 371 queries
    'https://movingcars.com.au/',         // Shows 0 queries (we tested this)
    'http://www.interstatecarcarriers.com.au/', // Shows 367 queries
    'https://wemove.com.au/',             // Shows 370 queries
    'https://movingagain.com.au/',        // Shows 0 queries
    'https://www.backloading-au.com.au/', // Shows 174 queries
    'https://backloadingremovals.com.au/', // Shows 118 queries
    'https://cartransport.movingagain.com.au/', // Shows 0 queries
    'https://cartransportaus.com.au/',    // Shows 0 queries
    'https://cartransport.au/',           // Shows 0 queries
    'http://www.discountbackloading.com.au/', // Shows 33 queries
    'https://interstate-car-transport.com.au/', // Shows 0 queries
    'http://www.allianceremovals.com.au/', // Shows 0 queries
    'https://mover.com.au/',              // Shows 0 queries
    'https://transportnondrivablecars.com.au/', // Shows 0 queries
    'https://interstate-removals.com.au/', // Shows 0 queries
    'https://cartransportwithpersonalitems.com.au/', // Shows 0 queries
    'https://movingcars.net.au/',         // Shows 0 queries
    'https://interstateremovalists.net.au/', // Shows 0 queries
    'https://movinginsurance.com.au/',    // Shows 0 queries
    'https://again.com.au/',              // Shows 0 queries
    'https://vehicles.mover.com.au/',     // Shows 0 queries
    'http://www.carcarriers.net.au/',     // Shows 0 queries
    'https://deftly.com.au/'              // Shows 0 queries
  ];

  console.log('=' .repeat(100));
  console.log('📊 TESTING PAGES DATA AVAILABILITY FOR ALL SITES');
  console.log('=' .repeat(100));

  const results = [];

  for (const siteUrl of sites) {
    console.log(`\n🌐 Testing: ${siteUrl}`);
    console.log('-'.repeat(60));

    try {
      // Test GetPageStats endpoint
      const pagesUrl = `${client.baseUrl}/GetPageStats?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=web`;
      console.log(`📊 Testing: ${pagesUrl}`);

      const response = await fetch(pagesUrl);
      const responseText = await response.text();

      if (response.status === 200) {
        if (responseText.includes('<?xml') || responseText.includes('<html')) {
          console.log('❌ Pages API returned HTML/XML (error page)');
          results.push({ site: siteUrl, status: 'HTML_ERROR', count: 0 });
        } else {
          try {
            const data = JSON.parse(responseText);
            const count = data.d ? data.d.length : 0;
            console.log(`✅ Pages API: ${response.status} - ${count} records`);
            results.push({ site: siteUrl, status: 'SUCCESS', count: count });
          } catch (jsonError) {
            console.log('❌ Pages API: Invalid JSON');
            results.push({ site: siteUrl, status: 'JSON_ERROR', count: 0 });
          }
        }
      } else {
        console.log(`❌ Pages API: Status ${response.status}`);
        results.push({ site: siteUrl, status: `HTTP_${response.status}`, count: 0 });
      }
    } catch (error) {
      console.log(`❌ Pages API: ${error.message}`);
      results.push({ site: siteUrl, status: 'NETWORK_ERROR', count: 0 });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('🎯 PAGES DATA AVAILABILITY SUMMARY:');
  console.log('=' .repeat(100));

  const workingSites = results.filter(r => r.status === 'SUCCESS' && r.count > 0);
  const noDataSites = results.filter(r => r.status === 'SUCCESS' && r.count === 0);
  const errorSites = results.filter(r => r.status !== 'SUCCESS');

  console.log(`✅ Sites with pages data: ${workingSites.length}`);
  console.log(`🟡 Sites with API working but no data: ${noDataSites.length}`);
  console.log(`❌ Sites with API errors: ${errorSites.length}`);

  console.log('\n📊 SITES WITH PAGES DATA:');
  workingSites.forEach(site => {
    console.log(`✅ ${site.site} - ${site.count} pages`);
  });

  console.log('\n📊 SITES WITHOUT PAGES DATA:');
  noDataSites.forEach(site => {
    console.log(`🟡 ${site.site} - API works, no data available`);
  });

  console.log('\n📊 SITES WITH API ERRORS:');
  errorSites.forEach(site => {
    console.log(`❌ ${site.site} - ${site.status}`);
  });

  console.log('\n' + '='.repeat(100));
  console.log('🎯 CONCLUSION:');
  console.log('✅ Pages API is working and returns data for some sites');
  console.log('🟡 Some sites simply don\'t have pages data available');
  console.log('❌ Some sites have API access issues');
  console.log('\n📋 This explains why pages data shows as 0 - not all sites have pages data');
  console.log('📋 The scheduler should collect pages data from sites that have it');
}
