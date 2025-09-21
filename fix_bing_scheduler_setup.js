require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function fixBingSchedulerSetup() {
  console.log('🔧 Fixing Bing Scheduler Setup...\n');

  try {
    console.log('📋 Step 1: Creating missing bing_user_property table...\n');

    // Read and execute the SQL script to create the missing table
    const sqlFilePath = path.join(__dirname, 'create_bing_scheduler_tables.sql');
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

    // Split the SQL into individual statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await prisma.$queryRawUnsafe(statement);
          console.log('✅ Executed SQL statement');
        } catch (error) {
          console.log('⚠️  SQL statement already exists or failed:', error.message);
        }
      }
    }

    console.log('\n📋 Step 2: Checking if bing_user_property table exists now...\n');

    // Check if the table exists now
    const tableCheck = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'bing_user_property'
      ) as exists;
    `;

    if (tableCheck[0].exists) {
      console.log('✅ bing_user_property table created successfully!');
    } else {
      console.log('❌ Failed to create bing_user_property table');
      return;
    }

    console.log('\n📋 Step 3: Populating bing_user_property with sites that have data...\n');

    // Sites that the user mentioned have queries data
    const sitesWithData = [
      {
        user_id: 2, // Default user
        site_url: 'https://movemycar.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'http://movemycar.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'http://www.interstatecarcarriers.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://wemove.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://movingagain.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://www.backloading-au.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://backloadingremovals.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'http://www.discountbackloading.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://movingcars.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://cartransportaus.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://movingcars.net.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'http://www.carcarriers.net.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://mover.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://interstate-removals.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://interstate-car-transport.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://cartransportwithpersonalitems.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://interstateremovalists.net.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://movinginsurance.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://again.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://vehicles.mover.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://deftly.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://transportnondrivablecars.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'http://www.allianceremovals.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://cartransport.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      },
      {
        user_id: 2,
        site_url: 'https://cartransport.movingagain.com.au/',
        enabled: true,
        priority_order: 1,
        sync_interval_hours: 24
      }
    ];

    console.log(`📊 Adding ${sitesWithData.length} sites to bing_user_property table...\n`);

    let addedCount = 0;
    for (const site of sitesWithData) {
      try {
        // Check if site already exists
        const existing = await prisma.$queryRawUnsafe(
          `SELECT id FROM bing_user_property WHERE user_id = $1 AND site_url = $2`,
          site.user_id, site.site_url
        );

        if (existing.length > 0) {
          console.log(`⏭️  ${site.site_url} already exists`);
        } else {
          // Insert the site
          await prisma.$queryRawUnsafe(`
            INSERT INTO bing_user_property (user_id, site_url, enabled, sync_interval_hours, priority_order)
            VALUES ($1, $2, $3, $4, $5)
          `, site.user_id, site.site_url, site.enabled, site.sync_interval_hours, site.priority_order);

          console.log(`✅ Added ${site.site_url}`);
          addedCount++;
        }
      } catch (error) {
        console.log(`❌ Failed to add ${site.site_url}: ${error.message}`);
      }
    }

    console.log(`\n📊 Step 4: Verification...\n`);

    // Verify the table has data
    const allProperties = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM bing_user_property WHERE enabled = true`
    );

    console.log(`✅ bing_user_property table now has ${allProperties[0].count} enabled sites`);
    console.log(`✅ Added ${addedCount} new sites`);

    // Show some sample sites
    const sampleSites = await prisma.$queryRawUnsafe(
      `SELECT site_url, priority_order, enabled FROM bing_user_property WHERE enabled = true ORDER BY priority_order ASC, site_url ASC LIMIT 10`
    );

    console.log('\n📋 Sample sites now in bing_user_property:');
    sampleSites.forEach((site, index) => {
      console.log(`   ${index + 1}. ${site.site_url} (Priority: ${site.priority_order})`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('🎯 SUMMARY:');
    console.log('=' .repeat(60));
    console.log('✅ Created missing bing_user_property table');
    console.log(`✅ Added ${addedCount} sites to the table`);
    console.log('✅ Scheduler should now be able to find sites to process');
    console.log('✅ Next scheduler run should start collecting data');

    console.log('\n📋 Next Steps:');
    console.log('   1. Wait for next scheduler run (5 minutes)');
    console.log('   2. Check Vercel logs for scheduler activity');
    console.log('   3. Monitor Bing Monitor dashboard for data collection');
    console.log('   4. Verify pages data appears for sites that have it');

  } catch (error) {
    console.error('❌ Error fixing Bing scheduler setup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixBingSchedulerSetup();
