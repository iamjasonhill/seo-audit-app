require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function populateBingProperties() {
  console.log('🔧 Populating bing_user_property table with sites...\n');

  try {
    // Sites that the user mentioned have queries data from their dashboard
    const sitesWithData = [
      'https://movemycar.com.au/',
      'http://movemycar.com.au/',
      'http://www.interstatecarcarriers.com.au/',
      'https://wemove.com.au/',
      'https://movingagain.com.au/',
      'https://www.backloading-au.com.au/',
      'https://backloadingremovals.com.au/',
      'http://www.discountbackloading.com.au/',
      'https://movingcars.com.au/',
      'https://cartransportaus.com.au/',
      'https://movingcars.net.au/',
      'http://www.carcarriers.net.au/',
      'https://mover.com.au/',
      'https://interstate-removals.com.au/',
      'https://interstate-car-transport.com.au/',
      'https://cartransportwithpersonalitems.com.au/',
      'https://interstateremovalists.net.au/',
      'https://movinginsurance.com.au/',
      'https://again.com.au/',
      'https://vehicles.mover.com.au/',
      'https://deftly.com.au/',
      'https://transportnondrivablecars.com.au/',
      'http://www.allianceremovals.com.au/',
      'https://cartransport.au/',
      'https://cartransport.movingagain.com.au/'
    ];

    console.log(`📊 Adding ${sitesWithData.length} sites to bing_user_property table...\n`);

    let addedCount = 0;
    let skippedCount = 0;

    for (const siteUrl of sitesWithData) {
      try {
        // Check if site already exists
        const existing = await prisma.$queryRawUnsafe(
          `SELECT id FROM bing_user_property WHERE site_url = $1`,
          siteUrl
        );

        if (existing.length > 0) {
          console.log(`⏭️  ${siteUrl} already exists`);
          skippedCount++;
        } else {
          // Insert the site
          await prisma.$queryRawUnsafe(`
            INSERT INTO bing_user_property (user_id, site_url, enabled, sync_interval_hours, priority_order)
            VALUES ($1, $2, $3, $4, $5)
          `, 2, siteUrl, true, 24, 1);

          console.log(`✅ Added ${siteUrl}`);
          addedCount++;
        }
      } catch (error) {
        console.log(`❌ Failed to add ${siteUrl}: ${error.message}`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Added: ${addedCount} sites`);
    console.log(`   ⏭️  Skipped: ${skippedCount} sites`);

    // Verify the table has data
    const allProperties = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM bing_user_property WHERE enabled = true`
    );

    console.log(`   📊 Total sites in table: ${allProperties[0].count}`);

    // Show some sample sites
    const sampleSites = await prisma.$queryRawUnsafe(
      `SELECT site_url, priority_order, enabled FROM bing_user_property WHERE enabled = true ORDER BY priority_order ASC, site_url ASC LIMIT 10`
    );

    console.log('\n📋 Sample sites in bing_user_property:');
    sampleSites.forEach((site, index) => {
      console.log(`   ${index + 1}. ${site.site_url} (Priority: ${site.priority_order})`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('🎯 SUCCESS:');
    console.log('=' .repeat(60));
    console.log('✅ bing_user_property table populated with sites');
    console.log('✅ Scheduler should now find sites to process');
    console.log('✅ Next scheduler run should collect data');

    console.log('\n📋 Next Steps:');
    console.log('   1. Wait for next scheduler run (runs every 5 minutes)');
    console.log('   2. Check Vercel logs for scheduler activity');
    console.log('   3. Monitor Bing Monitor dashboard for pages data');
    console.log('   4. Verify pages data appears for sites that have it');

  } catch (error) {
    console.error('❌ Error populating bing_user_property:', error);
  } finally {
    await prisma.$disconnect();
  }
}

populateBingProperties();
