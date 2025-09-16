const request = require('supertest');
const express = require('express');

// Mock the dependencies
jest.mock('../src/services/database');
jest.mock('../src/core/SEOAuditor');

// Mock auth middleware with proper implementation
const mockAuthMiddleware = {
  requireAuth: jest.fn((req, res, next) => {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    next();
  }),
  login: jest.fn(),
  logout: jest.fn(),
  redirectIfAuthenticated: jest.fn((req, res, next) => next())
};

jest.mock('../src/middleware/auth', () => mockAuthMiddleware);

const databaseService = require('../src/services/database');
const SEOAuditor = require('../src/core/SEOAuditor');

// Create a test app
const app = express();
app.use(express.json());

// Import routes
const auditRoutes = require('../src/routes/audit');
const authRoutes = require('../src/routes/auth');

app.use('/api/audit', auditRoutes);
app.use('/api/auth', authRoutes);

describe('API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Audit Routes', () => {
    test('POST /api/audit should create new audit', async () => {
      const mockAudit = {
        id: 'test-audit-id',
        siteUrl: 'https://example.com',
        siteType: 'Generic',
        createdAt: new Date()
      };

      const mockResults = {
        technical: { pageSpeed: { performance: { score: 85 } } },
        content: { wordCount: 500 },
        structure: { navigation: { score: 90 } }
      };

      databaseService.createAudit.mockResolvedValue(mockAudit);
      databaseService.saveAuditResults.mockResolvedValue(true);
      
      // Mock SEOAuditor
      const mockAuditor = {
        runFullAudit: jest.fn().mockResolvedValue(mockResults)
      };
      SEOAuditor.mockImplementation(() => mockAuditor);

      const response = await request(app)
        .post('/api/audit')
        .send({
          siteUrl: 'https://example.com',
          siteType: 'Generic'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.auditId).toBe('test-audit-id');
      expect(response.body.results).toEqual(mockResults);
    });

    test('GET /api/audit/:auditId should return audit results', async () => {
      const mockAudit = {
        id: 'test-audit-id',
        siteUrl: 'https://example.com',
        siteType: 'Generic',
        createdAt: '2025-09-16T21:49:54.454Z',
        updatedAt: '2025-09-16T21:49:54.454Z'
      };

      const mockResults = {
        resultsData: {
          technical: { pageSpeed: { performance: { score: 85 } } }
        }
      };

      databaseService.getAudit.mockResolvedValue(mockAudit);
      databaseService.getAuditResults.mockResolvedValue(mockResults);

      const response = await request(app)
        .get('/api/audit/test-audit-id')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.audit).toEqual({
        id: mockAudit.id,
        siteUrl: mockAudit.siteUrl,
        siteType: mockAudit.siteType,
        createdAt: mockAudit.createdAt,
        updatedAt: mockAudit.updatedAt
      });
      expect(response.body.results).toEqual(mockResults.resultsData);
    });

    test('GET /api/audit/:auditId should return 404 for non-existent audit', async () => {
      databaseService.getAudit.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/audit/non-existent-id')
        .expect(404);

      expect(response.body.error).toBe('Not Found');
    });

    test('GET /api/audit/list should return list of audits', async () => {
      const mockAudits = [
        { 
          id: '1', 
          siteUrl: 'https://example.com', 
          siteType: 'Generic',
          createdAt: '2025-09-16T21:49:54.454Z',
          results: [{ id: 'result1' }] // Mock results array
        },
        { 
          id: '2', 
          siteUrl: 'https://test.com', 
          siteType: 'SaaS',
          createdAt: '2025-09-16T21:49:54.454Z',
          results: [] // Mock empty results array
        }
      ];

      databaseService.getAllAudits.mockResolvedValue(mockAudits);

      const response = await request(app)
        .get('/api/audit/list')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.audits).toHaveLength(2);
      expect(response.body.audits[0]).toEqual({
        id: '1',
        siteUrl: 'https://example.com',
        siteType: 'Generic',
        createdAt: '2025-09-16T21:49:54.454Z',
        hasResults: true
      });
      expect(response.body.audits[1]).toEqual({
        id: '2',
        siteUrl: 'https://test.com',
        siteType: 'SaaS',
        createdAt: '2025-09-16T21:49:54.454Z',
        hasResults: false
      });
    });

    test('DELETE /api/audit/:auditId should delete audit', async () => {
      databaseService.deleteAudit.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/audit/test-audit-id')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');
    });
  });

  describe('Auth Routes', () => {
    test('POST /api/auth/login should authenticate user', async () => {
      // Mock the login function to return success
      mockAuthMiddleware.login.mockResolvedValue({
        id: 1,
        username: 'admin',
        role: 'admin',
        token: 'mock-jwt-token'
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'password'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        id: 1,
        username: 'admin',
        role: 'admin'
      });
    });

    test('POST /api/auth/login should reject invalid credentials', async () => {
      // Mock the login function to throw an error
      mockAuthMiddleware.login.mockRejectedValue(new Error('Invalid credentials'));

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'wrongpassword'
        })
        .expect(401);

      // The error response has error and message properties, not success
      expect(response.body.error).toBe('Authentication Failed');
      expect(response.body.message).toBe('Invalid username or password');
    });

    test('POST /api/auth/logout should logout user', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    test('GET /api/auth/status should return auth status', async () => {
      const response = await request(app)
        .get('/api/auth/status')
        .expect(200);

      expect(response.body.authenticated).toBeDefined();
    });
  });
});
