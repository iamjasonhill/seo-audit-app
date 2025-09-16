const express = require('express');
const Joi = require('joi');
const SEOAuditor = require('../core/SEOAuditor');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schema for audit request
const auditSchema = Joi.object({
  siteUrl: Joi.string().uri().required(),
  siteType: Joi.string().valid('Generic', 'SaaS', 'Ecommerce', 'Agency', 'Local').default('Generic')
});

// POST /api/audit - Start a new SEO audit
router.post('/', async (req, res, next) => {
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
    
    // Create and run SEO audit
    const auditor = new SEOAuditor(siteUrl, siteType);
    const results = await auditor.runFullAudit();
    
    // Store audit results (in a real app, you'd save to database)
    const auditId = generateAuditId();
    req.auditResults = { auditId, results };
    
    res.json({
      success: true,
      auditId: auditId,
      message: 'SEO audit completed successfully',
      results: results
    });
    
  } catch (error) {
    logger.error('Error during SEO audit:', error);
    next(error);
  }
});

// GET /api/audit/:auditId - Get audit results by ID
router.get('/:auditId', async (req, res, next) => {
  try {
    const { auditId } = req.params;
    
    // In a real app, you'd fetch from database
    // For now, return a placeholder
    res.json({
      error: 'Not Implemented',
      message: 'Audit result storage not implemented yet. Results are only available immediately after audit completion.'
    });
    
  } catch (error) {
    logger.error('Error fetching audit results:', error);
    next(error);
  }
});

// POST /api/audit/quick - Quick audit for specific checks
router.post('/quick', async (req, res, next) => {
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
router.get('/status/:auditId', async (req, res, next) => {
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
function generateAuditId() {
  return 'audit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

module.exports = router;
