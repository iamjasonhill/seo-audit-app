const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const logger = require('./src/utils/logger');
const rateLimiter = require('./src/middleware/rateLimiter');
const gscRateLimiter = require('./src/middleware/gscRateLimiter');
const errorHandler = require('./src/middleware/errorHandler');
const databaseService = require('./src/services/database');
const gscScheduler = require('./src/services/gscScheduler');
const bingScheduler = require('./src/services/bingScheduler');

// Import routes
const auditRoutes = require('./src/routes/audit');
const reportRoutes = require('./src/routes/reports');
const authRoutes = require('./src/routes/auth');
const authGoogleRoutes = require('./src/routes/auth_google');
const gscRoutes = require('./src/routes/gsc');
const adminRoutes = require('./src/routes/admin');
const bingRoutes = require('./src/routes/bing');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// Compression and logging
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Rate limiting
app.use(rateLimiter);

// Body parsing and cookies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth/google', authGoogleRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/gsc', gscRateLimiter, gscRoutes);
app.use('/api/bing', bingRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Serve the main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve dashboard page
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve report page
app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

// Serve property page
app.get('/property', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'property.html'));
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Not Found', 
    message: 'The requested resource was not found' 
  });
});

// Start server
app.listen(PORT, async () => {
  logger.info(`SEO Audit App running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Initialize database connection
  try {
    await databaseService.connect();
    logger.info('Database connection established');
    if (process.env.SCHEDULER_ENABLED === 'true') {
      gscScheduler.start(60000);
      bingScheduler.start(300000); // 5 minutes for Bing
      logger.info('GSC and Bing Schedulers enabled');
    }
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    // Don't exit the process, but log the error
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await databaseService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await databaseService.disconnect();
  process.exit(0);
});

module.exports = app;
