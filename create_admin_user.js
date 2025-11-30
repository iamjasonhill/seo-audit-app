const bcrypt = require('bcryptjs');
const databaseService = require('./src/services/database');
const logger = require('./src/utils/logger');

async function createAdminUser() {
  try {
    console.log('🔧 Creating admin user...\n');

    // Connect to database
    await databaseService.connect();
    console.log('✅ Database connected\n');

    // Admin user details
    const adminData = {
      email: 'admin@example.com',
      username: 'admin',
      password: 'Admin123!@#', // Change this password after first login!
      name: 'Admin User',
      role: 'admin',
      status: 'active'
    };

    // Check if admin user already exists
    const existingUser = await databaseService.prisma.user.findFirst({
      where: {
        OR: [
          { email: adminData.email },
          { username: adminData.username }
        ]
      }
    });

    if (existingUser) {
      console.log('⚠️  Admin user already exists!');
      console.log(`   Email: ${existingUser.email}`);
      console.log(`   Username: ${existingUser.username}`);
      console.log(`   Role: ${existingUser.role}`);
      console.log(`   Status: ${existingUser.status}\n`);
      
      // Ask if user wants to reset password
      console.log('To reset the password, delete the user first and run this script again.\n');
      console.log('To delete the user, run:');
      console.log(`   DELETE FROM users WHERE email = '${existingUser.email}';\n`);
      
      await databaseService.disconnect();
      return;
    }

    // Hash the password
    console.log('🔐 Hashing password...');
    const passwordHash = await bcrypt.hash(adminData.password, 12);
    console.log('✅ Password hashed\n');

    // Create the admin user
    console.log('👤 Creating admin user in database...');
    const user = await databaseService.prisma.user.create({
      data: {
        email: adminData.email,
        username: adminData.username,
        passwordHash: passwordHash,
        name: adminData.name,
        role: adminData.role,
        status: adminData.status
      }
    });

    console.log('✅ Admin user created successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 LOGIN CREDENTIALS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Username: ${adminData.username}`);
    console.log(`Password: ${adminData.password}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('⚠️  IMPORTANT: Change this password after first login!\n');
    console.log('🌐 Login at: http://localhost:3000/login\n');

    // Disconnect from database
    await databaseService.disconnect();
    console.log('✅ Done!\n');

  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    await databaseService.disconnect();
    process.exit(1);
  }
}

// Run the script
createAdminUser();
