const { RateLimiterMemory } = require('rate-limiter-flexible');

// Env-configurable limits with sensible defaults
const DEFAULT_POINTS = parseInt(process.env.GSC_RATE_LIMIT_MAX_REQUESTS) || 120; // requests
const DEFAULT_DURATION = parseInt(process.env.GSC_RATE_LIMIT_WINDOW_SEC) || 60; // seconds

// Tighter limits for URL Inspection API (heavier/stricter on Google's side)
const INSPECT_POINTS = parseInt(process.env.GSC_INSPECT_MAX_REQUESTS) || 10; // requests
const INSPECT_DURATION = parseInt(process.env.GSC_INSPECT_WINDOW_SEC) || 60; // seconds

const defaultLimiter = new RateLimiterMemory({
  keyPrefix: 'gsc-default',
  points: DEFAULT_POINTS,
  duration: DEFAULT_DURATION,
});

const inspectLimiter = new RateLimiterMemory({
  keyPrefix: 'gsc-inspect',
  points: INSPECT_POINTS,
  duration: INSPECT_DURATION,
});

module.exports = async (req, res, next) => {
  try {
    const path = req.path || req.originalUrl || '';

    // Do not rate limit OAuth handshake endpoints
    if (path.startsWith('/connect') || path.startsWith('/callback')) {
      return next();
    }

    // Use user id where available, otherwise fall back to IP
    const userId = (req.user && (req.user.id || req.user.userId)) || null;
    const key = userId ? `u:${userId}` : `ip:${req.ip}`;

    // Route-specific limiter selection
    const isUrlInspect = req.method === 'POST' && path.includes('/url/inspect');
    const limiter = isUrlInspect ? inspectLimiter : defaultLimiter;

    await limiter.consume(key);
    return next();
  } catch (rejRes) {
    const secs = Math.round((rejRes && rejRes.msBeforeNext) ? rejRes.msBeforeNext / 1000 : 1) || 1;
    res.set('Retry-After', String(secs));
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `GSC rate limit exceeded. Try again in ${secs} seconds.`
    });
  }
};


