require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugSchedulerSites() {
  console.log('🔍 Analyzing Bing Scheduler Site Priority...\n');

  try {
    const now = new Date();
    console.log(`📅 Current time: ${now.toISOString()}\n`);

    // Get sites in the same order the scheduler processes them
    const rows = await prisma.BingUserProperty.findMany({
      where: {
        enabled: true,
        OR: [
          { nextSyncDueAt: null },
          { nextSyncDueAt: { lte: now } }
        ]
      },
      orderBy: [
        { nextSyncDueAt: 'asc' },
        { priorityOrder: 'asc' },
        { lastFullSyncAt: 'asc' }
      ],
      take: 20
    });

    console.log('=' .repeat(100));
    console.log('📋 SITES IN SCHEDULER PROCESSING ORDER (Next 20):');
    console.log('=' .repeat(100));

    rows.forEach((row, index) => {
      console.log(`${(index + 1).toString().padStart(2, ' ')}. ${row.siteUrl}`);
      console.log(`    📅 Next due: ${row.nextSyncDueAt || 'ASAP'}`);
      console.log(`    🎯 Priority: ${row.priorityOrder || 'N/A'}`);
      console.log(`    ⏰ Last sync: ${row.lastFullSyncAt || 'Never'}`);
      console.log('');
    });

    // Also get sites that are NOT due yet but would be processed next
    const upcomingRows = await prisma.BingUserProperty.findMany({
      where: {
        enabled: true,
        nextSyncDueAt: { gt: now }
      },
      orderBy: [
        { nextSyncDueAt: 'asc' },
        { priorityOrder: 'asc' },
        { lastFullSyncAt: 'asc' }
      ],
      take: 10
    });

    console.log('=' .repeat(100));
    console.log('📋 UPCOMING SITES (Next 10):');
    console.log('=' .repeat(100));

    upcomingRows.forEach((row, index) => {
      console.log(`${(index + 1).toString().padStart(2, ' ')}. ${row.siteUrl}`);
      console.log(`    📅 Next due: ${row.nextSyncDueAt}`);
      console.log(`    🎯 Priority: ${row.priorityOrder || 'N/A'}`);
      console.log(`    ⏰ Last sync: ${row.lastFullSyncAt || 'Never'}`);
      console.log('');
    });

    // Get sites that DO have queries data (from user's dashboard)
    const sitesWithQueries = [
      'https://movemycar.com.au/',
      'http://movemycar.com.au/',
      'http://www.interstatecarcarriers.com.au/',
      'https://wemove.com.au/',
      'https://movingagain.com.au/',
      'https://www.backloading-au.com.au/',
      'https://backloadingremovals.com.au/',
      'http://www.discountbackloading.com.au/',
    ];

    console.log('=' .repeat(100));
    console.log('🎯 SITES WITH QUERIES DATA (Priority Check):');
    console.log('=' .repeat(100));

    for (const siteUrl of sitesWithQueries) {
      const site = rows.find(r => r.site_url === siteUrl) || upcomingRows.find(r => r.site_url === siteUrl);
      if (site) {
        console.log(`✅ ${siteUrl}`);
        console.log(`    📅 Next due: ${site.next_sync_due_at || 'ASAP'}`);
        console.log(`    🎯 Priority: ${site.priority_order || 'N/A'}`);
        console.log(`    ⏰ Last sync: ${site.last_full_sync_at || 'Never'}`);
        console.log('');
      } else {
        console.log(`❌ ${siteUrl} - Not found in enabled sites`);
        console.log('');
      }
    }

    console.log('=' .repeat(100));
    console.log('🎯 ANALYSIS:');
    console.log('=' .repeat(100));

    console.log('📋 The scheduler processes sites in this order:');
    console.log('   1. Sites that are due (next_sync_due_at <= now)');
    console.log('   2. By priority_order (lowest number first)');
    console.log('   3. By last_full_sync_at (oldest first)');

    console.log('\n📊 Key sites with queries data and their priority:');
    const keySites = rows.filter(r => sitesWithQueries.includes(r.site_url));
    if (keySites.length > 0) {
      console.log('✅ Good news: Sites with queries data are being processed!');
      keySites.forEach(site => {
        console.log(`   - ${site.site_url} (Priority: ${site.priority_order || 'N/A'})`);
      });
    } else {
      console.log('❌ Sites with queries data are not in the current processing queue.');
    }

    console.log('\n🔍 The issue might be:');
    console.log('   1. Sites being processed first don\'t have pages data available');
    console.log('   2. Pages processing logic still has issues');
    console.log('   3. Need to test pages API on sites that DO have queries data');

  } catch (error) {
    console.error('❌ Error analyzing scheduler sites:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugSchedulerSites();
