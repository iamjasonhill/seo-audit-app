const mockSyncStatusState = { record: null };
let mockLatestPageRecord = null;
let setTimeoutSpy;

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/services/database', () => {
  const mockBingApiKeyFindUnique = jest.fn().mockResolvedValue(null);
  const mockBingSyncStatusFindUnique = jest.fn(async () => mockSyncStatusState.record);
  const mockBingSyncStatusUpsert = jest.fn(async ({ where, create, update }) => {
    const key = where.siteUrl_searchType_dimension || {};
    const data = {
      siteUrl: key.siteUrl ?? create?.siteUrl ?? null,
      searchType: key.searchType ?? create?.searchType ?? null,
      dimension: key.dimension ?? create?.dimension ?? null,
      lastSyncedDate: (update?.lastSyncedDate ?? create?.lastSyncedDate) || null,
      lastRunAt: (update?.lastRunAt ?? create?.lastRunAt) || null,
      status: (update?.status ?? create?.status) || null,
      message: update?.message ?? create?.message ?? null,
    };
    mockSyncStatusState.record = data;
    return data;
  });
  const mockBingPagesDailyFindFirst = jest.fn(async () => mockLatestPageRecord);

  return {
    prisma: {
      bingApiKey: { findUnique: mockBingApiKeyFindUnique },
      bingSyncStatus: {
        findUnique: mockBingSyncStatusFindUnique,
        upsert: mockBingSyncStatusUpsert,
      },
      bingPagesDaily: {
        findFirst: mockBingPagesDailyFindFirst,
      },
    },
  };
});

jest.mock('../src/services/bingIngest', () => ({
  syncSite: jest.fn(),
}));

const databaseService = require('../src/services/database');
const bingIngest = require('../src/services/bingIngest');
const bingScheduler = require('../src/services/bingScheduler');

describe('BingScheduler processQueriesAndPages resume logic', () => {
  beforeEach(() => {
    mockSyncStatusState.record = null;
    mockLatestPageRecord = null;
    process.env.BING_API_KEY = 'test-key';
    databaseService.prisma.bingApiKey.findUnique.mockClear();
    databaseService.prisma.bingSyncStatus.findUnique.mockClear();
    databaseService.prisma.bingSyncStatus.upsert.mockClear();
    databaseService.prisma.bingPagesDaily.findFirst.mockClear();
    bingIngest.syncSite.mockReset();
    bingIngest.syncSite.mockResolvedValue({
      results: {
        queries: { recordsProcessed: 0 },
        pages: { recordsProcessed: 0 },
      },
    });
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      if (typeof callback === 'function') {
        callback();
      }
      return 0;
    });
  });

  afterEach(() => {
    setTimeoutSpy?.mockRestore();
  });

  test('resumes from next unprocessed day on subsequent runs', async () => {
    const siteUrl = 'https://example.com';
    const userId = 1;
    const startDate = new Date('2024-01-01T00:00:00.000Z');
    const endDate = new Date('2024-01-10T00:00:00.000Z');

    const firstRun = await bingScheduler.processQueriesAndPages(siteUrl, userId, startDate, endDate);
    expect(firstRun.processedChunks).toBeGreaterThan(0);

    const firstRunStartDates = bingIngest.syncSite.mock.calls.map((call) => call[2].startDate.toISOString().slice(0, 10));
    expect(new Set(firstRunStartDates)).toEqual(new Set(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']));

    expect(mockSyncStatusState.record).not.toBeNull();
    expect(mockSyncStatusState.record.lastSyncedDate.toISOString().slice(0, 10)).toBe('2024-01-05');

    bingIngest.syncSite.mockClear();

    const secondRun = await bingScheduler.processQueriesAndPages(siteUrl, userId, startDate, endDate);
    expect(secondRun.processedChunks).toBeGreaterThan(0);

    const secondRunStartDates = bingIngest.syncSite.mock.calls.map((call) => call[2].startDate.toISOString().slice(0, 10));
    expect(new Set(secondRunStartDates)).toEqual(new Set(['2024-01-06', '2024-01-07', '2024-01-08', '2024-01-09', '2024-01-10']));

    expect(mockSyncStatusState.record.lastSyncedDate.toISOString().slice(0, 10)).toBe('2024-01-10');

    expect(databaseService.prisma.bingSyncStatus.findUnique).toHaveBeenCalled();
    expect(databaseService.prisma.bingSyncStatus.upsert).toHaveBeenCalled();
  });
});
