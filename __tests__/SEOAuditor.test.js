const SEOAuditor = require('../src/core/SEOAuditor');

describe('SEOAuditor', () => {
  let auditor;

  beforeEach(() => {
    auditor = new SEOAuditor('https://example.com', 'Generic');
  });

  describe('Constructor', () => {
    test('should initialize with correct properties', () => {
      expect(auditor.siteUrl).toBe('https://example.com');
      expect(auditor.siteType).toBe('Generic');
    });
  });

  describe('URL Validation', () => {
    test('should accept valid HTTPS URLs', () => {
      const validAuditor = new SEOAuditor('https://example.com', 'Generic');
      expect(validAuditor.siteUrl).toBe('https://example.com');
    });

    test('should accept valid HTTP URLs', () => {
      const validAuditor = new SEOAuditor('http://example.com', 'Generic');
      expect(validAuditor.siteUrl).toBe('http://example.com');
    });
  });

  describe('Site Type Validation', () => {
    test('should accept valid site types', () => {
      const validTypes = ['Generic', 'SaaS', 'Ecommerce', 'Agency', 'Local'];
      
      validTypes.forEach(type => {
        const auditor = new SEOAuditor('https://example.com', type);
        expect(auditor.siteType).toBe(type);
      });
    });
  });

  describe('PageSpeed Analysis', () => {
    test('should handle PageSpeed API errors gracefully', async () => {
      // Mock environment to simulate API failure
      const originalEnv = process.env.GOOGLE_API_KEY;
      process.env.GOOGLE_API_KEY = 'invalid-key';
      
      const result = await auditor.runPageSpeedInsights();
      
      expect(result).toBeDefined();
      expect(result.performance).toBeDefined();
      expect(result.accessibility).toBeDefined();
      expect(result.bestPractices).toBeDefined();
      expect(result.seo).toBeDefined();
      
      // Restore original environment
      process.env.GOOGLE_API_KEY = originalEnv;
    });
  });

  describe('HTTPS Analysis', () => {
    test('should analyze HTTPS correctly', async () => {
      const result = await auditor.checkHTTPS();
      
      expect(result).toBeDefined();
      expect(result.isHTTPS).toBeDefined();
      expect(typeof result.isHTTPS).toBe('boolean');
    });
  });

  describe('Mobile Responsiveness', () => {
    test('should check mobile responsiveness', async () => {
      // Mock the browser functionality for testing
      const originalLaunch = require('puppeteer').launch;
      require('puppeteer').launch = jest.fn().mockRejectedValue(new Error('Browser not available in test environment'));
      
      const result = await auditor.checkMobileResponsiveness();
      
      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
      
      // Restore original function
      require('puppeteer').launch = originalLaunch;
    });
  });

  describe('Schema Markup', () => {
    test('should check schema markup', async () => {
      const result = await auditor.checkSchemaMarkup();
      
      expect(result).toBeDefined();
      expect(result.hasSchema).toBeDefined();
      expect(typeof result.hasSchema).toBe('boolean');
    });
  });
});
