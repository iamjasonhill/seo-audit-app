const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    });
  }

  async connect() {
    try {
      if (!process.env.DATABASE_URL) {
        logger.warn('DATABASE_URL not found, running in fallback mode');
        return;
      }
      await this.prisma.$connect();
      logger.info('Database connected successfully');
    } catch (error) {
      logger.error('Database connection failed:', error);
      logger.warn('Running in fallback mode without database');
      // Don't throw error, allow app to run without database
    }
  }

  async disconnect() {
    try {
      if (!process.env.DATABASE_URL) {
        return;
      }
      await this.prisma.$disconnect();
      logger.info('Database disconnected successfully');
    } catch (error) {
      logger.error('Database disconnection failed:', error);
    }
  }

  // Audit Management
  async createAudit(siteUrl, siteType) {
    try {
      if (!process.env.DATABASE_URL) {
        // Fallback: return a mock audit object
        const mockAudit = {
          id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          siteUrl,
          siteType,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        logger.info(`Created mock audit ${mockAudit.id} for ${siteUrl}`);
        return mockAudit;
      }
      
      const audit = await this.prisma.audit.create({
        data: {
          siteUrl,
          siteType,
        },
      });
      logger.info(`Created audit ${audit.id} for ${siteUrl}`);
      return audit;
    } catch (error) {
      logger.error('Error creating audit:', error);
      throw error;
    }
  }

  async saveAuditResults(auditId, resultsData) {
    try {
      if (!process.env.DATABASE_URL) {
        // Fallback: just log that we would save results
        logger.info(`Would save audit results for audit ${auditId} (fallback mode)`);
        return { id: 'mock_result_' + Date.now(), auditId, resultsData, createdAt: new Date() };
      }
      
      const auditResult = await this.prisma.auditResult.create({
        data: {
          auditId,
          resultsData,
        },
      });

      // Extract key metrics for history tracking
      await this.saveAuditHistory(auditId, resultsData);

      logger.info(`Saved audit results for audit ${auditId}`);
      return auditResult;
    } catch (error) {
      logger.error('Error saving audit results:', error);
      throw error;
    }
  }

  async saveAuditHistory(auditId, resultsData) {
    try {
      const historyEntries = [];

      // Extract key metrics for trending
      if (resultsData.technical?.pageSpeed) {
        const ps = resultsData.technical.pageSpeed;
        if (ps.performance?.score !== undefined) historyEntries.push({
          auditId,
          metricName: 'performance_score',
          metricValue: ps.performance.score,
        });
        if (ps.accessibility?.score !== undefined) historyEntries.push({
          auditId,
          metricName: 'accessibility_score',
          metricValue: ps.accessibility.score,
        });
        if (ps.seo?.score !== undefined) historyEntries.push({
          auditId,
          metricName: 'seo_score',
          metricValue: ps.seo.score,
        });
      }

      if (resultsData.technical?.https?.securityScore) {
        historyEntries.push({
          auditId,
          metricName: 'security_score',
          metricValue: resultsData.technical.https.securityScore,
        });
      }

      if (resultsData.technical?.mobileResponsive?.overallScore) {
        historyEntries.push({
          auditId,
          metricName: 'mobile_score',
          metricValue: resultsData.technical.mobileResponsive.overallScore,
        });
      }

      if (historyEntries.length > 0) {
        await this.prisma.auditHistory.createMany({
          data: historyEntries,
        });
        logger.info(`Saved ${historyEntries.length} history entries for audit ${auditId}`);
      }
    } catch (error) {
      logger.error('Error saving audit history:', error);
      // Don't throw here as it's not critical
    }
  }

  async getAudit(auditId) {
    try {
      const audit = await this.prisma.audit.findUnique({
        where: { id: auditId },
        include: {
          results: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      return audit;
    } catch (error) {
      logger.error('Error fetching audit:', error);
      throw error;
    }
  }

  async getAuditResults(auditId) {
    try {
      const results = await this.prisma.auditResult.findFirst({
        where: { auditId },
        orderBy: { createdAt: 'desc' },
      });
      return results;
    } catch (error) {
      logger.error('Error fetching audit results:', error);
      throw error;
    }
  }

  async getAuditHistory(siteUrl, limit = 10) {
    try {
      const audits = await this.prisma.audit.findMany({
        where: { siteUrl },
        include: {
          results: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          history: {
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return audits;
    } catch (error) {
      logger.error('Error fetching audit history:', error);
      throw error;
    }
  }

  async getAuditTrends(siteUrl, metricName, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const trends = await this.prisma.auditHistory.findMany({
        where: {
          audit: {
            siteUrl,
          },
          metricName,
          createdAt: {
            gte: startDate,
          },
        },
        include: {
          audit: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      return trends;
    } catch (error) {
      logger.error('Error fetching audit trends:', error);
      throw error;
    }
  }

  async getAllAudits(limit = 50, offset = 0) {
    try {
      const audits = await this.prisma.audit.findMany({
        include: {
          results: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });
      return audits;
    } catch (error) {
      logger.error('Error fetching all audits:', error);
      throw error;
    }
  }

  async deleteAudit(auditId) {
    try {
      if (!process.env.DATABASE_URL) {
        logger.warn('DATABASE_URL not configured - deleteAudit skipped in fallback mode');
        return false;
      }

      await this.prisma.audit.delete({
        where: { id: auditId },
      });
      logger.info(`Deleted audit ${auditId}`);
      return true;
    } catch (error) {
      if (error.code === 'P2025') {
        const notFoundError = new Error('Audit not found');
        notFoundError.status = 404;
        throw notFoundError;
      }
      logger.error('Error deleting audit:', error);
      throw error;
    }
  }

  // Comparison features
  async createAuditComparison(baseAuditId, compareAuditId, comparisonData) {
    try {
      const comparison = await this.prisma.auditComparison.create({
        data: {
          baseAuditId,
          compareAuditId,
          comparisonData,
        },
      });
      logger.info(`Created audit comparison ${comparison.id}`);
      return comparison;
    } catch (error) {
      logger.error('Error creating audit comparison:', error);
      throw error;
    }
  }

  async getAuditComparison(comparisonId) {
    try {
      const comparison = await this.prisma.auditComparison.findUnique({
        where: { id: comparisonId },
      });
      return comparison;
    } catch (error) {
      logger.error('Error fetching audit comparison:', error);
      throw error;
    }
  }
}

// Singleton instance
const databaseService = new DatabaseService();

module.exports = databaseService;
