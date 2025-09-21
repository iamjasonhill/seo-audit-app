# Bing Data Monitoring Tools

This document describes the monitoring tools available to track Bing Webmaster Tools data collection and growth.

## 📊 Available Scripts

### Quick Status Check
```bash
npm run bing:status
```
**Purpose**: Quick overview of current Bing data status
**Shows**:
- Total records (totals, queries, pages)
- Properties with data
- Date ranges and data freshness
- Recent activity indicators

### Detailed Dashboard
```bash
npm run bing:dashboard
```
**Purpose**: Comprehensive analysis of all Bing data
**Shows**:
- Detailed breakdown by property
- Data completeness analysis
- Sync status information
- Growth indicators and trends
- Missing data identification

## 📈 What to Monitor

### Key Metrics
1. **Data Volume**: Total records across all data types
2. **Data Freshness**: How recent is the latest data
3. **Data Completeness**: Are there gaps in date ranges
4. **Property Coverage**: How many domains have data
5. **Sync Status**: Are all data types being collected

### Growth Indicators
- ✅ **Good**: Data from last 1-2 days
- ⚠️ **Warning**: Data from 3-7 days ago
- ❌ **Critical**: Data older than 7 days

### Data Types Tracked
- **📈 Totals**: Daily aggregated metrics (clicks, impressions, CTR, position)
- **🔍 Queries**: Individual search query performance
- **📄 Pages**: Individual page performance

## 🚨 Troubleshooting

### No Data Collected
If you see "No data collected yet":
1. Check if properties are registered
2. Verify API keys are configured
3. Ensure scheduler is running
4. Check for error logs

### Outdated Data
If data is older than 2 days:
1. Check scheduler logs
2. Verify API key validity
3. Check for rate limiting issues
4. Ensure cron jobs are running

### Missing Data Types
If only totals exist but no queries/pages:
1. This is normal - queries/pages are collected separately
2. Check if progressive processing is working
3. Monitor for timeout issues

## 📅 Recommended Monitoring Schedule

- **Daily**: Run `npm run bing:status` to check data freshness
- **Weekly**: Run `npm run bing:dashboard` for detailed analysis
- **After Changes**: Run both scripts after any configuration changes

## 🔧 Customization

Both scripts can be modified to:
- Add additional metrics
- Change date ranges for analysis
- Add email alerts for issues
- Export data to files
- Integrate with monitoring systems

## 📊 Sample Output

### Status Script Output
```
🔍 BING DATA STATUS - 9/21/2025, 11:24:51 AM
==================================================
📊 Records: 1,250 totals, 5,430 queries, 2,180 pages

🌐 Properties (3):
1. example.com
   📅 2025-09-01 to 2025-09-21 (21 days)
   📈 15,420 clicks, 125,300 impressions
   ✅ Today

2. another-site.com
   📅 2025-09-15 to 2025-09-21 (7 days)
   📈 3,250 clicks, 28,900 impressions
   ✅ Today

📈 Recent Activity (last 7 days):
   2025-09-21: example.com - 750 clicks
   2025-09-20: example.com - 680 clicks
   2025-09-20: another-site.com - 420 clicks
```

### Dashboard Script Output
```
🔍 BING WEBMASTER TOOLS DATA DASHBOARD
============================================================
📅 Generated: 9/21/2025, 11:24:15 AM

📊 BING PROPERTIES WITH DATA:
------------------------------------------------------------
1. 🌐 example.com
   📅 Date Range: 2025-09-01 to 2025-09-21
   📊 Total Days: 21
   📈 Total Clicks: 15,420
   👁️  Total Impressions: 125,300
   📊 Avg CTR: 12.31%
   🎯 Avg Position: 8.5

📋 DETAILED BREAKDOWN BY PROPERTY:
============================================================

🌐 example.com
----------------------------------------
📈 TOTALS DATA:
   📅 Date Range: 2025-09-01 to 2025-09-21
   📊 Records: 21/21 days (100.0% complete)
   ⚠️  Missing Days: 0
   📈 Total Clicks: 15,420
   👁️  Total Impressions: 125,300
   📅 Data Freshness: ✅ Up to date

🔍 QUERIES DATA:
   📅 Date Range: 2025-09-01 to 2025-09-21
   📊 Total Records: 5,430
   🔍 Unique Queries: 1,250
   📈 Total Clicks: 15,420
   👁️  Total Impressions: 125,300

📄 PAGES DATA:
   📅 Date Range: 2025-09-01 to 2025-09-21
   📊 Total Records: 2,180
   📄 Unique Pages: 450
   📈 Total Clicks: 15,420
   👁️  Total Impressions: 125,300

📊 SYNC STATUS:
   totals: ok (No message)
     Last synced: 2025-09-21
     Last run: 9/21/2025, 6:00:00 AM
   query: ok (No message)
     Last synced: 2025-09-21
     Last run: 9/21/2025, 6:05:00 AM
   page: ok (No message)
     Last synced: 2025-09-21
     Last run: 9/21/2025, 6:10:00 AM
```

## 🎯 Success Criteria

Your Bing data collection is working well when you see:
- ✅ Data from the last 1-2 days
- ✅ All three data types (totals, queries, pages) present
- ✅ No missing days in date ranges
- ✅ Consistent sync status showing "ok"
- ✅ Growing record counts over time
