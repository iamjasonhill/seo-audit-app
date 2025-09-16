const express = require('express');
const Joi = require('joi');
const SEOAuditor = require('../core/SEOAuditor');
const logger = require('../utils/logger');
const databaseService = require('../services/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Validation schema for audit request
const auditSchema = Joi.object({
  siteUrl: Joi.string().uri().required(),
  siteType: Joi.string().valid('Generic', 'SaaS', 'Ecommerce', 'Agency', 'Local').default('Generic')
});

// POST /api/audit - Start a new SEO audit
router.post('/', requireAuth, async (req, res, next) => {
  try {
    // Validate request body
    const { error, value } = auditSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { siteUrl, siteType } = value;
    
    logger.info(`Starting SEO audit for ${siteUrl} (${siteType})`);
    
    // Create audit record in database
    const audit = await databaseService.createAudit(siteUrl, siteType);
    
    // Create and run SEO audit
    const auditor = new SEOAuditor(siteUrl, siteType);
    const results = await auditor.runFullAudit();
    
    // Save audit results to database
    await databaseService.saveAuditResults(audit.id, results);
    
    res.json({
      success: true,
      auditId: audit.id,
      message: 'SEO audit completed successfully',
      results: results,
      timestamp: audit.createdAt
    });
    
  } catch (error) {
    logger.error('Error during SEO audit:', error);
    next(error);
  }
});

// GET /api/audit/:auditId - Get audit results by ID
router.get('/:auditId', requireAuth, async (req, res, next) => {
  try {
    const { auditId } = req.params;
    
    const audit = await databaseService.getAudit(auditId);
    if (!audit) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Audit not found'
      });
    }

    const results = await databaseService.getAuditResults(auditId);
    
    res.json({
      success: true,
      audit: {
        id: audit.id,
        siteUrl: audit.siteUrl,
        siteType: audit.siteType,
        createdAt: audit.createdAt,
        updatedAt: audit.updatedAt
      },
      results: results ? results.resultsData : null
    });
    
  } catch (error) {
    logger.error('Error fetching audit results:', error);
    next(error);
  }
});

// POST /api/audit/quick - Quick audit for specific checks
router.post('/quick', requireAuth, async (req, res, next) => {
  try {
    const { error, value } = auditSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { siteUrl, siteType } = value;
    const { checks } = req.body; // Array of specific checks to run
    
    logger.info(`Starting quick SEO audit for ${siteUrl}`);
    
    const auditor = new SEOAuditor(siteUrl, siteType);
    const results = {};
    
    // Run only requested checks
    if (checks.includes('technical')) {
      results.technical = await auditor.analyzeTechnicalHealth();
    }
    
    if (checks.includes('onpage')) {
      results.onPage = await auditor.analyzeOnPageOptimization();
    }
    
    if (checks.includes('indexation')) {
      results.indexation = await auditor.checkIndexationAndVisibility();
    }
    
    res.json({
      success: true,
      message: 'Quick SEO audit completed',
      results: results
    });
    
  } catch (error) {
    logger.error('Error during quick SEO audit:', error);
    next(error);
  }
});

// GET /api/audit/status/:auditId - Check audit status
router.get('/status/:auditId', requireAuth, async (req, res, next) => {
  try {
    const { auditId } = req.params;
    
    // In a real app, you'd check actual status from database
    res.json({
      auditId: auditId,
      status: 'completed',
      message: 'Audit status checking not fully implemented'
    });
    
  } catch (error) {
    logger.error('Error checking audit status:', error);
    next(error);
  }
});

// Helper function to generate audit ID
// GET /api/audit/history/:siteUrl - Get audit history for a site
router.get('/history/:siteUrl', requireAuth, async (req, res, next) => {
  try {
    const { siteUrl } = req.params;
    const { limit = 10 } = req.query;
    
    const history = await databaseService.getAuditHistory(siteUrl, parseInt(limit));
    
    res.json({
      success: true,
      siteUrl,
      history: history.map(audit => ({
        id: audit.id,
        siteType: audit.siteType,
        createdAt: audit.createdAt,
        hasResults: audit.results.length > 0,
        latestResults: audit.results[0]?.resultsData || null
      }))
    });
    
  } catch (error) {
    logger.error('Error fetching audit history:', error);
    next(error);
  }
});

// GET /api/audit/trends/:siteUrl - Get audit trends for a site
router.get('/trends/:siteUrl', requireAuth, async (req, res, next) => {
  try {
    const { siteUrl } = req.params;
    const { metric = 'performance_score', days = 30 } = req.query;
    
    const trends = await databaseService.getAuditTrends(siteUrl, metric, parseInt(days));
    
    res.json({
      success: true,
      siteUrl,
      metric,
      days: parseInt(days),
      trends: trends.map(trend => ({
        date: trend.createdAt,
        value: trend.metricValue,
        auditId: trend.auditId
      }))
    });
    
  } catch (error) {
    logger.error('Error fetching audit trends:', error);
    next(error);
  }
});

// GET /api/audit/list - Get all audits (paginated)
router.get('/list', requireAuth, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const audits = await databaseService.getAllAudits(parseInt(limit), parseInt(offset));
    
    res.json({
      success: true,
      audits: audits.map(audit => ({
        id: audit.id,
        siteUrl: audit.siteUrl,
        siteType: audit.siteType,
        createdAt: audit.createdAt,
        hasResults: audit.results.length > 0
      })),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: audits.length
      }
    });
    
  } catch (error) {
    logger.error('Error fetching audit list:', error);
    next(error);
  }
});

// DELETE /api/audit/:auditId - Delete an audit
router.delete('/:auditId', requireAuth, async (req, res, next) => {
  try {
    const { auditId } = req.params;
    
    await databaseService.deleteAudit(auditId);
    
    res.json({
      success: true,
      message: 'Audit deleted successfully'
    });
    
  } catch (error) {
    logger.error('Error deleting audit:', error);
    next(error);
  }
});

function generateAuditId() {
  return 'audit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

module.exports = router;
