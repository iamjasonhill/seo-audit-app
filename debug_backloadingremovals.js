require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugBackloadingRemovals() {
  console.log('🔍 Debugging https://backloadingremovals.com.au/ data status...\n');

  try {
    const siteUrl = 'https://backloadingremovals.com.au/';

    console.log('=' .repeat(80));
    console.log('📊 CHECKING EXISTING DATA FOR backloadingremovals.com.au');
    console.log('=' .repeat(80));

    // Check if site has any totals data
    const totalsData = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count, MIN(date) as earliest, MAX(date) as latest
      FROM bing_totals_daily
      WHERE site_url = $1
    `, siteUrl);

    console.log(`📈 Totals data: ${totalsData[0].count} records`);
    console.log(`   Earliest: ${totalsData[0].earliest}`);
    console.log(`   Latest: ${totalsData[0].latest}`);

    // Check if site has queries data
    const queriesData = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count, MIN(date) as earliest, MAX(date) as latest
      FROM bing_queries_daily
      WHERE site_url = $1
    `, siteUrl);

    console.log(`🔍 Queries data: ${queriesData[0].count} records`);
    console.log(`   Earliest: ${queriesData[0].earliest}`);
    console.log(`   Latest: ${queriesData[0].latest}`);

    // Check if site has pages data
    const pagesData = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as count, MIN(date) as earliest, MAX(date) as latest
      FROM bing_pages_daily
      WHERE site_url = $1
    `, siteUrl);

    console.log(`📄 Pages data: ${pagesData[0].count} records`);
    console.log(`   Earliest: ${pagesData[0].earliest}`);
    console.log(`   Latest: ${pagesData[0].latest}`);

    // Check bing_user_property status
    const propertyStatus = await prisma.$queryRawUnsafe(`
      SELECT next_sync_due_at, last_full_sync_at, priority_order, enabled
      FROM bing_user_property
      WHERE site_url = $1
    `, siteUrl);

    console.log('\n📋 Property Status:');
    console.log(`   Next sync due: ${propertyStatus[0]?.next_sync_due_at}`);
    console.log(`   Last full sync: ${propertyStatus[0]?.last_full_sync_at}`);
    console.log(`   Priority: ${propertyStatus[0]?.priority_order}`);
    console.log(`   Enabled: ${propertyStatus[0]?.enabled}`);

    console.log('\n' + '=' .repeat(80));
    console.log('🎯 ANALYSIS:');
    console.log('=' .repeat(80));

    const totalsCount = parseInt(totalsData[0].count);
    const queriesCount = parseInt(queriesData[0].count);
    const pagesCount = parseInt(pagesData[0].count);

    if (totalsCount > 0) {
      console.log('✅ Site has totals data - scheduler may think it\'s up to date');
      console.log('🔍 This explains why "Processing 0 chunks" - no data gaps detected');
    } else {
      console.log('❌ Site has no totals data - should be collecting data');
    }

    if (queriesCount > 0) {
      console.log('✅ Site has queries data');
    } else {
      console.log('❌ Site has no queries data - should be collecting');
    }

    if (pagesCount > 0) {
      console.log('✅ Site has pages data');
    } else {
      console.log('❌ Site has no pages data - should be collecting');
      console.log('🔍 This explains why pages data is still 0 in dashboard');
    }

    // Check what the computeWindow function would see
    console.log('\n🔧 ComputeWindow Analysis:');
    const currentDate = new Date();
    const oneYearAgo = new Date(currentDate.getTime() - 365 * 24 * 60 * 60 * 1000);
    const dateRange = {
      earliest: totalsData[0].earliest || oneYearAgo,
      latest: totalsData[0].latest || currentDate
    };

    console.log(`   Current date: ${currentDate.toISOString().split('T')[0]}`);
    console.log(`   One year ago: ${oneYearAgo.toISOString().split('T')[0]}`);
    console.log(`   Existing data range: ${dateRange.earliest?.toISOString().split('T')[0] || 'None'} to ${dateRange.latest?.toISOString().split('T')[0] || 'None'}`);

    if (dateRange.latest && dateRange.earliest) {
      const daysDiff = Math.floor((dateRange.latest - dateRange.earliest) / (1000 * 60 * 60 * 24));
      console.log(`   Data coverage: ${daysDiff} days`);
    }

    console.log('\n📋 Conclusion:');
    if (totalsCount > 0) {
      console.log('   - Site appears to have totals data');
      console.log('   - Scheduler thinks data is complete');
      console.log('   - Need to check if queries/pages are missing from existing data');
    } else {
      console.log('   - Site has no data at all');
      console.log('   - Scheduler should be collecting all data types');
    }

  } catch (error) {
    console.error('❌ Error debugging site:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugBackloadingRemovals();
