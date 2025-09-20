const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main(){
  const username = process.env.ADMIN_INITIAL_USERNAME;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  const email = process.env.ADMIN_INITIAL_EMAIL || `${username}@local`;
  if (!username || !password) {
    console.log('Seed skipped: ADMIN_INITIAL_USERNAME and ADMIN_INITIAL_PASSWORD not set');
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { username, passwordHash: hash, role: 'admin', status: 'active' },
    create: { email, username, passwordHash: hash, role: 'admin', status: 'active' },
  });
  console.log('Seed admin ensured:', { id: user.id, email: user.email, username: user.username });
}

main().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1); });


