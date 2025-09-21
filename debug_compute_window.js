require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugComputeWindow() {
  console.log('🔍 Debugging computeWindow logic for https://backloadingremovals.com.au/...\n');

  try {
    const siteUrl = 'https://backloadingremovals.com.au/';
    const searchType = 'web'; // Default search type

    console.log('=' .repeat(80));
    console.log('📊 TESTING getCoverageFromDb FUNCTION');
    console.log('=' .repeat(80));

    // Simulate the getCoverageFromDb function
    const first = await prisma.bingTotalsDaily.findFirst({
      where: { siteUrl, searchType },
      select: { date: true },
      orderBy: { date: 'asc' }
    });

    const last = await prisma.bingTotalsDaily.findFirst({
      where: { siteUrl, searchType },
      select: { date: true },
      orderBy: { date: 'desc' }
    });

    const cov = {
      start: first?.date || null,
      end: last?.date || null,
    };

    console.log(`📈 Coverage result:`, cov);
    console.log(`   Start: ${cov.start}`);
    console.log(`   End: ${cov.end}`);

    console.log('\n📊 TESTING computeWindow LOGIC');

    // Simulate computeWindow logic
    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()-2));

    console.log(`   Today: ${today.toISOString().split('T')[0]}`);
    console.log(`   End target: ${end.toISOString().split('T')[0]}`);

    let windowResult = null;

    if (!cov.start || !cov.end) {
      console.log('   🔍 No coverage found - should create 7-day backfill window');
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()-7));
      windowResult = { startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0], historic: true };
      console.log(`   ✅ Should return window: ${JSON.stringify(windowResult, null, 2)}`);
    } else {
      console.log('   🔍 Coverage found - checking if up to date');
      if (cov.end >= end) {
        console.log('   ✅ Coverage is up to date - should return null');
        windowResult = null;
      } else {
        console.log('   🔍 Coverage is NOT up to date - should create incremental window');
        const start = new Date(cov.end.getTime() + 24*60*60*1000);
        windowResult = { startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0], historic: false };
        console.log(`   ✅ Should return window: ${JSON.stringify(windowResult, null, 2)}`);
      }
    }

    console.log('\n' + '=' .repeat(80));
    console.log('🎯 ANALYSIS:');
    console.log('=' .repeat(80));

    console.log('📋 What the scheduler is actually doing:');
    console.log('   - Looking for totals data coverage');
    console.log('   - Site has 0 totals records');
    console.log('   - Should trigger 7-day backfill window');

    if (windowResult) {
      console.log(`\n✅ computeWindow SHOULD return: ${JSON.stringify(windowResult, null, 2)}`);
      console.log('✅ This means scheduler should be processing data chunks');
    } else {
      console.log('\n❌ computeWindow SHOULD return null');
      console.log('❌ This means scheduler thinks data is complete');
    }

    // Test the queries/pages logic that should trigger when tasks.length === 0
    console.log('\n📋 Testing queries/pages fallback logic:');

    const queriesCount = await prisma.bingQueriesDaily.count({ where: { siteUrl } });
    const pagesCount = await prisma.bingPagesDaily.count({ where: { siteUrl } });

    console.log(`   Queries count: ${queriesCount}`);
    console.log(`   Pages count: ${pagesCount}`);

    if (queriesCount === 0 || pagesCount === 0) {
      console.log('   ✅ Missing data detected - should trigger queries/pages processing');
      console.log('   ✅ Should create 30-day window for queries and pages');

      const fallbackStartDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()-30));
      console.log(`   ✅ Should use date range: ${fallbackStartDate.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`);
    } else {
      console.log('   ❌ No missing data detected - should NOT trigger queries/pages processing');
    }

    console.log('\n' + '=' .repeat(80));
    console.log('🎯 CONCLUSION:');
    console.log('=' .repeat(80));

    console.log('🔍 The issue might be:');
    console.log('   1. computeWindow function not working correctly');
    console.log('   2. Bing API not returning data for this site');
    console.log('   3. Error handling silently failing');
    console.log('   4. Need to check actual Bing API response');

    console.log('\n📋 Next steps:');
    console.log('   1. Test Bing API directly for this site');
    console.log('   2. Check if Bing API key has access to this site');
    console.log('   3. Add more detailed logging to computeWindow');
    console.log('   4. Check if there are any errors in the API calls');

  } catch (error) {
    console.error('❌ Error debugging computeWindow:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugComputeWindow();
