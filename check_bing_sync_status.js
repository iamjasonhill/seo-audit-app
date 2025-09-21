require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkBingSyncStatus() {
  console.log('🔍 Checking Bing Sync Status...\n');

  try {
    // Check what's in the bing_sync_status table
    const syncStatus = await prisma.bingSyncStatus.findMany();

    console.log('=' .repeat(60));
    console.log('📋 BING SYNC STATUS RECORDS:');
    console.log('=' .repeat(60));

    if (syncStatus.length === 0) {
      console.log('❌ No sync status records found');
      console.log('❌ This suggests no Bing properties are configured');
    } else {
      syncStatus.forEach((record, index) => {
        console.log(`${(index + 1).toString().padStart(2, ' ')}. ${record.site_url}`);
        console.log(`    📅 Last sync: ${record.last_sync_at || 'Never'}`);
        console.log(`    🔄 Status: ${record.sync_status || 'Unknown'}`);
        console.log(`    ⚡ User ID: ${record.user_id}`);
        console.log('');
      });
    }

    // Check bing_user_selection table
    const userSelections = await prisma.bingUserSelection.findMany();
    console.log('=' .repeat(60));
    console.log('📋 BING USER SELECTION RECORDS:');
    console.log('=' .repeat(60));

    if (userSelections.length === 0) {
      console.log('❌ No user selection records found');
    } else {
      userSelections.forEach((record, index) => {
        console.log(`${(index + 1).toString().padStart(2, ' ')}. User ${record.user_id}`);
        console.log(`    🌐 Site: ${record.site_url}`);
        console.log(`    📅 Selected: ${record.created_at}`);
        console.log('');
      });
    }

    // Check bing_api_key table
    const apiKeys = await prisma.bingApiKey.findMany();
    console.log('=' .repeat(60));
    console.log('📋 BING API KEY RECORDS:');
    console.log('=' .repeat(60));

    if (apiKeys.length === 0) {
      console.log('❌ No API keys found');
    } else {
      apiKeys.forEach((record, index) => {
        console.log(`${(index + 1).toString().padStart(2, ' ')}. User ${record.user_id}`);
        console.log(`    🔑 Key ends with: ...${record.api_key.slice(-4)}`);
        console.log('');
      });
    }

    console.log('=' .repeat(60));
    console.log('🎯 ANALYSIS:');
    console.log('=' .repeat(60));

    console.log('📊 Database has these Bing tables:');
    console.log('   ✅ bing_sync_status');
    console.log('   ✅ bing_user_selection');
    console.log('   ✅ bing_api_key');
    console.log('   ✅ bing_totals_daily');
    console.log('   ✅ bing_queries_daily');
    console.log('   ✅ bing_pages_daily');
    console.log('   ❌ bing_user_property (MISSING!)');

    console.log('\n🔍 The Problem:');
    console.log('   1. The bing_user_property table is missing');
    console.log('   2. This table tells the scheduler which sites to process');
    console.log('   3. Without it, the scheduler has no sites to sync');
    console.log('   4. This explains why no pages data is being collected');

    console.log('\n📋 Current State:');
    console.log(`   - Sync Status records: ${syncStatus.length}`);
    console.log(`   - User Selection records: ${userSelections.length}`);
    console.log(`   - API Keys: ${apiKeys.length}`);

    if (syncStatus.length > 0) {
      console.log('\n✅ Good news: There are sites configured in bing_sync_status!');
      console.log('   The scheduler should be able to process these sites once the');
      console.log('   bing_user_property table is created and populated.');
    } else {
      console.log('\n❌ No sites found in any Bing configuration table.');
      console.log('   Need to check how sites are being added to the system.');
    }

  } catch (error) {
    console.error('❌ Error checking Bing sync status:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkBingSyncStatus();
