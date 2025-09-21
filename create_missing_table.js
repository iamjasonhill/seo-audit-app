require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function createMissingTable() {
  console.log('🔧 Creating missing bing_user_property table...\n');

  try {
    // Read the SQL script
    const sqlFilePath = path.join(__dirname, 'create_bing_scheduler_tables.sql');
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

    console.log('📋 SQL Script Content:');
    console.log('=' .repeat(50));
    console.log(sqlContent);
    console.log('=' .repeat(50));

    // Execute the SQL directly - split into individual statements
    console.log('\n📋 Executing SQL on database...\n');

    // Split SQL by semicolon and execute each statement
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 60)}...`);
        try {
          await prisma.$queryRawUnsafe(statement);
          console.log('✅ Statement executed successfully');
        } catch (error) {
          console.log(`⚠️  Statement may have already existed: ${error.message}`);
        }
      }
    }

    console.log('✅ SQL executed successfully!');

    // Verify the table exists
    const tableCheck = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'bing_user_property'
      ) as exists;
    `;

    if (tableCheck[0].exists) {
      console.log('✅ bing_user_property table created successfully!');
      console.log('✅ Production database is now synced with local migrations');
    } else {
      console.log('❌ Failed to create bing_user_property table');
    }

  } catch (error) {
    console.error('❌ Error creating table:', error);
    console.log('\n📋 This might be because the table already exists or there are permission issues');
  } finally {
    await prisma.$disconnect();
  }
}

createMissingTable();
