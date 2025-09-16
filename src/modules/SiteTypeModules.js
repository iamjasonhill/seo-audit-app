const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class SiteTypeModules {
  constructor(siteUrl, siteType) {
    this.siteUrl = siteUrl;
    this.siteType = siteType;
  }

  async runSiteTypeAnalysis() {
    try {
      logger.info(`Running ${this.siteType} specific analysis for ${this.siteUrl}`);
      
      switch (this.siteType) {
        case 'SaaS':
          return await this.analyzeSaaS();
        case 'Ecommerce':
          return await this.analyzeEcommerce();
        case 'Agency':
          return await this.analyzeAgency();
        case 'Local':
          return await this.analyzeLocal();
        default:
          return await this.analyzeGeneric();
      }
    } catch (error) {
      logger.error(`Error in ${this.siteType} analysis:`, error);
      return { error: error.message };
    }
  }

  async analyzeSaaS() {
    const analysis = {
      type: 'SaaS',
      features: await this.analyzeSaaSFeatures(),
      integrations: await this.analyzeSaaSIntegrations(),
      useCases: await this.analyzeSaaSUseCases(),
      conversionPages: await this.analyzeSaaSConversionPages(),
      topicalAuthority: await this.analyzeSaaSTopicalAuthority()
    };

    return analysis;
  }

  async analyzeSaaSFeatures() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const features = [];
      $('.feature, .benefit, [class*="feature"], [class*="benefit"]').each((i, el) => {
        const title = $(el).find('h1, h2, h3, h4, h5, h6').first().text().trim();
        const description = $(el).text().trim();
        if (title && description.length > 20) {
          features.push({ title, description: description.substring(0, 200) });
        }
      });

      return {
        featureCount: features.length,
        features: features.slice(0, 10),
        hasFeaturePages: $('.feature-page, [class*="feature"]').length > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeSaaSIntegrations() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const integrations = [];
      $('a[href*="integration"], .integration, [class*="integration"]').each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 5) {
          integrations.push(text);
        }
      });

      return {
        integrationCount: integrations.length,
        integrations: integrations.slice(0, 10),
        hasIntegrationPage: $('a[href*="integration"]').length > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeSaaSUseCases() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const useCases = [];
      $('.use-case, .case-study, [class*="use-case"], [class*="case-study"]').each((i, el) => {
        const title = $(el).find('h1, h2, h3, h4, h5, h6').first().text().trim();
        const description = $(el).text().trim();
        if (title && description.length > 20) {
          useCases.push({ title, description: description.substring(0, 200) });
        }
      });

      return {
        useCaseCount: useCases.length,
        useCases: useCases.slice(0, 5),
        hasUseCasePages: useCases.length > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeSaaSConversionPages() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const conversionElements = {
        signupButtons: $('a[href*="signup"], a[href*="register"], button[class*="signup"], button[class*="register"]').length,
        trialButtons: $('a[href*="trial"], button[class*="trial"]').length,
        pricingLinks: $('a[href*="pricing"], a[href*="price"]').length,
        demoButtons: $('a[href*="demo"], button[class*="demo"]').length,
        ctaButtons: $('.cta, .call-to-action, [class*="cta"]').length
      };

      return {
        conversionElements: conversionElements,
        hasSignupPage: $('a[href*="signup"]').length > 0,
        hasPricingPage: $('a[href*="pricing"]').length > 0,
        hasDemoPage: $('a[href*="demo"]').length > 0,
        totalConversionElements: Object.values(conversionElements).reduce((a, b) => a + b, 0)
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeSaaSTopicalAuthority() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const contentTypes = {
        blog: $('.blog, .post, article').length,
        resources: $('.resource, .guide, .whitepaper').length,
        help: $('.help, .support, .faq').length,
        documentation: $('.docs, .documentation, .api').length
      };

      return {
        contentTypes: contentTypes,
        hasBlog: contentTypes.blog > 0,
        hasResources: contentTypes.resources > 0,
        hasHelp: contentTypes.help > 0,
        hasDocumentation: contentTypes.documentation > 0,
        totalContentPages: Object.values(contentTypes).reduce((a, b) => a + b, 0)
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeEcommerce() {
    const analysis = {
      type: 'Ecommerce',
      productPages: await this.analyzeEcommerceProductPages(),
      categoryStructure: await this.analyzeEcommerceCategoryStructure(),
      productVariants: await this.analyzeEcommerceProductVariants(),
      facetedNavigation: await this.analyzeEcommerceFacetedNavigation(),
      productSchema: await this.analyzeEcommerceProductSchema(),
      reviews: await this.analyzeEcommerceReviews()
    };

    return analysis;
  }

  async analyzeEcommerceProductPages() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const productElements = {
        productImages: $('.product-image, .product-img, [class*="product-image"]').length,
        productTitles: $('.product-title, .product-name, [class*="product-title"]').length,
        productPrices: $('.price, .product-price, [class*="price"]').length,
        addToCart: $('.add-to-cart, .buy-now, [class*="add-to-cart"]').length,
        productDescriptions: $('.product-description, .product-desc').length
      };

      return {
        productElements: productElements,
        hasProductPages: Object.values(productElements).some(count => count > 0),
        estimatedProductCount: Math.max(...Object.values(productElements))
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeEcommerceCategoryStructure() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const categories = [];
      $('.category, .product-category, [class*="category"]').each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2) {
          categories.push(text);
        }
      });

      return {
        categoryCount: categories.length,
        categories: categories.slice(0, 10),
        hasCategoryPages: categories.length > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeEcommerceProductVariants() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const variants = {
        sizeOptions: $('.size, .size-option, [class*="size"]').length,
        colorOptions: $('.color, .color-option, [class*="color"]').length,
        variantSelectors: $('.variant, .option, [class*="variant"]').length
      };

      return {
        variants: variants,
        hasVariants: Object.values(variants).some(count => count > 0),
        potentialDuplicateContent: variants.variantSelectors > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeEcommerceFacetedNavigation() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const facets = {
        filters: $('.filter, .facet, [class*="filter"]').length,
        sortOptions: $('.sort, .sort-option, [class*="sort"]').length,
        priceRange: $('.price-range, .price-filter, [class*="price-range"]').length
      };

      return {
        facets: facets,
        hasFacetedNavigation: Object.values(facets).some(count => count > 0),
        potentialCrawlIssues: facets.filters > 5
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeEcommerceProductSchema() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const schemaTypes = [];
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const schema = JSON.parse($(el).html());
          if (schema['@type']) {
            schemaTypes.push(schema['@type']);
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      });

      const productSchema = schemaTypes.filter(type => 
        type.toLowerCase().includes('product') || 
        type.toLowerCase().includes('offer')
      );

      return {
        hasProductSchema: productSchema.length > 0,
        productSchemaTypes: productSchema,
        totalSchemaTypes: schemaTypes.length
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeEcommerceReviews() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const reviewElements = {
        reviewStars: $('.stars, .rating, [class*="star"], [class*="rating"]').length,
        reviewText: $('.review, .testimonial, [class*="review"]').length,
        reviewCount: $('.review-count, .rating-count, [class*="review-count"]').length
      };

      return {
        reviewElements: reviewElements,
        hasReviews: Object.values(reviewElements).some(count => count > 0),
        estimatedReviewCount: reviewElements.reviewCount
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeAgency() {
    const analysis = {
      type: 'Agency',
      servicePages: await this.analyzeAgencyServicePages(),
      caseStudies: await this.analyzeAgencyCaseStudies(),
      portfolio: await this.analyzeAgencyPortfolio(),
      leadGenPages: await this.analyzeAgencyLeadGenPages(),
      proofSignals: await this.analyzeAgencyProofSignals(),
      localSEO: await this.analyzeAgencyLocalSEO()
    };

    return analysis;
  }

  async analyzeAgencyServicePages() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const services = [];
      $('.service, .offering, [class*="service"]').each((i, el) => {
        const title = $(el).find('h1, h2, h3, h4, h5, h6').first().text().trim();
        const description = $(el).text().trim();
        if (title && description.length > 20) {
          services.push({ title, description: description.substring(0, 200) });
        }
      });

      return {
        serviceCount: services.length,
        services: services.slice(0, 10),
        hasServicePages: services.length > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeAgencyCaseStudies() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const caseStudies = [];
      $('.case-study, .portfolio-item, [class*="case-study"], [class*="portfolio"]').each((i, el) => {
        const title = $(el).find('h1, h2, h3, h4, h5, h6').first().text().trim();
        const description = $(el).text().trim();
        if (title && description.length > 20) {
          caseStudies.push({ title, description: description.substring(0, 200) });
        }
      });

      return {
        caseStudyCount: caseStudies.length,
        caseStudies: caseStudies.slice(0, 5),
        hasCaseStudies: caseStudies.length > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeAgencyPortfolio() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const portfolioElements = {
        portfolioItems: $('.portfolio, .work, [class*="portfolio"]').length,
        projectImages: $('.project-image, .work-image, [class*="project-image"]').length,
        clientLogos: $('.client, .client-logo, [class*="client"]').length
      };

      return {
        portfolioElements: portfolioElements,
        hasPortfolio: Object.values(portfolioElements).some(count => count > 0),
        estimatedProjectCount: portfolioElements.portfolioItems
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeAgencyLeadGenPages() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const leadGenElements = {
        contactForms: $('.contact-form, .form, [class*="contact-form"]').length,
        ctaButtons: $('.cta, .call-to-action, [class*="cta"]').length,
        phoneNumbers: $('a[href^="tel:"]').length,
        emailLinks: $('a[href^="mailto:"]').length
      };

      return {
        leadGenElements: leadGenElements,
        hasContactPage: $('a[href*="contact"]').length > 0,
        hasQuotePage: $('a[href*="quote"]').length > 0,
        totalLeadGenElements: Object.values(leadGenElements).reduce((a, b) => a + b, 0)
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeAgencyProofSignals() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const proofSignals = {
        testimonials: $('.testimonial, .review, [class*="testimonial"]').length,
        certifications: $('.certification, .cert, [class*="cert"]').length,
        awards: $('.award, .recognition, [class*="award"]').length,
        teamMembers: $('.team, .staff, [class*="team"]').length
      };

      return {
        proofSignals: proofSignals,
        hasTestimonials: proofSignals.testimonials > 0,
        hasCertifications: proofSignals.certifications > 0,
        hasAwards: proofSignals.awards > 0,
        hasTeamPage: proofSignals.teamMembers > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeAgencyLocalSEO() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const localElements = {
        address: $('.address, .location, [class*="address"]').length,
        phoneNumbers: $('a[href^="tel:"]').length,
        businessHours: $('.hours, .schedule, [class*="hours"]').length,
        serviceAreas: $('.service-area, .coverage, [class*="service-area"]').length
      };

      return {
        localElements: localElements,
        hasAddress: localElements.address > 0,
        hasPhone: localElements.phoneNumbers > 0,
        hasHours: localElements.businessHours > 0,
        hasServiceAreas: localElements.serviceAreas > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeLocal() {
    const analysis = {
      type: 'Local',
      gbpConsistency: await this.analyzeLocalGBPConsistency(),
      serviceAreaPages: await this.analyzeLocalServiceAreaPages(),
      localBusinessSchema: await this.analyzeLocalBusinessSchema(),
      reviews: await this.analyzeLocalReviews(),
      citations: await this.analyzeLocalCitations(),
      localLinkOpportunities: await this.analyzeLocalLinkOpportunities()
    };

    return analysis;
  }

  async analyzeLocalGBPConsistency() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const gbpElements = {
        businessName: $('.business-name, .company-name, [class*="business-name"]').length,
        address: $('.address, .location, [class*="address"]').length,
        phone: $('a[href^="tel:"]').length,
        hours: $('.hours, .schedule, [class*="hours"]').length
      };

      return {
        gbpElements: gbpElements,
        hasConsistentNAP: Object.values(gbpElements).every(count => count > 0),
        napConsistency: Object.values(gbpElements).filter(count => count > 0).length
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeLocalServiceAreaPages() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const serviceAreas = [];
      $('.service-area, .location, [class*="service-area"], [class*="location"]').each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2) {
          serviceAreas.push(text);
        }
      });

      return {
        serviceAreaCount: serviceAreas.length,
        serviceAreas: serviceAreas.slice(0, 10),
        hasServiceAreaPages: serviceAreas.length > 0
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeLocalBusinessSchema() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const schemaTypes = [];
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const schema = JSON.parse($(el).html());
          if (schema['@type']) {
            schemaTypes.push(schema['@type']);
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      });

      const localBusinessSchema = schemaTypes.filter(type => 
        type.toLowerCase().includes('localbusiness') || 
        type.toLowerCase().includes('restaurant') ||
        type.toLowerCase().includes('store')
      );

      return {
        hasLocalBusinessSchema: localBusinessSchema.length > 0,
        localBusinessSchemaTypes: localBusinessSchema,
        totalSchemaTypes: schemaTypes.length
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeLocalReviews() {
    try {
      const response = await axios.get(this.siteUrl, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      const reviewElements = {
        reviewStars: $('.stars, .rating, [class*="star"], [class*="rating"]').length,
        reviewText: $('.review, .testimonial, [class*="review"]').length,
        reviewPlatforms: $('.google-review, .yelp-review, [class*="review"]').length
      };

      return {
        reviewElements: reviewElements,
        hasReviews: Object.values(reviewElements).some(count => count > 0),
        estimatedReviewCount: reviewElements.reviewText
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async analyzeLocalCitations() {
    // This would require checking external directories
    // For now, return a placeholder
    return {
      estimatedCitations: 'N/A - Requires citation analysis tool',
      note: 'Use tools like BrightLocal or Whitespark for citation analysis'
    };
  }

  async analyzeLocalLinkOpportunities() {
    // This would require local link analysis
    // For now, return a placeholder
    return {
      estimatedLocalLinks: 'N/A - Requires local link analysis',
      note: 'Look for local directories, chamber of commerce, and local business associations'
    };
  }

  async analyzeGeneric() {
    return {
      type: 'Generic',
      note: 'Generic website analysis - no specific optimizations applied',
      recommendations: [
        'Consider implementing site-type specific optimizations',
        'Focus on general SEO best practices',
        'Monitor performance and user engagement metrics'
      ]
    };
  }
}

module.exports = SiteTypeModules;
