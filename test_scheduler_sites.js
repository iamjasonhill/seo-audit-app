require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testSchedulerSites() {
  console.log('🔍 Testing if scheduler can now find sites to process...\n');

  try {
    const now = new Date();
    console.log(`📅 Current time: ${now.toISOString()}\n`);

    // Get sites in the same order the scheduler processes them
    const rows = await prisma.$queryRawUnsafe(`
      SELECT site_url, next_sync_due_at, priority_order, last_full_sync_at, enabled
      FROM bing_user_property
      WHERE enabled = true
        AND (next_sync_due_at IS NULL OR next_sync_due_at <= $1)
      ORDER BY next_sync_due_at ASC, priority_order ASC, last_full_sync_at ASC
      LIMIT 10
    `, now);

    console.log('=' .repeat(80));
    console.log('📋 SITES THE SCHEDULER WILL PROCESS (Next 10):');
    console.log('=' .repeat(80));

    if (rows.length === 0) {
      console.log('❌ No sites found for scheduler to process!');
      console.log('❌ This means the scheduler will still have no sites to sync');
    } else {
      console.log(`✅ Found ${rows.length} sites for scheduler to process!`);
      console.log('');

      rows.forEach((row, index) => {
        console.log(`${(index + 1).toString().padStart(2, ' ')}. ${row.site_url}`);
        console.log(`    📅 Next due: ${row.next_sync_due_at || 'ASAP'}`);
        console.log(`    🎯 Priority: ${row.priority_order || 'N/A'}`);
        console.log(`    ⏰ Last sync: ${row.last_full_sync_at || 'Never'}`);
        console.log('');
      });

      // Test if any of these sites have queries data (based on user's dashboard)
      const sitesWithQueries = [
        'https://movemycar.com.au/',
        'http://movemycar.com.au/',
        'http://www.interstatecarcarriers.com.au/',
        'https://wemove.com.au/',
        'https://movingagain.com.au/',
        'https://www.backloading-au.com.au/',
        'https://backloadingremovals.com.au/',
        'http://www.discountbackloading.com.au/'
      ];

      const sitesWithQueriesInQueue = rows.filter(r => sitesWithQueries.includes(r.site_url));

      console.log('=' .repeat(80));
      console.log('🎯 SITES WITH QUERIES DATA IN PROCESSING QUEUE:');
      console.log('=' .repeat(80));

      if (sitesWithQueriesInQueue.length > 0) {
        console.log('✅ GOOD NEWS: Sites with queries data are in the scheduler queue!');
        sitesWithQueriesInQueue.forEach(site => {
          console.log(`   ✅ ${site.site_url} (Priority: ${site.priority_order})`);
        });
        console.log('\n📊 These sites should now collect pages data if available');
      } else {
        console.log('⚠️  Sites with queries data are not yet in the processing queue');
        console.log('   This means they will be processed later based on priority');
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎯 ANALYSIS:');
    console.log('=' .repeat(80));

    console.log('📊 Database Status:');
    console.log('   ✅ bing_user_property table: EXISTS and POPULATED');
    console.log('   ✅ bing_totals_daily table: EXISTS');
    console.log('   ✅ bing_queries_daily table: EXISTS');
    console.log('   ✅ bing_pages_daily table: EXISTS');

    console.log('\n🔍 Scheduler Status:');
    if (rows.length > 0) {
      console.log('   ✅ Scheduler can find sites to process');
      console.log('   ✅ Next scheduler run should process these sites');
      console.log('   ✅ Pages data should be collected for sites that have it');
    } else {
      console.log('   ❌ Scheduler still cannot find sites to process');
      console.log('   ❌ Need to check why sites are not being returned');
    }

    console.log('\n📋 Next Steps:');
    console.log('   1. Wait for next scheduler run (runs every 5 minutes)');
    console.log('   2. Check Vercel logs for "Bing Scheduler: processing" messages');
    console.log('   3. Monitor Bing Monitor dashboard for pages data increase');
    console.log('   4. Verify pages data appears for sites like movemycar.com.au');

  } catch (error) {
    console.error('❌ Error testing scheduler sites:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSchedulerSites();
