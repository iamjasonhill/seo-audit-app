const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');
const robotsParser = require('robots-parser');
const { URL, URLSearchParams } = require('url');
const logger = require('../utils/logger');
const SiteTypeModules = require('../modules/SiteTypeModules');

// Ensure environment variables are loaded
require('dotenv').config();

class SEOAuditor {
  constructor(siteUrl, siteType = 'Generic') {
    this.siteUrl = this.normalizeUrl(siteUrl);
    this.siteType = siteType;
    this.results = {
      siteUrl: this.siteUrl,
      siteType: this.siteType,
      timestamp: new Date().toISOString(),
      indexation: {},
      technical: {},
      structure: {},
      onPage: {},
      content: {},
      offPage: {},
      competitors: {},
      siteTypeAnalysis: {},
      roadmap: {}
    };
  }

  normalizeUrl(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `https://${url}`;
    }
    return url;
  }

  async runFullAudit() {
    try {
      logger.info(`Starting SEO audit for ${this.siteUrl}`);
      
      // Run all audit modules in parallel for efficiency
      await Promise.all([
        this.checkIndexationAndVisibility(),
        this.analyzeTechnicalHealth(),
        this.analyzeSiteStructure(),
        this.analyzeOnPageOptimization(),
        this.analyzeContentQuality(),
        this.analyzeOffPageSignals(),
        this.benchmarkCompetitors(),
        this.runSiteTypeAnalysis()
      ]);

      // Generate roadmap and prioritization
      this.generateRoadmap();
      
      logger.info(`SEO audit completed for ${this.siteUrl}`);
      return this.results;
    } catch (error) {
      logger.error('Error during SEO audit:', error);
      throw error;
    }
  }

  async checkIndexationAndVisibility() {
    try {
      logger.info('Checking indexation and visibility...');
      
      const indexationResults = {
        robotsTxt: await this.checkRobotsTxt(),
        sitemap: await this.checkSitemap(),
        canonicalTags: await this.checkCanonicalTags(),
        indexedPages: await this.estimateIndexedPages()
      };

      this.results.indexation = indexationResults;
    } catch (error) {
      logger.error('Error checking indexation:', error);
      this.results.indexation = { error: error.message };
    }
  }

  async checkRobotsTxt() {
    try {
      const robotsUrl = new URL('/robots.txt', this.siteUrl).href;
      const response = await axios.get(robotsUrl, { timeout: 10000 });
      const robots = robotsParser(robotsUrl, response.data);
      
      return {
        exists: true,
        content: response.data,
        allowsIndexing: robots.isAllowed(this.siteUrl, 'Googlebot'),
        sitemapUrls: robots.getSitemaps(),
        crawlDelay: robots.getCrawlDelay('Googlebot')
      };
    } catch (error) {
      return {
        exists: false,
        error: error.message
      };
    }
  }

  async checkSitemap() {
    try {
      const sitemapUrl = new URL('/sitemap.xml', this.siteUrl).href;
      const response = await axios.get(sitemapUrl, { timeout: 10000 });
      
      // Simple sitemap parsing - in production you'd use a proper XML parser
      const urlMatches = response.data.match(/<loc>(.*?)<\/loc>/g);
      const urls = urlMatches ? urlMatches.map(match => match.replace(/<\/?loc>/g, '')) : [];
      
      return {
        exists: true,
        urlCount: urls.length,
        urls: urls.slice(0, 10), // First 10 URLs for preview
        lastModified: 'Unknown'
      };
    } catch (error) {
      return {
        exists: false,
        error: error.message
      };
    }
  }

  async checkCanonicalTags() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      const canonical = $('link[rel="canonical"]').attr('href');
      
      return {
        hasCanonical: !!canonical,
        canonicalUrl: canonical,
        isSelfReferencing: canonical === this.siteUrl
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  async estimateIndexedPages() {
    // This would typically use Google Search Console API
    // For now, we'll provide a placeholder
    return {
      estimatedCount: 'N/A - Requires Google Search Console API',
      note: 'Use Google Search Console to get accurate indexed page count'
    };
  }

  async analyzeTechnicalHealth() {
    try {
      logger.info('Analyzing technical health...');
      
      const technicalResults = {
        pageSpeed: await this.runPageSpeedInsights(),
        https: await this.checkHTTPS(),
        mobileResponsive: await this.checkMobileResponsiveness(),
        duplicateContent: await this.checkDuplicateContent(),
        schemaMarkup: await this.checkSchemaMarkup()
      };

      this.results.technical = technicalResults;
    } catch (error) {
      logger.error('Error analyzing technical health:', error);
      this.results.technical = { error: error.message };
    }
  }

  async runPageSpeedInsights() {
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    let apiErrorMessage = null;

    try {
      const shouldAttemptApi = isServerless || !!process.env.GOOGLE_API_KEY;

      if (shouldAttemptApi) {
        try {
          logger.info('Attempting PageSpeed Insights API analysis', {
            isServerless,
            hasGoogleKey: !!process.env.GOOGLE_API_KEY
          });
          return await this.runPageSpeedInsightsAPI();
        } catch (apiError) {
          logger.warn('PageSpeed API failed, continuing with fallback:', apiError.message);

          let errorMessage = 'PageSpeed API temporarily unavailable';
          let statusMessage = 'API unavailable';
          const normalizedMessage = apiError.message.toLowerCase();

          if (normalizedMessage.includes('rate limit')) {
            errorMessage = 'PageSpeed API rate limit exceeded. Please try again in a few minutes.';
            statusMessage = 'Rate limited';
          } else if (normalizedMessage.includes('api key')) {
            errorMessage = 'PageSpeed API key not configured. Contact administrator.';
            statusMessage = 'API key error';
          } else if (normalizedMessage.includes('network error')) {
            errorMessage = 'Network error connecting to PageSpeed API.';
            statusMessage = 'Network error';
          } else if (normalizedMessage.includes('access denied')) {
            errorMessage = 'PageSpeed API access denied. Check API key permissions.';
            statusMessage = 'Access denied';
          } else if (normalizedMessage.includes('invalid request')) {
            errorMessage = 'Invalid request to PageSpeed API. Check URL format.';
            statusMessage = 'Invalid request';
          }

          if (isServerless) {
            const sourceLabel = statusMessage === 'Rate limited' ? 'Rate Limited' : 'API Unavailable';
            return this.createFallbackPageSpeedResult(
              errorMessage,
              statusMessage,
              sourceLabel
            );
          }

          apiErrorMessage = errorMessage;
        }
      }

      const isServerlessBrowser = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
      let browser;

      try {
        browser = await puppeteer.launch({
          args: isServerlessBrowser ? chromium.args : [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ],
          executablePath: isServerlessBrowser ? await chromium.executablePath() : undefined,
          headless: isServerlessBrowser ? chromium.headless : 'new'
        });
      } catch (browserError) {
        logger.error('Failed to launch browser:', browserError.message);
        throw new Error(`Browser launch failed: ${browserError.message}`);
      }

      try {
        const lighthouse = await import('lighthouse');
        let lighthouseResult;

        try {
          const minimalConfig = {
            settings: {
              onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
              throttling: {
                rttMs: 40,
                throughputKbps: 10240,
                cpuSlowdownMultiplier: 1
              },
              maxWaitForFcp: 10000,
              maxWaitForLoad: 20000,
              skipAudits: [
                'uses-http2',
                'uses-long-cache-ttl',
                'uses-text-compression',
                'unused-css-rules',
                'unused-javascript',
                'render-blocking-resources',
                'unminified-css',
                'unminified-javascript'
              ]
            }
          };

          lighthouseResult = await lighthouse.default(this.siteUrl, {
            port: new URL(browser.wsEndpoint()).port,
            output: 'json',
            logLevel: 'silent'
          }, minimalConfig);
        } catch (lighthouseError) {
          logger.warn('Lighthouse failed with custom config, trying basic approach:', lighthouseError.message);

          try {
            lighthouseResult = await lighthouse.default(this.siteUrl, {
              port: new URL(browser.wsEndpoint()).port,
              output: 'json',
              logLevel: 'silent'
            }, {
              settings: {
                onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
                throttling: {
                  rttMs: 40,
                  throughputKbps: 10240,
                  cpuSlowdownMultiplier: 1
                }
              }
            });
          } catch (secondError) {
            logger.error('Lighthouse completely failed:', secondError.message);
            throw new Error(`Lighthouse analysis failed: ${secondError.message}`);
          }
        }

        if (!lighthouseResult || !lighthouseResult.lhr) {
          throw new Error('Lighthouse failed to generate results');
        }

        const sourceLabel = apiErrorMessage ? 'Lighthouse (API fallback)' : 'Lighthouse';
        const extra = apiErrorMessage ? { warnings: [apiErrorMessage] } : {};

        return this.formatPageSpeedResult(lighthouseResult.lhr, sourceLabel, extra);
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch (closeError) {
            logger.warn('Failed to close browser after Lighthouse run:', closeError.message);
          }
        }
      }
    } catch (error) {
      logger.error('Lighthouse analysis failed:', error.message);

      const extra = apiErrorMessage ? { warnings: [apiErrorMessage] } : {};
      return this.createFallbackPageSpeedResult(
        `Lighthouse analysis failed: ${error.message}`,
        'Analysis failed',
        'Lighthouse',
        extra
      );
    }
  }

  async runPageSpeedInsightsAPI() {
    try {
      // Debug: Log environment variables
      logger.info('Environment check:', {
        hasGoogleKey: !!process.env.GOOGLE_API_KEY,
        keyLength: process.env.GOOGLE_API_KEY?.length || 0,
        keyPrefix: process.env.GOOGLE_API_KEY?.substring(0, 10) || 'none'
      });

      // Check if we have a valid API key
      if (!process.env.GOOGLE_API_KEY) {
        throw new Error('No Google API key found in environment variables');
      }
      
      if (process.env.GOOGLE_API_KEY === 'demo' || process.env.GOOGLE_API_KEY.length < 10) {
        throw new Error('Invalid Google API key format');
      }

      // Use Google's PageSpeed Insights API (no browser required)
      const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`;
      
      const categories = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'];
      const strategy = 'mobile';
      const params = new URLSearchParams();
      params.append('url', this.siteUrl);
      params.append('strategy', strategy);
      params.append('key', process.env.GOOGLE_API_KEY);
      categories.forEach(category => params.append('category', category));

      logger.info('Calling PageSpeed API with params:', {
        url: this.siteUrl,
        strategy,
        categories
      });

      const response = await axios.get(`${apiUrl}?${params.toString()}`, {
        timeout: 30000,
        headers: {
          'User-Agent': 'SEO-Audit-App/1.0'
        }
      });

      const data = response.data;
      
      if (!data) {
        throw new Error('No data received from PageSpeed API');
      }

      if (data.error) {
        throw new Error(`PageSpeed API error: ${data.error.message || 'Unknown error'}`);
      }

      const lighthouseResult = data.lighthouseResult;

      if (!lighthouseResult) {
        throw new Error('No Lighthouse result from PageSpeed API');
      }

      const extra = {};
      if (data.analysisUTCTimestamp) {
        extra.analysisUTCTimestamp = data.analysisUTCTimestamp;
      }
      extra.strategy = strategy;

      return this.formatPageSpeedResult(lighthouseResult, 'PageSpeed API', extra);
    } catch (error) {
      logger.error('PageSpeed API error:', error.message);

      // Handle specific error types
      if (error.response) {
        const status = error.response.status;
        if (status === 429) {
          throw new Error('PageSpeed API rate limit exceeded. Please try again later.');
        } else if (status === 403) {
          throw new Error('PageSpeed API access denied. Check API key permissions.');
        } else if (status === 400) {
          throw new Error('Invalid request to PageSpeed API. Check URL format.');
        } else {
          throw new Error(`PageSpeed API error (${status}): ${error.response.data?.error?.message || 'Unknown error'}`);
        }
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error('Network error: Unable to reach PageSpeed API');
      } else {
        throw new Error(`PageSpeed API error: ${error.message}`);
      }
    }
  }

  formatPageSpeedResult(lighthouseResult, source = 'PageSpeed API', extra = {}) {
    const categories = lighthouseResult.categories || {};
    const audits = lighthouseResult.audits || {};

    const metrics = {
      firstContentfulPaint: audits['first-contentful-paint']?.displayValue || 'N/A',
      largestContentfulPaint: audits['largest-contentful-paint']?.displayValue || 'N/A',
      firstInputDelay: audits['max-potential-fid']?.displayValue || 'N/A',
      cumulativeLayoutShift: audits['cumulative-layout-shift']?.displayValue || 'N/A',
      speedIndex: audits['speed-index']?.displayValue || 'N/A',
      totalBlockingTime: audits['total-blocking-time']?.displayValue || 'N/A',
      timeToInteractive: audits['interactive']?.displayValue || 'N/A'
    };

    return {
      performance: {
        score: Math.round((categories.performance?.score || 0) * 100),
        metrics
      },
      accessibility: {
        score: Math.round((categories.accessibility?.score || 0) * 100)
      },
      bestPractices: {
        score: Math.round((categories['best-practices']?.score || 0) * 100)
      },
      seo: {
        score: Math.round((categories.seo?.score || 0) * 100)
      },
      coreWebVitals: {
        lcp: audits['largest-contentful-paint']?.numericValue || 0,
        fid: audits['max-potential-fid']?.numericValue || 0,
        cls: audits['cumulative-layout-shift']?.numericValue || 0
      },
      source,
      ...extra
    };
  }

  createFallbackPageSpeedResult(errorMessage, statusMessage = 'Unavailable', source = 'Fallback', extra = {}) {
    const status = statusMessage || 'Unavailable';

    return {
      performance: {
        score: 0,
        metrics: {
          firstContentfulPaint: status,
          largestContentfulPaint: status,
          firstInputDelay: status,
          cumulativeLayoutShift: status,
          speedIndex: status,
          totalBlockingTime: status,
          timeToInteractive: status
        }
      },
      accessibility: { score: 0 },
      bestPractices: { score: 0 },
      seo: { score: 0 },
      coreWebVitals: {
        lcp: 0,
        fid: 0,
        cls: 0
      },
      error: errorMessage,
      fallback: true,
      source,
      statusMessage: status,
      ...extra
    };
  }

  async checkHTTPS() {
    try {
      const response = await axios.get(this.siteUrl, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: () => true // Don't throw on any status code
      });
      
      const headers = response.headers;
      const isHTTPS = this.siteUrl.startsWith('https://');
      const finalUrl = response.request.res.responseUrl || this.siteUrl;
      const hasRedirect = finalUrl !== this.siteUrl;
      
      // Check security headers
      const securityHeaders = {
        strictTransportSecurity: !!headers['strict-transport-security'],
        xFrameOptions: !!headers['x-frame-options'],
        xContentTypeOptions: !!headers['x-content-type-options'],
        xXSSProtection: !!headers['x-xss-protection'],
        contentSecurityPolicy: !!headers['content-security-policy'],
        referrerPolicy: !!headers['referrer-policy']
      };
      
      const securityScore = Object.values(securityHeaders).filter(Boolean).length;
      
      return {
        isHTTPS: isHTTPS,
        statusCode: response.status,
        redirects: hasRedirect,
        finalUrl: finalUrl,
        securityHeaders: securityHeaders,
        securityScore: securityScore,
        maxSecurityScore: Object.keys(securityHeaders).length,
        hasValidSSL: isHTTPS && response.status < 400,
        mixedContent: this.checkMixedContent(response.data)
      };
    } catch (error) {
      return {
        error: error.message,
        isHTTPS: this.siteUrl.startsWith('https://'),
        hasValidSSL: false
      };
    }
  }

  checkMixedContent(html) {
    // Simple check for mixed content issues
    const httpResources = html.match(/http:\/\/[^"'\s]+/g) || [];
    return {
      hasMixedContent: httpResources.length > 0,
      httpResources: httpResources.slice(0, 5) // First 5 for preview
    };
  }

  async checkMobileResponsiveness() {
    try {
      // Configure Puppeteer for serverless environment
      const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
      
      const browser = await puppeteer.launch({ 
        args: isServerless ? chromium.args : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
        executablePath: isServerless ? await chromium.executablePath() : undefined,
        headless: isServerless ? chromium.headless : 'new'
      });
      const page = await browser.newPage();
      
      // Test multiple viewport sizes
      const viewports = [
        { width: 375, height: 667, name: 'Mobile' },
        { width: 768, height: 1024, name: 'Tablet' },
        { width: 1920, height: 1080, name: 'Desktop' }
      ];
      
      const results = {};
      
      for (const viewport of viewports) {
        await page.setViewport(viewport);
        await page.goto(this.siteUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Check for viewport meta tag
        const viewportMeta = await page.$eval('meta[name="viewport"]', el => el.content).catch(() => null);
        
        // Check responsive behavior
        const bodyWidth = await page.$eval('body', el => el.scrollWidth).catch(() => 0);
        const bodyHeight = await page.$eval('body', el => el.scrollHeight).catch(() => 0);
        const hasHorizontalScroll = bodyWidth > viewport.width;
        const hasVerticalScroll = bodyHeight > viewport.height;
        
        // Check for mobile-specific elements
        const touchTargets = await page.$$eval('button, a, input, select, textarea', elements => 
          elements.filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44;
          }).length
        ).catch(() => 0);
        
        // Check text readability
        const textElements = await page.$$eval('p, h1, h2, h3, h4, h5, h6, span, div', elements => 
          elements.filter(el => {
            const style = window.getComputedStyle(el);
            const fontSize = parseFloat(style.fontSize);
            return fontSize >= 16; // Minimum readable font size
          }).length
        ).catch(() => 0);
        
        results[viewport.name.toLowerCase()] = {
          viewport: viewport,
          hasViewportMeta: !!viewportMeta,
          viewportContent: viewportMeta,
          bodyWidth: bodyWidth,
          bodyHeight: bodyHeight,
          hasHorizontalScroll: hasHorizontalScroll,
          hasVerticalScroll: hasVerticalScroll,
          touchTargets: touchTargets,
          readableTextElements: textElements,
          isResponsive: !hasHorizontalScroll && bodyWidth <= viewport.width * 1.05
        };
      }
      
      await browser.close();
      
      // Overall mobile score
      const mobileScore = results.mobile.isResponsive ? 100 : 
                         results.mobile.hasHorizontalScroll ? 30 : 60;
      
      return {
        ...results,
        overallScore: mobileScore,
        hasViewportMeta: results.mobile.hasViewportMeta,
        isMobileFriendly: mobileScore >= 70,
        recommendations: this.generateMobileRecommendations(results)
      };
    } catch (error) {
      logger.error('Mobile responsiveness check error:', error);
      return {
        error: error.message
      };
    }
  }

  generateMobileRecommendations(results) {
    const recommendations = [];
    
    if (!results.mobile.hasViewportMeta) {
      recommendations.push('Add viewport meta tag for mobile optimization');
    }
    
    if (results.mobile.hasHorizontalScroll) {
      recommendations.push('Fix horizontal scrolling on mobile devices');
    }
    
    if (results.mobile.touchTargets < 5) {
      recommendations.push('Ensure touch targets are at least 44px in size');
    }
    
    if (results.mobile.readableTextElements < 10) {
      recommendations.push('Increase font sizes for better mobile readability');
    }
    
    return recommendations;
  }

  async checkDuplicateContent() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const titles = [];
      const metaDescriptions = [];
      
      $('title').each((i, el) => {
        titles.push($(el).text().trim());
      });
      
      $('meta[name="description"]').each((i, el) => {
        metaDescriptions.push($(el).attr('content'));
      });
      
      return {
        duplicateTitles: this.findDuplicates(titles),
        duplicateMetaDescriptions: this.findDuplicates(metaDescriptions),
        missingTitles: titles.filter(title => !title || title.length < 10).length,
        missingMetaDescriptions: metaDescriptions.filter(desc => !desc || desc.length < 50).length
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  async checkSchemaMarkup() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const schemaTypes = [];
      const schemaDetails = [];
      const microdataElements = [];
      
      // Check JSON-LD structured data
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const schema = JSON.parse($(el).html());
          if (schema['@type']) {
            schemaTypes.push(schema['@type']);
            schemaDetails.push({
              type: schema['@type'],
              context: schema['@context'] || 'https://schema.org',
              properties: Object.keys(schema).filter(key => !key.startsWith('@')),
              isValid: this.validateSchemaStructure(schema)
            });
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      });
      
      // Check microdata
      $('[itemscope]').each((i, el) => {
        const itemType = $(el).attr('itemtype');
        if (itemType) {
          microdataElements.push({
            type: itemType,
            properties: $(el).find('[itemprop]').map((i, prop) => $(prop).attr('itemprop')).get()
          });
        }
      });
      
      // Check RDFa
      const rdfaElements = $('[typeof]').length;
      
      // Check Open Graph
      const openGraphTags = $('meta[property^="og:"]').length;
      
      // Check Twitter Cards
      const twitterTags = $('meta[name^="twitter:"]').length;
      
      const totalStructuredData = schemaTypes.length + microdataElements.length + rdfaElements;
      
      return {
        hasSchema: totalStructuredData > 0,
        schemaTypes: schemaTypes,
        schemaDetails: schemaDetails,
        microdataElements: microdataElements,
        rdfaElements: rdfaElements,
        openGraphTags: openGraphTags,
        twitterTags: twitterTags,
        totalStructuredData: totalStructuredData,
        recommendations: this.generateSchemaRecommendations(schemaTypes, microdataElements, openGraphTags, twitterTags)
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  validateSchemaStructure(schema) {
    // Basic validation for common schema types
    const requiredFields = {
      'Organization': ['name'],
      'WebSite': ['name', 'url'],
      'Article': ['headline', 'author'],
      'Product': ['name', 'description'],
      'LocalBusiness': ['name', 'address'],
      'BreadcrumbList': ['itemListElement']
    };
    
    const schemaType = schema['@type'];
    const required = requiredFields[schemaType] || [];
    
    return required.every(field => schema[field]);
  }

  generateSchemaRecommendations(schemaTypes, microdataElements, openGraphTags, twitterTags) {
    const recommendations = [];
    
    if (schemaTypes.length === 0 && microdataElements.length === 0) {
      recommendations.push('Add structured data markup (JSON-LD or microdata)');
    }
    
    if (openGraphTags === 0) {
      recommendations.push('Add Open Graph meta tags for social media sharing');
    }
    
    if (twitterTags === 0) {
      recommendations.push('Add Twitter Card meta tags');
    }
    
    if (!schemaTypes.includes('Organization') && !schemaTypes.includes('LocalBusiness')) {
      recommendations.push('Add Organization or LocalBusiness schema markup');
    }
    
    if (!schemaTypes.includes('WebSite')) {
      recommendations.push('Add WebSite schema markup with search action');
    }
    
    return recommendations;
  }

  findDuplicates(array) {
    const counts = {};
    const duplicates = [];
    
    array.forEach(item => {
      if (item) {
        counts[item] = (counts[item] || 0) + 1;
        if (counts[item] === 2) {
          duplicates.push(item);
        }
      }
    });
    
    return duplicates;
  }

  async analyzeSiteStructure() {
    try {
      logger.info('Analyzing site structure...');
      
      const structureResults = {
        navigation: await this.analyzeNavigation(),
        internalLinking: await this.analyzeInternalLinking(),
        siteDepth: await this.analyzeSiteDepth(),
        orphanPages: await this.findOrphanPages()
      };

      this.results.structure = structureResults;
    } catch (error) {
      logger.error('Error analyzing site structure:', error);
      this.results.structure = { error: error.message };
    }
  }

  async analyzeNavigation() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const navLinks = [];
      $('nav a, .navigation a, .menu a').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && text) {
          navLinks.push({ href, text });
        }
      });
      
      return {
        linkCount: navLinks.length,
        links: navLinks.slice(0, 20), // First 20 links
        hasMainNavigation: navLinks.length > 0
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  async analyzeInternalLinking() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const internalLinks = [];
      const externalLinks = [];
      
      $('a[href]').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        
        if (href.startsWith('http')) {
          if (href.includes(new URL(this.siteUrl).hostname)) {
            internalLinks.push({ href, text });
          } else {
            externalLinks.push({ href, text });
          }
        } else if (href.startsWith('/')) {
          internalLinks.push({ href, text });
        }
      });
      
      return {
        internalLinkCount: internalLinks.length,
        externalLinkCount: externalLinks.length,
        internalLinks: internalLinks.slice(0, 10),
        externalLinks: externalLinks.slice(0, 10)
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  async analyzeSiteDepth() {
    // This would require crawling multiple pages
    // For now, return a placeholder
    return {
      estimatedDepth: 'N/A - Requires full site crawl',
      note: 'Use a crawler like Screaming Frog for accurate site depth analysis'
    };
  }

  async findOrphanPages() {
    // This would require crawling multiple pages
    // For now, return a placeholder
    return {
      estimatedOrphans: 'N/A - Requires full site crawl',
      note: 'Use a crawler to identify pages with no internal links'
    };
  }

  async analyzeOnPageOptimization() {
    try {
      logger.info('Analyzing on-page optimization...');
      
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const onPageResults = {
        title: this.analyzeTitle($),
        headings: this.analyzeHeadings($),
        metaDescription: this.analyzeMetaDescription($),
        images: this.analyzeImages($),
        keywords: this.analyzeKeywords($)
      };

      this.results.onPage = onPageResults;
    } catch (error) {
      logger.error('Error analyzing on-page optimization:', error);
      this.results.onPage = { error: error.message };
    }
  }

  analyzeTitle($) {
    const title = $('title').text().trim();
    return {
      text: title,
      length: title.length,
      isOptimal: title.length >= 30 && title.length <= 60,
      hasTitle: !!title
    };
  }

  analyzeHeadings($) {
    const headings = {
      h1: [],
      h2: [],
      h3: [],
      h4: [],
      h5: [],
      h6: []
    };
    
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(tag => {
      $(tag).each((i, el) => {
        headings[tag].push($(el).text().trim());
      });
    });
    
    return {
      h1Count: headings.h1.length,
      h1Text: headings.h1,
      hasMultipleH1: headings.h1.length > 1,
      headingStructure: headings
    };
  }

  analyzeMetaDescription($) {
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    return {
      text: metaDesc,
      length: metaDesc.length,
      isOptimal: metaDesc.length >= 120 && metaDesc.length <= 160,
      hasMetaDescription: !!metaDesc
    };
  }

  analyzeImages($) {
    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      const alt = $(el).attr('alt');
      images.push({ src, alt, hasAlt: !!alt });
    });
    
    const imagesWithoutAlt = images.filter(img => !img.hasAlt).length;
    
    return {
      totalImages: images.length,
      imagesWithoutAlt: imagesWithoutAlt,
      altTextCoverage: images.length > 0 ? ((images.length - imagesWithoutAlt) / images.length * 100).toFixed(1) : 100,
      sampleImages: images.slice(0, 5)
    };
  }

  analyzeKeywords($) {
    // Basic keyword analysis - in a real implementation, you'd use more sophisticated analysis
    const text = $('body').text().toLowerCase();
    const words = text.split(/\s+/).filter(word => word.length > 3);
    const wordCount = {};
    
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    const topKeywords = Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));
    
    return {
      totalWords: words.length,
      topKeywords: topKeywords,
      keywordDensity: topKeywords.slice(0, 5)
    };
  }

  async analyzeContentQuality() {
    try {
      logger.info('Analyzing content quality...');
      
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const contentResults = {
        wordCount: this.analyzeWordCount($),
        contentFreshness: await this.analyzeContentFreshness($),
        contentTypes: this.analyzeContentTypes($),
        readability: this.analyzeReadability($)
      };

      this.results.content = contentResults;
    } catch (error) {
      logger.error('Error analyzing content quality:', error);
      this.results.content = { error: error.message };
    }
  }

  analyzeWordCount($) {
    const text = $('body').text();
    const words = text.split(/\s+/).filter(word => word.length > 0);
    return {
      totalWords: words.length,
      isSubstantial: words.length >= 500,
      averageWordsPerParagraph: this.calculateAverageWordsPerParagraph($)
    };
  }

  calculateAverageWordsPerParagraph($) {
    const paragraphs = $('p');
    if (paragraphs.length === 0) return 0;
    
    let totalWords = 0;
    paragraphs.each((i, el) => {
      const words = $(el).text().split(/\s+/).filter(word => word.length > 0);
      totalWords += words.length;
    });
    
    return Math.round(totalWords / paragraphs.length);
  }

  async analyzeContentFreshness($) {
    // This would require checking publication dates
    // For now, return a placeholder
    return {
      lastModified: 'N/A - Requires date analysis',
      note: 'Check for publication dates, last modified headers, or date metadata'
    };
  }

  analyzeContentTypes($) {
    const contentTypes = {
      blog: $('article, .blog, .post').length,
      product: $('.product, .item, [data-product]').length,
      service: $('.service, .offering').length,
      about: $('.about, #about').length,
      contact: $('.contact, #contact').length
    };
    
    return contentTypes;
  }

  analyzeReadability($) {
    const text = $('body').text();
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const syllables = this.estimateSyllables(text);
    
    // Simple readability score (Flesch Reading Ease approximation)
    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;
    const readabilityScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
    
    return {
      sentences: sentences.length,
      words: words.length,
      syllables: syllables,
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
      avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
      readabilityScore: Math.round(readabilityScore),
      readabilityLevel: this.getReadabilityLevel(readabilityScore)
    };
  }

  estimateSyllables(text) {
    // Simple syllable estimation
    const words = text.toLowerCase().split(/\s+/);
    let syllables = 0;
    
    words.forEach(word => {
      if (word.length <= 3) {
        syllables += 1;
      } else {
        syllables += word.replace(/[^aeiouy]/g, '').length;
        if (word.endsWith('e')) syllables -= 1;
        if (syllables <= 0) syllables = 1;
      }
    });
    
    return syllables;
  }

  getReadabilityLevel(score) {
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Standard';
    if (score >= 50) return 'Fairly Difficult';
    if (score >= 30) return 'Difficult';
    return 'Very Difficult';
  }

  async analyzeOffPageSignals() {
    try {
      logger.info('Analyzing off-page signals...');
      
      const offPageResults = {
        backlinks: await this.analyzeBacklinks(),
        socialSignals: await this.analyzeSocialSignals(),
        brandMentions: await this.analyzeBrandMentions()
      };

      this.results.offPage = offPageResults;
    } catch (error) {
      logger.error('Error analyzing off-page signals:', error);
      this.results.offPage = { error: error.message };
    }
  }

  async analyzeBacklinks() {
    // This would require backlink analysis tools
    // For now, return a placeholder
    return {
      estimatedCount: 'N/A - Requires backlink analysis tool',
      note: 'Use tools like Ahrefs, Majestic, or SEMrush for backlink analysis'
    };
  }

  async analyzeSocialSignals() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const socialLinks = {
        facebook: $('a[href*="facebook.com"]').length,
        twitter: $('a[href*="twitter.com"], a[href*="x.com"]').length,
        linkedin: $('a[href*="linkedin.com"]').length,
        instagram: $('a[href*="instagram.com"]').length,
        youtube: $('a[href*="youtube.com"]').length
      };
      
      return {
        socialLinks: socialLinks,
        hasSocialPresence: Object.values(socialLinks).some(count => count > 0)
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  async analyzeBrandMentions() {
    // This would require brand monitoring tools
    // For now, return a placeholder
    return {
      estimatedMentions: 'N/A - Requires brand monitoring tool',
      note: 'Use tools like Mention, Brandwatch, or Google Alerts for brand mention tracking'
    };
  }

  async benchmarkCompetitors() {
    try {
      logger.info('Benchmarking competitors...');
      
      const competitorResults = {
        topCompetitors: await this.findTopCompetitors(),
        competitiveAnalysis: await this.analyzeCompetitivePosition()
      };

      this.results.competitors = competitorResults;
    } catch (error) {
      logger.error('Error benchmarking competitors:', error);
      this.results.competitors = { error: error.message };
    }
  }

  async findTopCompetitors() {
    // This would require SERP analysis
    // For now, return a placeholder
    return {
      competitors: 'N/A - Requires SERP analysis',
      note: 'Use Google Search Console or SEO tools to identify top competitors for your target keywords'
    };
  }

  async analyzeCompetitivePosition() {
    // This would require competitive analysis
    // For now, return a placeholder
    return {
      position: 'N/A - Requires keyword ranking analysis',
      note: 'Use tools like SEMrush, Ahrefs, or Google Search Console for competitive positioning'
    };
  }

  async runSiteTypeAnalysis() {
    try {
      logger.info(`Running ${this.siteType} specific analysis...`);
      
      const siteTypeModule = new SiteTypeModules(this.siteUrl, this.siteType);
      const siteTypeResults = await siteTypeModule.runSiteTypeAnalysis();
      
      this.results.siteTypeAnalysis = siteTypeResults;
    } catch (error) {
      logger.error('Error in site type analysis:', error);
      this.results.siteTypeAnalysis = { error: error.message };
    }
  }

  generateRoadmap() {
    const issues = this.identifyIssues();
    const prioritizedIssues = this.prioritizeIssues(issues);
    
    this.results.roadmap = {
      issues: prioritizedIssues,
      top10Fixes: prioritizedIssues.slice(0, 10),
      timeline: this.generateTimeline(prioritizedIssues)
    };
  }

  identifyIssues() {
    const issues = [];

    // Technical issues
    const pageSpeedData = this.results.technical.pageSpeed;
    const performanceScore = pageSpeedData?.performance?.score ??
      (typeof pageSpeedData?.performance === 'number' ? pageSpeedData.performance : 0);

    if (performanceScore < 50) {
      issues.push({
        category: 'Technical',
        issue: 'Poor Page Speed Performance',
        description: `Page speed score is ${performanceScore}/100`,
        priority: 'High',
        effort: 'Medium',
        impact: 'High'
      });
    }
    
    if (!this.results.technical.https?.isHTTPS) {
      issues.push({
        category: 'Technical',
        issue: 'Missing HTTPS',
        description: 'Site is not using HTTPS encryption',
        priority: 'High',
        effort: 'Low',
        impact: 'High'
      });
    }
    
    // On-page issues
    if (!this.results.onPage.title?.hasTitle) {
      issues.push({
        category: 'On-Page',
        issue: 'Missing Page Title',
        description: 'Page does not have a title tag',
        priority: 'High',
        effort: 'Low',
        impact: 'High'
      });
    }
    
    if (!this.results.onPage.metaDescription?.hasMetaDescription) {
      issues.push({
        category: 'On-Page',
        issue: 'Missing Meta Description',
        description: 'Page does not have a meta description',
        priority: 'Medium',
        effort: 'Low',
        impact: 'Medium'
      });
    }
    
    if (this.results.onPage.images?.imagesWithoutAlt > 0) {
      issues.push({
        category: 'On-Page',
        issue: 'Images Missing Alt Text',
        description: `${this.results.onPage.images.imagesWithoutAlt} images are missing alt text`,
        priority: 'Medium',
        effort: 'Low',
        impact: 'Medium'
      });
    }
    
    // Content issues
    if (this.results.content.wordCount?.totalWords < 500) {
      issues.push({
        category: 'Content',
        issue: 'Thin Content',
        description: `Page has only ${this.results.content.wordCount.totalWords} words`,
        priority: 'Medium',
        effort: 'High',
        impact: 'Medium'
      });
    }
    
    return issues;
  }

  prioritizeIssues(issues) {
    const priorityOrder = { 'High': 3, 'Medium': 2, 'Low': 1 };
    const effortOrder = { 'Low': 1, 'Medium': 2, 'High': 3 };
    
    return issues.sort((a, b) => {
      // First by priority, then by effort (lower effort first)
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return effortOrder[a.effort] - effortOrder[b.effort];
    });
  }

  generateTimeline(issues) {
    const timeline = {
      '30days': issues.filter(issue => issue.priority === 'High' && issue.effort === 'Low'),
      '60days': issues.filter(issue => 
        (issue.priority === 'High' && issue.effort !== 'Low') ||
        (issue.priority === 'Medium' && issue.effort === 'Low')
      ),
      '90days': issues.filter(issue => 
        issue.priority === 'Medium' && issue.effort !== 'Low'
      )
    };
    
    return timeline;
  }
}

module.exports = SEOAuditor;
