# SEO Audit App

A comprehensive SEO audit application that analyzes websites for technical SEO, content optimization, and competitive insights. Built with Node.js and featuring a modern web interface.

## Features

### Core SEO Analysis
- **Indexation & Visibility**: robots.txt, sitemap.xml, canonical tags analysis
- **Technical Health**: PageSpeed Insights, HTTPS, mobile responsiveness, schema markup
- **Site Structure**: Navigation analysis, internal linking, site depth assessment
- **On-Page Optimization**: Title tags, headings, meta descriptions, image optimization
- **Content Quality**: Word count, readability, content freshness analysis
- **Off-Page Signals**: Backlink analysis, social signals, brand mentions
- **Competitor Benchmarking**: SERP analysis and competitive positioning

### Site-Type Specific Modules
- **SaaS Applications**: Feature pages, integrations, use cases, conversion optimization
- **E-commerce Stores**: Product pages, category structure, variants, faceted navigation
- **Marketing Agencies**: Service pages, case studies, portfolio, lead generation
- **Local Businesses**: Google My Business consistency, service areas, local schema

### Reporting & Prioritization
- **Executive Summary**: Key findings and critical issues
- **Prioritized Action Items**: High/Medium/Low priority with effort/impact analysis
- **30/60/90 Day Roadmap**: Structured implementation timeline
- **Multiple Export Formats**: JSON, HTML, and PDF reports

## Installation

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn package manager

### Setup

1. **Clone or download the project**
   ```bash
   cd "Research Seo App"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` file with your configuration:
   ```env
   PORT=3000
   NODE_ENV=development
   GOOGLE_API_KEY=your_google_api_key_here
   GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here
   ```

4. **Start the application**
   ```bash
   npm start
   ```
   
   For development with auto-reload:
   ```bash
   npm run dev
   ```

5. **Access the application**
   Open your browser and navigate to `http://localhost:3000`

## Usage

### Web Interface
1. Enter the website URL you want to audit
2. Select the appropriate site type (Generic, SaaS, Ecommerce, Agency, Local)
3. Click "Start SEO Audit" to begin the analysis
4. Review the comprehensive results across multiple tabs
5. Export reports in your preferred format

### API Endpoints

#### Start a Full SEO Audit
```http
POST /api/audit
Content-Type: application/json

{
  "siteUrl": "https://example.com",
  "siteType": "SaaS"
}
```

#### Quick Audit (Specific Checks)
```http
POST /api/audit/quick
Content-Type: application/json

{
  "siteUrl": "https://example.com",
  "siteType": "Ecommerce",
  "checks": ["technical", "onpage", "indexation"]
}
```

#### Generate Report
```http
POST /api/reports/generate
Content-Type: application/json

{
  "auditId": "audit_1234567890_abc123",
  "format": "html",
  "includeCharts": true
}
```

## Architecture

### Core Components

- **SEOAuditor**: Main audit engine that orchestrates all analysis modules
- **SiteTypeModules**: Specialized analysis for different website types
- **Report Generator**: Creates formatted reports with prioritization
- **Web Interface**: Modern, responsive UI for user interaction

### Analysis Modules

1. **Indexation & Visibility**
   - robots.txt parsing and validation
   - sitemap.xml analysis
   - canonical tag verification
   - indexed page estimation

2. **Technical Health**
   - Lighthouse performance audits
   - HTTPS and security checks
   - Mobile responsiveness testing
   - Schema markup detection

3. **Site Structure**
   - Navigation hierarchy analysis
   - Internal linking patterns
   - Site depth assessment
   - Orphan page detection

4. **On-Page Optimization**
   - Title tag analysis
   - Heading structure review
   - Meta description optimization
   - Image alt text coverage

5. **Content Quality**
   - Word count and depth analysis
   - Readability scoring
   - Content freshness assessment
   - Content type inventory

6. **Off-Page Signals**
   - Backlink analysis (placeholder)
   - Social media presence
   - Brand mention tracking (placeholder)

7. **Competitor Benchmarking**
   - SERP competitor identification
   - Competitive positioning analysis

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment mode | development |
| `GOOGLE_API_KEY` | Google API key for enhanced features | - |
| `GOOGLE_SEARCH_ENGINE_ID` | Google Search Engine ID | - |
| `RATE_LIMIT_MAX_REQUESTS` | Rate limit requests per window | 100 |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | 900000 |
| `LOG_LEVEL` | Logging level | info |

### Rate Limiting
The application includes built-in rate limiting to prevent abuse:
- 100 requests per 15 minutes by default
- Configurable via environment variables
- Returns 429 status when limit exceeded

## API Integration

### Google APIs (Optional)
For enhanced features, you can integrate:
- **Google Search Console API**: For accurate indexed page counts
- **Google PageSpeed Insights API**: For more detailed performance data
- **Google Custom Search API**: For competitor analysis

### Third-Party Tools
The application is designed to integrate with:
- **Ahrefs API**: For backlink analysis
- **SEMrush API**: For competitive research
- **Moz API**: For domain authority metrics

## Development

### Project Structure
```
├── src/
│   ├── core/
│   │   └── SEOAuditor.js          # Main audit engine
│   ├── modules/
│   │   └── SiteTypeModules.js     # Site-type specific analysis
│   ├── routes/
│   │   ├── audit.js               # Audit API endpoints
│   │   └── reports.js             # Report generation endpoints
│   ├── middleware/
│   │   ├── rateLimiter.js         # Rate limiting middleware
│   │   └── errorHandler.js        # Error handling middleware
│   └── utils/
│       └── logger.js              # Logging utility
├── public/
│   └── index.html                 # Web interface
├── logs/                          # Application logs
├── server.js                      # Main server file
└── package.json                   # Dependencies and scripts
```

### Adding New Analysis Modules

1. Create a new method in `SEOAuditor.js`
2. Add the method to the parallel execution in `runFullAudit()`
3. Update the results object structure
4. Add corresponding UI elements in the web interface

### Adding New Site Types

1. Add the new site type to the validation schema
2. Create analysis methods in `SiteTypeModules.js`
3. Update the site type selection in the web interface
4. Add specific recommendations in the roadmap generator

## Troubleshooting

### Common Issues

1. **Puppeteer Installation Issues**
   ```bash
   npm install puppeteer --unsafe-perm=true --allow-root
   ```

2. **Lighthouse Performance Issues**
   - Ensure sufficient system resources
   - Consider running audits sequentially for large sites

3. **Rate Limiting**
   - Adjust rate limit settings in environment variables
   - Implement caching for repeated requests

4. **Memory Issues**
   - Monitor memory usage during large site audits
   - Consider implementing audit queuing for production use

### Logs
Application logs are stored in the `logs/` directory:
- `combined.log`: All application logs
- `error.log`: Error logs only

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review application logs
3. Create an issue with detailed information

## Roadmap

### Planned Features
- [ ] Database integration for audit history
- [ ] Scheduled audits and monitoring
- [ ] Advanced competitor analysis
- [ ] Integration with popular SEO tools
- [ ] Bulk audit capabilities
- [ ] Custom report templates
- [ ] API authentication and user management
- [ ] Advanced caching and performance optimization

### Performance Improvements
- [ ] Audit result caching
- [ ] Parallel processing optimization
- [ ] Memory usage optimization
- [ ] Database query optimization

---

**Note**: This application is designed for educational and professional use. Some features require external API keys for full functionality. Always respect website terms of service and implement appropriate rate limiting in production environments.
