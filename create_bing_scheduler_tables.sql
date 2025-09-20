-- Create Bing scheduler tables
CREATE TABLE IF NOT EXISTS bing_user_property (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  site_url TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  sync_interval_hours INTEGER DEFAULT 24,
  priority_order INTEGER DEFAULT 0,
  last_full_sync_at TIMESTAMP,
  next_sync_due_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, site_url)
);

CREATE INDEX IF NOT EXISTS idx_bing_user_property_scheduler 
ON bing_user_property(enabled, next_sync_due_at, priority_order, last_full_sync_at);

CREATE TABLE IF NOT EXISTS bing_sync_lock (
  id TEXT PRIMARY KEY,
  locked_until TIMESTAMP NOT NULL,
  locked_by TEXT NOT NULL
);
