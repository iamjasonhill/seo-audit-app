const { RateLimiterMemory } = require('rate-limiter-flexible');

const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'middleware',
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // Number of requests
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900, // Per 15 minutes by default
});

module.exports = async (req, res, next) => {
  try {
    // Skip rate limiting for safe/critical endpoints
    const path = req.path || req.originalUrl || '';
    const isStatic = req.method === 'GET' && /\.(js|css|png|jpg|jpeg|svg|ico|map)$/i.test(path);
    const skip = (
      isStatic ||
      path === '/health' ||
      path === '/' ||
      path === '/login' ||
      path === '/dashboard' ||
      path === '/property' ||
      path === '/report' ||
      path.startsWith('/api/auth/') || // allow auth flow without global rate limit
      path.startsWith('/api/gsc/') // allow GSC routes to use scoped limiter instead
    );
    if (skip) return next();

    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
    res.set('Retry-After', String(secs));
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${secs} seconds.`
    });
  }
};
