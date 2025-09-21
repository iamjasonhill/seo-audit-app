# Bing Scheduler Optimizations

## Problem Analysis
The Bing scheduler was timing out after 256 operations due to Vercel's serverless function limits. The main issues were:

1. **Large chunk processing**: Processing 7-day chunks was too large for serverless limits
2. **Sequential processing**: All data types (totals, queries, pages) processed sequentially
3. **No memory management**: Large datasets loaded into memory without cleanup
4. **Inefficient database operations**: Individual upserts instead of batch operations

## Optimizations Implemented

### 1. Reduced Chunk Size
- **Before**: 7-day chunks
- **After**: 2-day chunks for totals, 1-day chunks for queries/pages
- **Benefit**: Smaller memory footprint, faster processing per chunk

### 2. Limited Chunks Per Run
- **Before**: Processed all chunks in one run
- **After**: Maximum 10 chunks per run for totals, 5 for queries/pages
- **Benefit**: Prevents timeout by limiting execution time

### 3. Progressive Data Processing
- **Before**: Processed totals, queries, and pages together
- **After**: Process totals first, then queries/pages in separate runs
- **Benefit**: Gets basic data quickly, detailed data progressively

### 4. Batch Database Operations
- **Before**: Individual upserts for each record
- **After**: Batch operations with `createMany` and `skipDuplicates`
- **Benefit**: Significantly faster database operations, reduced memory usage

### 5. Improved Error Handling
- **Before**: Basic error handling
- **After**: Exponential backoff, consecutive error limits, graceful degradation
- **Benefit**: More resilient to API rate limits and temporary failures

### 6. Smart Scheduling
- **Before**: Fixed retry intervals
- **After**: Dynamic scheduling based on completion status
  - Complete: Normal interval (24 hours)
  - Hit chunk limit: Quick retry (2 minutes)
  - Not complete: Standard retry (5 minutes)
- **Benefit**: Efficient resource usage, faster completion

### 7. Memory Optimization
- **Before**: All data loaded into memory at once
- **After**: Process in batches of 50 records with cleanup
- **Benefit**: Reduced memory usage, better performance

## Key Changes Made

### `src/services/bingScheduler.js`
- Reduced chunk size from 7 to 2 days
- Added `maxChunksPerRun` limit (10 for totals)
- Implemented progressive processing (totals first)
- Added smart scheduling logic
- Added `processQueriesAndPages` method for separate processing

### `src/services/bingIngest.js`
- Implemented batch processing for all data types
- Added `createMany` with `skipDuplicates` for better performance
- Added fallback to individual upserts if batch fails
- Added small delays between batches to avoid overwhelming database
- Improved error handling and logging

## Expected Results

1. **No more timeouts**: Smaller chunks and limited runs prevent Vercel timeout
2. **Faster data collection**: Batch operations are significantly faster
3. **Better reliability**: Improved error handling and retry logic
4. **Progressive data availability**: Basic data (totals) available quickly
5. **Efficient resource usage**: Better memory management and API rate limiting

## Monitoring

The optimized scheduler provides detailed logging for:
- Chunk processing progress
- Batch operation results
- Error handling and retry attempts
- Scheduling decisions
- Performance metrics

## Next Steps

1. Deploy the optimized scheduler to production
2. Monitor logs for performance improvements
3. Adjust chunk sizes and limits based on real-world performance
4. Consider adding queries/pages processing in separate cron jobs if needed

## Configuration

The optimizations are designed to work within Vercel's serverless limits:
- **Execution time**: Limited by chunk processing
- **Memory usage**: Optimized with batch operations
- **API rate limits**: Respectful delays between requests
- **Database performance**: Efficient batch operations
