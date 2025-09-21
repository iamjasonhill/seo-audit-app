const { PrismaClient } = require('@prisma/client');

async function showBingDashboard() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 BING WEBMASTER TOOLS DATA DASHBOARD');
    console.log('=' .repeat(60));
    console.log(`📅 Generated: ${new Date().toLocaleString()}\n`);
    
    // Get all Bing properties with data
    console.log('📊 BING PROPERTIES WITH DATA:');
    console.log('-'.repeat(60));
    
    const propertiesWithData = await prisma.$queryRaw`
      SELECT 
        site_url,
        COUNT(DISTINCT date) as total_days,
        MIN(date) as earliest_date,
        MAX(date) as latest_date,
        SUM(clicks) as total_clicks,
        SUM(impressions) as total_impressions,
        AVG(ctr) as avg_ctr,
        AVG(position) as avg_position
      FROM bing_totals_daily 
      GROUP BY site_url 
      ORDER BY total_days DESC, total_clicks DESC
    `;
    
    if (propertiesWithData.length === 0) {
      console.log('❌ No Bing properties found with data');
      console.log('💡 Properties need to be registered and data collection started\n');
    } else {
      propertiesWithData.forEach((prop, index) => {
        console.log(`${index + 1}. 🌐 ${prop.site_url}`);
        console.log(`   📅 Date Range: ${prop.earliest_date.toISOString().split('T')[0]} to ${prop.latest_date.toISOString().split('T')[0]}`);
        console.log(`   📊 Total Days: ${prop.total_days}`);
        console.log(`   📈 Total Clicks: ${prop.total_clicks.toLocaleString()}`);
        console.log(`   👁️  Total Impressions: ${prop.total_impressions.toLocaleString()}`);
        console.log(`   📊 Avg CTR: ${(prop.avg_ctr * 100).toFixed(2)}%`);
        console.log(`   🎯 Avg Position: ${prop.avg_position.toFixed(1)}`);
        console.log('');
      });
    }
    
    // Get detailed breakdown for each property
    if (propertiesWithData.length > 0) {
      console.log('📋 DETAILED BREAKDOWN BY PROPERTY:');
      console.log('=' .repeat(60));
      
      for (const prop of propertiesWithData) {
        const siteUrl = prop.site_url;
        console.log(`\n🌐 ${siteUrl}`);
        console.log('-'.repeat(40));
        
        // Totals data
        const totalsData = await prisma.bingTotalsDaily.findMany({
          where: { siteUrl },
          orderBy: { date: 'asc' }
        });
        
        if (totalsData.length > 0) {
          const earliestDate = totalsData[0].date;
          const latestDate = totalsData[totalsData.length - 1].date;
          const totalDays = Math.ceil((latestDate - earliestDate) / (1000 * 60 * 60 * 24)) + 1;
          const actualDays = totalsData.length;
          const missingDays = totalDays - actualDays;
          const completeness = ((actualDays / totalDays) * 100).toFixed(1);
          
          console.log(`📈 TOTALS DATA:`);
          console.log(`   📅 Date Range: ${earliestDate.toISOString().split('T')[0]} to ${latestDate.toISOString().split('T')[0]}`);
          console.log(`   📊 Records: ${actualDays}/${totalDays} days (${completeness}% complete)`);
          console.log(`   ⚠️  Missing Days: ${missingDays}`);
          console.log(`   📈 Total Clicks: ${totalsData.reduce((sum, r) => sum + r.clicks, 0).toLocaleString()}`);
          console.log(`   👁️  Total Impressions: ${totalsData.reduce((sum, r) => sum + r.impressions, 0).toLocaleString()}`);
          
          // Check for recent data
          const today = new Date();
          const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
          const isUpToDate = latestDate >= twoDaysAgo;
          console.log(`   📅 Data Freshness: ${isUpToDate ? '✅ Up to date' : '⚠️  Outdated (latest: ' + latestDate.toISOString().split('T')[0] + ')'}`);
        }
        
        // Queries data
        const queriesData = await prisma.bingQueriesDaily.findMany({
          where: { siteUrl },
          orderBy: { date: 'asc' }
        });
        
        if (queriesData.length > 0) {
          const uniqueQueries = new Set(queriesData.map(r => r.query)).size;
          const earliestQueryDate = queriesData[0].date;
          const latestQueryDate = queriesData[queriesData.length - 1].date;
          
          console.log(`🔍 QUERIES DATA:`);
          console.log(`   📅 Date Range: ${earliestQueryDate.toISOString().split('T')[0]} to ${latestQueryDate.toISOString().split('T')[0]}`);
          console.log(`   📊 Total Records: ${queriesData.length.toLocaleString()}`);
          console.log(`   🔍 Unique Queries: ${uniqueQueries.toLocaleString()}`);
          console.log(`   📈 Total Clicks: ${queriesData.reduce((sum, r) => sum + r.clicks, 0).toLocaleString()}`);
          console.log(`   👁️  Total Impressions: ${queriesData.reduce((sum, r) => sum + r.impressions, 0).toLocaleString()}`);
        } else {
          console.log(`🔍 QUERIES DATA: ❌ No data`);
        }
        
        // Pages data
        const pagesData = await prisma.bingPagesDaily.findMany({
          where: { siteUrl },
          orderBy: { date: 'asc' }
        });
        
        if (pagesData.length > 0) {
          const uniquePages = new Set(pagesData.map(r => r.page)).size;
          const earliestPageDate = pagesData[0].date;
          const latestPageDate = pagesData[pagesData.length - 1].date;
          
          console.log(`📄 PAGES DATA:`);
          console.log(`   📅 Date Range: ${earliestPageDate.toISOString().split('T')[0]} to ${latestPageDate.toISOString().split('T')[0]}`);
          console.log(`   📊 Total Records: ${pagesData.length.toLocaleString()}`);
          console.log(`   📄 Unique Pages: ${uniquePages.toLocaleString()}`);
          console.log(`   📈 Total Clicks: ${pagesData.reduce((sum, r) => sum + r.clicks, 0).toLocaleString()}`);
          console.log(`   👁️  Total Impressions: ${pagesData.reduce((sum, r) => sum + r.impressions, 0).toLocaleString()}`);
        } else {
          console.log(`📄 PAGES DATA: ❌ No data`);
        }
        
        // Sync status
        const syncStatus = await prisma.bingSyncStatus.findMany({
          where: { siteUrl },
          orderBy: { dimension: 'asc' }
        });
        
        if (syncStatus.length > 0) {
          console.log(`📊 SYNC STATUS:`);
          syncStatus.forEach(status => {
            console.log(`   ${status.dimension}: ${status.status} (${status.message || 'No message'})`);
            console.log(`     Last synced: ${status.lastSyncedDate ? status.lastSyncedDate.toISOString().split('T')[0] : 'Never'}`);
            console.log(`     Last run: ${status.lastRunAt ? status.lastRunAt.toLocaleString() : 'Never'}`);
          });
        } else {
          console.log(`📊 SYNC STATUS: ❌ No status records`);
        }
      }
    }
    
    // Summary statistics
    console.log('\n📊 OVERALL SUMMARY:');
    console.log('=' .repeat(60));
    
    const totalTotals = await prisma.bingTotalsDaily.count();
    const totalQueries = await prisma.bingQueriesDaily.count();
    const totalPages = await prisma.bingPagesDaily.count();
    const totalSyncStatus = await prisma.bingSyncStatus.count();
    
    console.log(`📈 Total Records:`);
    console.log(`   📊 Totals: ${totalTotals.toLocaleString()}`);
    console.log(`   🔍 Queries: ${totalQueries.toLocaleString()}`);
    console.log(`   📄 Pages: ${totalPages.toLocaleString()}`);
    console.log(`   📊 Sync Status: ${totalSyncStatus.toLocaleString()}`);
    
    // Check registered properties
    try {
      const registeredProperties = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM bing_user_property
      `;
      console.log(`\n🏢 Registered Properties: ${registeredProperties[0].count}`);
    } catch (error) {
      console.log(`\n🏢 Registered Properties: ❌ Table not accessible`);
    }
    
    // Check API keys
    try {
      const apiKeys = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM bing_api_key
      `;
      console.log(`🔑 API Keys Configured: ${apiKeys[0].count}`);
    } catch (error) {
      console.log(`🔑 API Keys Configured: ❌ Table not accessible`);
    }
    
    // Data growth indicators
    if (totalTotals > 0) {
      console.log(`\n📈 DATA GROWTH INDICATORS:`);
      
      // Check if data is recent
      const recentData = await prisma.bingTotalsDaily.findMany({
        where: {
          date: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
          }
        },
        orderBy: { date: 'desc' },
        take: 1
      });
      
      if (recentData.length > 0) {
        console.log(`✅ Recent Activity: Data from ${recentData[0].date.toISOString().split('T')[0]}`);
      } else {
        console.log(`⚠️  No Recent Activity: No data in last 7 days`);
      }
      
      // Check data completeness
      const allDates = await prisma.$queryRaw`
        SELECT DISTINCT date FROM bing_totals_daily ORDER BY date DESC LIMIT 10
      `;
      
      if (allDates.length > 0) {
        console.log(`📅 Latest Data Dates:`);
        allDates.forEach((record, index) => {
          console.log(`   ${index + 1}. ${record.date.toISOString().split('T')[0]}`);
        });
      }
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log('💡 TIP: Run this script regularly to monitor data growth!');
    
  } catch (error) {
    console.error('❌ Error generating Bing dashboard:', error);
  } finally {
    await prisma.$disconnect();
  }
}

showBingDashboard();
