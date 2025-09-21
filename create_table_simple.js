require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTableSimple() {
  console.log('🔧 Creating bing_user_property table...\n');

  try {
    // Create the table with a simple CREATE TABLE statement
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS bing_user_property (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        site_url TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        sync_interval_hours INTEGER DEFAULT 24,
        priority_order INTEGER DEFAULT 0,
        last_full_sync_at TIMESTAMP,
        next_sync_due_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, site_url)
      )
    `;

    console.log('📋 Creating table with SQL:');
    console.log(createTableSQL);
    console.log('\n');

    await prisma.$queryRawUnsafe(createTableSQL);
    console.log('✅ Table created successfully!');

    // Create the index
    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_bing_user_property_scheduler
      ON bing_user_property(enabled, next_sync_due_at, priority_order, last_full_sync_at)
    `;

    console.log('📋 Creating index...');
    await prisma.$queryRawUnsafe(createIndexSQL);
    console.log('✅ Index created successfully!');

    // Verify the table exists
    const tableCheck = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'bing_user_property'
      ) as exists;
    `;

    if (tableCheck[0].exists) {
      console.log('\n✅ SUCCESS: bing_user_property table created!');
      console.log('✅ Production database is now synced with local migrations');
      console.log('✅ Scheduler should now be able to find sites to process');
    } else {
      console.log('\n❌ Failed to create bing_user_property table');
    }

  } catch (error) {
    console.error('❌ Error creating table:', error);
    console.log('\n📋 This might be because:');
    console.log('   - Table already exists');
    console.log('   - Permission issues');
    console.log('   - Database connection issues');
  } finally {
    await prisma.$disconnect();
  }
}

createTableSimple();
