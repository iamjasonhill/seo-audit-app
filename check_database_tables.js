require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDatabaseTables() {
  console.log('🔍 Checking available database tables...\n');

  try {
    // Get all table names from the database
    const tables = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    console.log('=' .repeat(60));
    console.log('📋 AVAILABLE DATABASE TABLES:');
    console.log('=' .repeat(60));

    tables.forEach((table, index) => {
      console.log(`${(index + 1).toString().padStart(2, ' ')}. ${table.table_name}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('🎯 ANALYSIS:');
    console.log('=' .repeat(60));

    const bingTables = tables.filter(t => t.table_name.startsWith('bing'));
    const otherTables = tables.filter(t => !t.table_name.startsWith('bing'));

    console.log(`📊 Bing-related tables: ${bingTables.length}`);
    if (bingTables.length > 0) {
      bingTables.forEach(table => {
        console.log(`   - ${table.table_name}`);
      });
    } else {
      console.log('   ❌ No Bing tables found!');
    }

    console.log(`\n📊 Other tables: ${otherTables.length}`);
    otherTables.forEach(table => {
      console.log(`   - ${table.table_name}`);
    });

    // Check if we can query any Bing-related data
    if (bingTables.length > 0) {
      console.log('\n📊 Checking if Bing data exists...');
      for (const table of bingTables.slice(0, 3)) { // Check first 3 tables
        try {
          const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "${table.table_name}"`);
          console.log(`   ${table.table_name}: ${count[0].count} records`);
        } catch (error) {
          console.log(`   ${table.table_name}: Error querying (${error.message})`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error checking database tables:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabaseTables();
