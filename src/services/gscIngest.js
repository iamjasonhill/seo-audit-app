const { google } = require('googleapis');
const databaseService = require('./database');
const logger = require('../utils/logger');

const DEFAULT_PAGE_SIZE = parseInt(process.env.GSC_BACKFILL_PAGE_SIZE || '25000', 10);
const DEFAULT_SLEEP_MS = parseInt(process.env.GSC_BACKFILL_SLEEP_MS || '250', 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseIsoDate(iso) {
  // iso: YYYY-MM-DD
  return new Date(iso + 'T00:00:00.000Z');
}

function addMonths(date, months) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

async function querySa(webmasters, siteUrl, body) {
  const resp = await webmasters.searchanalytics.query({ siteUrl, requestBody: body });
  return resp.data?.rows || [];
}

async function upsertTotalsRows(siteUrl, searchType, rows) {
  for (const r of rows) {
    const dateStr = r.keys?.[0];
    if (!dateStr) continue;
    const data = {
      siteUrl,
      date: parseIsoDate(dateStr),
      searchType,
      clicks: Math.round(r.clicks || 0),
      impressions: Math.round(r.impressions || 0),
      ctr: Number(r.ctr || 0),
      position: Number(r.position || 0),
    };
    try {
      await databaseService.prisma.gscTotalsDaily.upsert({
        where: {
          siteUrl_date_searchType: {
            siteUrl: data.siteUrl,
            date: data.date,
            searchType: data.searchType,
          },
        },
        update: {
          clicks: data.clicks,
          impressions: data.impressions,
          ctr: data.ctr,
          position: data.position,
        },
        create: data,
      });
    } catch (e) {
      logger.error('Upsert totals failed:', e.message);
    }
  }
}

async function upsertZeroTotalsForMissingDays(siteUrl, searchType, allIsoDays, existingRows) {
  try {
    const present = new Set((existingRows||[]).map(r => r.keys?.[0]).filter(Boolean));
    for (const iso of allIsoDays) {
      if (present.has(iso)) continue;
      const data = {
        siteUrl,
        date: parseIsoDate(iso),
        searchType,
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
      };
      await databaseService.prisma.gscTotalsDaily.upsert({
        where: {
          siteUrl_date_searchType: {
            siteUrl: data.siteUrl,
            date: data.date,
            searchType: data.searchType,
          },
        },
        update: {
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
        },
        create: data,
      });
    }
  } catch (e) {
    logger.warn('Fill missing totals failed:', e.message);
  }
}

async function upsertDimRows(model, keyName, siteUrl, searchType, rows) {
  for (const r of rows) {
    const dateStr = r.keys?.[0];
    const keyVal = r.keys?.[1];
    if (!dateStr || keyVal == null) continue;
    const data = {
      siteUrl,
      date: parseIsoDate(dateStr),
      searchType,
      [keyName]: keyVal,
      clicks: Math.round(r.clicks || 0),
      impressions: Math.round(r.impressions || 0),
      ctr: Number(r.ctr || 0),
      position: Number(r.position || 0),
    };
    const where = {};
    const compoundKey = `siteUrl_date_searchType_${keyName}`;
    where[compoundKey] = {
      siteUrl: data.siteUrl,
      date: data.date,
      searchType: data.searchType,
      [keyName]: data[keyName],
    };
    try {
      await databaseService.prisma[model].upsert({
        where,
        update: {
          clicks: data.clicks,
          impressions: data.impressions,
          ctr: data.ctr,
          position: data.position,
        },
        create: data,
      });
    } catch (e) {
      logger.error(`Upsert ${model} failed:`, e.message);
    }
  }
}

async function paginateAndSave(webmasters, siteUrl, searchType, baseBody, saver) {
  let startRow = 0;
  const rowLimit = DEFAULT_PAGE_SIZE;
  // Progress accounting is done by the caller via an optional callback on baseBody.__progress
  let requestsDone = 0;
  let requestsPlanned = 1; // optimistic; will grow if we hit page boundaries
  const report = typeof baseBody.__progress === 'function' ? baseBody.__progress : null;
  if (report) report({ requestsDone, requestsPlanned });
  while (true) {
    const body = { ...baseBody, rowLimit, startRow };
    delete body.__progress;
    const rows = await querySa(webmasters, siteUrl, body);
    requestsDone += 1;
    if (!rows.length) { if (report) report({ requestsDone, requestsPlanned }); break; }
    await saver(rows);
    startRow += rows.length;
    if (rows.length === rowLimit) {
      requestsPlanned += 1; // there is at least one more page
    }
    if (report) report({ requestsDone, requestsPlanned });
    await sleep(DEFAULT_SLEEP_MS);
    if (rows.length < rowLimit) break;
  }
}

async function updateSync(siteUrl, dimension, searchType, status, message, lastSyncedDate) {
  try {
    const now = new Date();
    // Upsert by (siteUrl, searchType, dimension) using a synthetic uniqueness via find+create/update
    const existing = await databaseService.prisma.gscSyncStatus.findFirst({
      where: { siteUrl, searchType, dimension },
    });
    if (existing) {
      await databaseService.prisma.gscSyncStatus.update({
        where: { id: existing.id },
        data: { status, message, lastRunAt: now, lastSyncedDate: lastSyncedDate || existing.lastSyncedDate },
      });
    } else {
      await databaseService.prisma.gscSyncStatus.create({
        data: { siteUrl, searchType, dimension, status, message, lastRunAt: now, lastSyncedDate: lastSyncedDate || null },
      });
    }
  } catch (e) {
    logger.error('Update sync status failed:', e.message);
  }
}

async function backfillProperty(oauth2Client, siteUrl, options = {}) {
  const {
    startDate,
    endDate,
    searchTypes = ['web'],
    onlyTotals = false,
  } = options;

  const webmasters = google.webmasters({ version: 'v3', auth: oauth2Client });

  // Compute default 16-month window
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : addMonths(end, -16);

  const rangeDays = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endUtc) {
    rangeDays.push(formatDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const searchType of searchTypes) {
    logger.info(`GSC backfill start site=${siteUrl} type=${searchType} days=${rangeDays.length}`);
    await updateSync(siteUrl, 'totals', searchType, 'running', '0/1 (0%). Estimating…', null);

    // Totals
    try {
      const totalsRows = await querySa(webmasters, siteUrl, {
        startDate: formatDate(start),
        endDate: formatDate(end),
        searchType,
        dataState: 'all',
        dimensions: ['date'],
        rowLimit: 5000,
      });
      await upsertTotalsRows(siteUrl, searchType, totalsRows);
      // Densify: upsert zero rows for days with no data so coverage shows full range
      await upsertZeroTotalsForMissingDays(siteUrl, searchType, rangeDays, totalsRows);
      await updateSync(siteUrl, 'totals', searchType, 'ok', null, end);
    } catch (e) {
      await updateSync(siteUrl, 'totals', searchType, 'error', e.message, null);
      throw e;
    }

    // Helper to run per-dimension (date + dimension)
    const runDim = async (dimension, keyName, model) => {
      // Start progress for this dimension
      let startedAt = Date.now();
      let lastMsgTime = 0;
      let cached = { requestsDone: 0, requestsPlanned: 1 };
      const renderMsg = () => {
        const done = cached.requestsDone;
        const plan = Math.max(cached.requestsPlanned, done || 1);
        const pct = Math.min(99, Math.floor((done / plan) * 100));
        const elapsed = Date.now() - startedAt;
        const rate = done > 0 ? (elapsed / done) : 0; // ms per request
        const remaining = Math.max(0, plan - done);
        const etaMs = rate * remaining;
        const mins = Math.floor(etaMs / 60000);
        const secs = Math.floor((etaMs % 60000) / 1000);
        const etaStr = `${mins}:${secs.toString().padStart(2,'0')}`;
        return `${done}/${plan} (${pct}%). ETA ${etaStr}`;
      };

      await updateSync(siteUrl, dimension, searchType, 'running', renderMsg(), null);
      try {
        await paginateAndSave(webmasters, siteUrl, searchType, {
          startDate: formatDate(start),
          endDate: formatDate(end),
          searchType,
          dataState: 'all',
          dimensions: ['date', dimension],
          __progress: ({ requestsDone, requestsPlanned }) => {
            cached = { requestsDone, requestsPlanned };
            const now = Date.now();
            if (now - lastMsgTime > 1500) { // throttle DB writes
              lastMsgTime = now;
              updateSync(siteUrl, dimension, searchType, 'running', renderMsg(), null).catch(()=>{});
            }
          },
        }, async (rows) => {
          await upsertDimRows(model, keyName, siteUrl, searchType, rows);
        });
        await updateSync(siteUrl, dimension, searchType, 'ok', null, end);
      } catch (e) {
        await updateSync(siteUrl, dimension, searchType, 'error', e.message, null);
        throw e;
      }
    };

    if (!onlyTotals) {
      await runDim('page', 'page', 'gscPagesDaily');
      await runDim('query', 'query', 'gscQueriesDaily');
      await runDim('device', 'device', 'gscDeviceDaily');
      await runDim('country', 'country', 'gscCountryDaily');
    }

    // Appearance: fetch without date (API restriction) and store as aggregated range
    if (!onlyTotals) {
      await updateSync(siteUrl, 'searchAppearance', searchType, 'running', '0/1 (0%). Estimating…', null);
      try {
        const appearanceRows = await querySa(webmasters, siteUrl, {
          startDate: formatDate(start),
          endDate: formatDate(end),
          searchType,
          dataState: 'all',
          dimensions: ['searchAppearance'],
          rowLimit: 25000,
        });
        for (const r of appearanceRows) {
          const appearance = r.keys?.[0];
          if (!appearance) continue;
          const data = {
            siteUrl,
            searchType,
            appearance,
            startDate: parseIsoDate(formatDate(start)),
            endDate: parseIsoDate(formatDate(end)),
            clicks: Math.round(r.clicks || 0),
            impressions: Math.round(r.impressions || 0),
            ctr: Number(r.ctr || 0),
            position: Number(r.position || 0),
          };
          await databaseService.prisma.gscAppearanceRange.upsert({
            where: {
              siteUrl_searchType_appearance_startDate_endDate: {
                siteUrl: data.siteUrl,
                searchType: data.searchType,
                appearance: data.appearance,
                startDate: data.startDate,
                endDate: data.endDate,
              }
            },
            update: {
              clicks: data.clicks,
              impressions: data.impressions,
              ctr: data.ctr,
              position: data.position,
            },
            create: data,
          });
        }
        await updateSync(siteUrl, 'searchAppearance', searchType, 'ok', null, end);
      } catch (e) {
        await updateSync(siteUrl, 'searchAppearance', searchType, 'error', e.message, null);
      }
    }

    logger.info(`GSC backfill done site=${siteUrl} type=${searchType}`);
  }

  // Ensure property exists in catalog
  try {
    await databaseService.prisma.gscProperty.upsert({
      where: { siteUrl },
      update: {},
      create: { siteUrl },
    });
  } catch (e) {
    logger.warn('Upsert gsc_property failed:', e.message);
  }

  return { success: true };
}

async function getSyncStatus(siteUrl) {
  const rows = await databaseService.prisma.gscSyncStatus.findMany({
    where: { siteUrl },
    orderBy: { lastRunAt: 'desc' },
  });
  return rows;
}

module.exports = {
  backfillProperty,
  getSyncStatus,
};


