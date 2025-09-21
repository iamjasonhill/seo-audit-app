const { BingApiClient } = require('./src/services/bingApi');
require('dotenv').config();

async function auditBingDataTypes() {
  console.log('🔍 Auditing Bing Webmaster Tools API endpoints and data types...\n');

  const apiKey = process.env.BING_API_KEY;

  if (!apiKey) {
    console.error('❌ No BING_API_KEY found in environment');
    return;
  }

  const client = new BingApiClient(apiKey);
  const siteUrl = 'https://movingcars.com.au/';
  const startDate = '2025-09-14';
  const endDate = '2025-09-21';

  try {
    console.log(`📡 Testing all possible Bing API endpoints for ${siteUrl}`);
    console.log('=' .repeat(80));

    // 1. Test Search Types
    console.log('\n🌐 1. TESTING SEARCH TYPES:');
    console.log('-'.repeat(50));

    const searchTypes = ['web', 'image'];

    for (const searchType of searchTypes) {
      console.log(`\n🔍 Testing search type: ${searchType}`);

      // Test totals for this search type
      const totalsUrl = `${client.baseUrl}/GetRankAndTrafficStats?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=${searchType}`;
      console.log(`📊 Testing: ${totalsUrl}`);

      try {
        const response = await fetch(totalsUrl);
        const data = await response.json();
        console.log(`✅ ${searchType}: ${response.status} - ${data.d ? data.d.length : 0} records`);
      } catch (error) {
        console.log(`❌ ${searchType}: ${error.message}`);
      }
    }

    // 2. Test Different Endpoints
    console.log('\n\n📊 2. TESTING DIFFERENT ENDPOINTS:');
    console.log('-'.repeat(50));

    const endpoints = [
      { name: 'GetSearchTerms', description: 'Primary queries endpoint' },
      { name: 'GetQueryStats', description: 'Alternative queries endpoint' },
      { name: 'GetQueryPerformance', description: 'Query performance data' },
      { name: 'GetRankAndTrafficStats', description: 'Totals/aggregate data' },
      { name: 'GetPageStats', description: 'Page-level data' },
      { name: 'GetPagePerformance', description: 'Page performance data' }
    ];

    for (const endpoint of endpoints) {
      console.log(`\n🔍 Testing ${endpoint.name}: ${endpoint.description}`);

      const url = `${client.baseUrl}/${endpoint.name}?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}&searchType=web`;
      console.log(`📊 Testing: ${url}`);

      try {
        const response = await fetch(url);
        const responseText = await response.text();

        if (response.status === 200) {
          if (responseText.includes('<?xml') || responseText.includes('<html')) {
            console.log(`❌ ${endpoint.name}: Returns HTML/XML (error page)`);
          } else {
            try {
              const data = JSON.parse(responseText);
              console.log(`✅ ${endpoint.name}: ${response.status} - ${data.d ? data.d.length : 0} records`);
            } catch (jsonError) {
              console.log(`❌ ${endpoint.name}: Invalid JSON`);
            }
          }
        } else {
          console.log(`❌ ${endpoint.name}: Status ${response.status}`);
        }
      } catch (error) {
        console.log(`❌ ${endpoint.name}: ${error.message}`);
      }
    }

    // 3. Test with different dimensions/parameters
    console.log('\n\n🎯 3. TESTING DIFFERENT DIMENSIONS:');
    console.log('-'.repeat(50));

    const dimensionTests = [
      { name: 'No dimensions', params: '' },
      { name: 'With limit', params: '&limit=1000' },
      { name: 'With rowLimit', params: '&rowLimit=1000' },
      { name: 'With search type', params: '&searchType=web' }
    ];

    for (const test of dimensionTests) {
      console.log(`\n🔍 Testing ${test.name}: ${test.params}`);

      const url = `${client.baseUrl}/GetSearchTerms?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}${test.params}`;
      console.log(`📊 Testing: ${url}`);

      try {
        const response = await fetch(url);
        console.log(`📊 Response: ${response.status}`);
      } catch (error) {
        console.log(`❌ Error: ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎯 AUDIT RESULTS:');
    console.log('✅ Endpoints that work: Look for 200 status with JSON data');
    console.log('❌ Endpoints that fail: 404, HTML responses, empty data');
    console.log('📋 This audit shows which endpoints provide data vs which ones fail');
    console.log('📋 The scheduler should prioritize working endpoints');

  } catch (error) {
    console.error('❌ Error auditing Bing API:', error);
  }
}

// Run the audit
auditBingDataTypes();
