# Database Setup Guide

This guide will help you set up PostgreSQL for the SEO Audit App, both locally and for Vercel deployment.

## 🏠 Local Development Setup

### 1. Install PostgreSQL

**macOS (using Homebrew):**
```bash
brew install postgresql
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/)

### 2. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database and user
CREATE DATABASE seo_audit_db;
CREATE USER seo_audit_user WITH PASSWORD 'your_password_here';
GRANT ALL PRIVILEGES ON DATABASE seo_audit_db TO seo_audit_user;
\q
```

### 3. Configure Environment Variables

Copy the example environment file:
```bash
cp env.example .env
```

Update `.env` with your database credentials:
```env
DATABASE_URL="postgresql://seo_audit_user:your_password_here@localhost:5432/seo_audit_db"
```

### 4. Initialize Database Schema

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Or run migrations (for production)
npm run db:migrate
```

### 5. Verify Setup

```bash
# Start the application
npm start

# Check database connection in logs
# You should see: "Database connection established"
```

## 🚀 Vercel Deployment Setup

### 1. Create Vercel Postgres Database

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to your project
3. Go to **Storage** tab
4. Click **Create Database** → **Postgres**
5. Choose a name (e.g., `seo-audit-db`)
6. Select a region close to your users

### 2. Configure Environment Variables

In your Vercel project settings:

1. Go to **Settings** → **Environment Variables**
2. Add the following variables:

```env
DATABASE_URL=postgresql://username:password@host:port/database
NODE_ENV=production
```

**Note:** The `DATABASE_URL` is automatically provided by Vercel Postgres.

### 3. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set up database schema on production
vercel env pull .env.production
npx prisma db push --schema=./prisma/schema.prisma
```

## 📊 Database Schema

The application uses the following tables:

### `audits`
- Stores basic audit information
- Fields: `id`, `site_url`, `site_type`, `created_at`, `updated_at`

### `audit_results`
- Stores complete audit results as JSONB
- Fields: `id`, `audit_id`, `results_data`, `created_at`

### `audit_history`
- Stores key metrics for trending analysis
- Fields: `id`, `audit_id`, `metric_name`, `metric_value`, `created_at`

### `audit_comparisons`
- Stores audit comparison data
- Fields: `id`, `base_audit_id`, `compare_audit_id`, `comparison_data`, `created_at`

## 🔧 Database Management Commands

```bash
# Generate Prisma client
npm run db:generate

# Push schema changes
npm run db:push

# Run migrations
npm run db:migrate

# Open Prisma Studio (database GUI)
npm run db:studio

# Seed database (if seed file exists)
npm run db:seed
```

## 📈 Monitoring and Maintenance

### Database Performance
- Monitor query performance in Prisma Studio
- Use database indexes for frequently queried fields
- Consider connection pooling for high traffic

### Backup Strategy
- Vercel Postgres includes automatic backups
- For local development, use `pg_dump` for backups

### Scaling Considerations
- Vercel Postgres scales automatically
- Consider read replicas for high-traffic applications
- Monitor database connection limits

## 🚨 Troubleshooting

### Common Issues

**Connection Refused:**
- Check if PostgreSQL is running
- Verify connection string format
- Ensure firewall allows connections

**Permission Denied:**
- Check user permissions
- Verify database exists
- Confirm password is correct

**Schema Sync Issues:**
- Run `npm run db:generate` first
- Use `npm run db:push` for development
- Use `npm run db:migrate` for production

### Getting Help

1. Check application logs for database errors
2. Use Prisma Studio to inspect data
3. Verify environment variables are set correctly
4. Test database connection independently

## 🔐 Security Best Practices

1. **Never commit `.env` files** to version control
2. **Use strong passwords** for database users
3. **Limit database user permissions** to minimum required
4. **Enable SSL connections** in production
5. **Regularly update** PostgreSQL and Prisma versions
6. **Monitor access logs** for suspicious activity

## 📚 Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs/)
- [Vercel Postgres Documentation](https://vercel.com/docs/storage/vercel-postgres)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Database Design Best Practices](https://www.postgresql.org/docs/current/ddl.html)
