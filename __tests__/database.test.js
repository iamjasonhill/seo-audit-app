// Mock Prisma client for testing
const mockPrisma = {
  audit: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn()
  },
  auditResult: {
    create: jest.fn(),
    findMany: jest.fn()
  },
  auditHistory: {
    createMany: jest.fn(),
    findMany: jest.fn()
  },
  $disconnect: jest.fn()
};

// Mock the database service
jest.mock('../src/services/database', () => {
  return {
    connect: jest.fn(),
    disconnect: jest.fn(),
    createAudit: jest.fn(),
    saveAuditResults: jest.fn(),
    getAudit: jest.fn(),
    getAuditResults: jest.fn(),
    getAllAudits: jest.fn(),
    deleteAudit: jest.fn()
  };
});

const databaseService = require('../src/services/database');

describe('Database Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Audit Creation', () => {
    test('should create audit with valid data', async () => {
      const mockAudit = {
        id: 'test-audit-id',
        siteUrl: 'https://example.com',
        siteType: 'Generic',
        createdAt: new Date()
      };

      databaseService.createAudit.mockResolvedValue(mockAudit);

      const result = await databaseService.createAudit('https://example.com', 'Generic');

      expect(databaseService.createAudit).toHaveBeenCalledWith('https://example.com', 'Generic');
      expect(result).toEqual(mockAudit);
    });
  });

  describe('Audit Results', () => {
    test('should save audit results', async () => {
      const mockResults = {
        technical: {
          pageSpeed: { performance: { score: 85 } }
        },
        content: { wordCount: 500 },
        structure: { navigation: { score: 90 } }
      };

      databaseService.saveAuditResults.mockResolvedValue(true);

      const result = await databaseService.saveAuditResults('test-audit-id', mockResults);

      expect(databaseService.saveAuditResults).toHaveBeenCalledWith('test-audit-id', mockResults);
      expect(result).toBe(true);
    });

    test('should retrieve audit results', async () => {
      const mockResults = {
        technical: { pageSpeed: { performance: { score: 85 } } }
      };

      databaseService.getAuditResults.mockResolvedValue(mockResults);

      const result = await databaseService.getAuditResults('test-audit-id');

      expect(databaseService.getAuditResults).toHaveBeenCalledWith('test-audit-id');
      expect(result).toEqual(mockResults);
    });
  });

  describe('Audit Management', () => {
    test('should get all audits', async () => {
      const mockAudits = [
        { id: '1', siteUrl: 'https://example.com', siteType: 'Generic' },
        { id: '2', siteUrl: 'https://test.com', siteType: 'SaaS' }
      ];

      databaseService.getAllAudits.mockResolvedValue(mockAudits);

      const result = await databaseService.getAllAudits();

      expect(databaseService.getAllAudits).toHaveBeenCalled();
      expect(result).toEqual(mockAudits);
    });

    test('should delete audit', async () => {
      databaseService.deleteAudit.mockResolvedValue(true);

      const result = await databaseService.deleteAudit('test-audit-id');

      expect(databaseService.deleteAudit).toHaveBeenCalledWith('test-audit-id');
      expect(result).toBe(true);
    });
  });

  describe('Connection Management', () => {
    test('should connect to database', async () => {
      databaseService.connect.mockResolvedValue(true);

      const result = await databaseService.connect();

      expect(databaseService.connect).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('should disconnect from database', async () => {
      databaseService.disconnect.mockResolvedValue(true);

      const result = await databaseService.disconnect();

      expect(databaseService.disconnect).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});
