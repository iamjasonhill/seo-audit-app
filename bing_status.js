const { PrismaClient } = require('@prisma/client');

async function showBingStatus() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 BING DATA STATUS - ' + new Date().toLocaleString());
    console.log('=' .repeat(50));
    
    // Quick summary
    const totalTotals = await prisma.bingTotalsDaily.count();
    const totalQueries = await prisma.bingQueriesDaily.count();
    const totalPages = await prisma.bingPagesDaily.count();
    
    console.log(`📊 Records: ${totalTotals} totals, ${totalQueries} queries, ${totalPages} pages`);
    
    if (totalTotals === 0) {
      console.log('❌ No data collected yet');
      console.log('💡 Register properties and start data collection');
      return;
    }
    
    // Get properties with data
    const properties = await prisma.$queryRaw`
      SELECT 
        site_url,
        COUNT(DISTINCT date) as days,
        MIN(date) as earliest,
        MAX(date) as latest,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions
      FROM bing_totals_daily 
      GROUP BY site_url 
      ORDER BY days DESC
    `;
    
    console.log(`\n🌐 Properties (${properties.length}):`);
    properties.forEach((prop, i) => {
      const daysAgo = Math.floor((new Date() - new Date(prop.latest)) / (1000 * 60 * 60 * 24));
      const freshness = daysAgo <= 2 ? '✅' : daysAgo <= 7 ? '⚠️' : '❌';
      
      console.log(`${i + 1}. ${prop.site_url}`);
      console.log(`   📅 ${prop.earliest.toISOString().split('T')[0]} to ${prop.latest.toISOString().split('T')[0]} (${prop.days} days)`);
      console.log(`   📈 ${prop.clicks.toLocaleString()} clicks, ${prop.impressions.toLocaleString()} impressions`);
      console.log(`   ${freshness} ${daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : daysAgo + ' days ago'}`);
    });
    
    // Data growth check
    const recentData = await prisma.bingTotalsDaily.findMany({
      where: {
        date: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      },
      orderBy: { date: 'desc' },
      take: 5
    });
    
    if (recentData.length > 0) {
      console.log(`\n📈 Recent Activity (last 7 days):`);
      recentData.forEach(record => {
        console.log(`   ${record.date.toISOString().split('T')[0]}: ${record.siteUrl} - ${record.clicks} clicks`);
      });
    } else {
      console.log(`\n⚠️  No recent activity (last 7 days)`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

showBingStatus();
