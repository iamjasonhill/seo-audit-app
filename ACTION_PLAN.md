# Research SEO App - Action Plan

**Generated:** November 30, 2025\
**Priority:** Maintenance & Security Updates

---

## 🎯 Quick Summary

The Research SEO App is **fully functional** with all tests passing. However,
there are some security vulnerabilities and outdated dependencies that should be
addressed. This action plan prioritizes fixes by impact and risk.

---

## 🔴 HIGH PRIORITY (Do First)

### 1. Fix Security Vulnerabilities

**Issue:** 9 npm security vulnerabilities (3 low, 1 moderate, 5 high)

**Impact:** Potential security risks in production

**Action Steps:**

```bash
# Step 1: Try safe fixes first (no breaking changes)
npm audit fix

# Step 2: Review what's left
npm audit

# Step 3: If needed, apply force fixes (test thoroughly after)
npm audit fix --force
```

**Affected Packages:**

- `cookie` - Out of bounds characters vulnerability
- `js-yaml` - Prototype pollution
- `tar-fs` - Path traversal vulnerabilities
- `ws` - DoS vulnerability

**Testing After Fix:**

```bash
# Run all tests to ensure nothing broke
npm test

# Start the app and verify it works
npm run dev
```

**Time Estimate:** 30-60 minutes\
**Risk Level:** Medium (may introduce breaking changes with --force)

---

## 🟡 MEDIUM PRIORITY (Do Soon)

### 2. Update Outdated Dependencies

**Issue:** baseline-browser-mapping is over 2 months old

**Impact:** Lighthouse may use outdated browser compatibility data

**Action Steps:**

```bash
npm i baseline-browser-mapping@latest -D
```

**Testing After Fix:**

```bash
npm test
```

**Time Estimate:** 5 minutes\
**Risk Level:** Low

---

### 3. Configure API Credentials

**Issue:** Missing or invalid API credentials causing errors in logs

**Impact:** Search console data collection not working

**Action Steps:**

1. **Google Search Console OAuth:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create OAuth 2.0 credentials
   - Add to `.env`:
     ```env
     GOOGLE_OAUTH_CLIENT_ID=your_client_id
     GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
     GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/gsc/callback
     ```

2. **Google OAuth for Login:**
   - Use same or separate OAuth credentials
   - Add to `.env`:
     ```env
     GOOGLE_OAUTH_LOGIN_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
     ADMIN_GOOGLE_EMAIL=your-email@gmail.com
     ```

3. **Bing Webmaster Tools API:**
   - Go to [Bing Webmaster Tools](https://www.bing.com/webmasters/)
   - Get API key from Settings → API Access
   - Add to `.env`:
     ```env
     BING_API_KEY=your_bing_api_key
     ```

4. **Optional - Google PageSpeed API:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Enable PageSpeed Insights API
   - Create API key
   - Add to `.env`:
     ```env
     GOOGLE_API_KEY=your_google_api_key
     ```

**Testing After Fix:**

```bash
# Start the app
npm run dev

# Test OAuth flow by visiting:
# http://localhost:3000/login

# Check Bing data collection:
npm run bing:status
```

**Time Estimate:** 30-45 minutes (depending on API setup)\
**Risk Level:** Low

---

## 🟢 LOW PRIORITY (Nice to Have)

### 4. Improve Error Handling

**Issue:** Some API errors in logs are expected but could be handled more
gracefully

**Impact:** Cleaner logs, better user experience

**Action Steps:**

1. Review error handling in:
   - `src/services/bingScheduler.js`
   - `src/services/gscScheduler.js`
   - `src/routes/gsc.js`
   - `src/routes/bing.js`

2. Add user-friendly error messages for:
   - Missing API credentials
   - OAuth flow failures
   - Rate limit errors

**Time Estimate:** 1-2 hours\
**Risk Level:** Low

---

### 5. Add Environment Validation

**Issue:** No validation that required environment variables are set

**Impact:** Better developer experience, clearer error messages

**Action Steps:**

1. Create `src/utils/validateEnv.js`:

```javascript
const requiredEnvVars = [
    "DATABASE_URL",
    "SESSION_SECRET",
    "PORT",
];

const optionalEnvVars = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "BING_API_KEY",
    "GOOGLE_API_KEY",
];

function validateEnv() {
    const missing = requiredEnvVars.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        console.error("❌ Missing required environment variables:");
        missing.forEach((key) => console.error(`   - ${key}`));
        process.exit(1);
    }

    const missingOptional = optionalEnvVars.filter((key) => !process.env[key]);
    if (missingOptional.length > 0) {
        console.warn("⚠️  Missing optional environment variables:");
        missingOptional.forEach((key) => console.warn(`   - ${key}`));
        console.warn("   Some features may not work without these.");
    }

    console.log("✅ Environment validation passed");
}

module.exports = validateEnv;
```

2. Add to `server.js` at the top:

```javascript
require("dotenv").config();
const validateEnv = require("./src/utils/validateEnv");
validateEnv();
```

**Time Estimate:** 30 minutes\
**Risk Level:** Very Low

---

### 6. Update Documentation

**Issue:** Some documentation may be outdated

**Impact:** Better onboarding for new developers

**Action Steps:**

1. Review and update `README.md` with latest features
2. Add troubleshooting section for common issues
3. Document the scheduler system in detail
4. Add API endpoint examples

**Time Estimate:** 1-2 hours\
**Risk Level:** None

---

## 📋 Maintenance Checklist

### Weekly

- [ ] Check application logs for errors
- [ ] Run `npm run bing:status` to verify data collection
- [ ] Review database size and performance
- [ ] Check for new security advisories: `npm audit`

### Monthly

- [ ] Update dependencies: `npm update`
- [ ] Run full test suite: `npm test`
- [ ] Review and archive old audit data
- [ ] Check API rate limits and usage
- [ ] Backup database

### Quarterly

- [ ] Review and update dependencies to latest major versions
- [ ] Security audit of custom code
- [ ] Performance optimization review
- [ ] User feedback review and feature planning

---

## 🚀 Quick Start for Fixes

### Option 1: Fix Everything Now (Recommended)

```bash
# 1. Update dependencies and fix vulnerabilities
npm audit fix
npm i baseline-browser-mapping@latest -D

# 2. Run tests
npm test

# 3. If tests pass, try force fixes
npm audit fix --force

# 4. Run tests again
npm test

# 5. If tests fail, restore package-lock.json from git
git checkout package-lock.json
npm install
```

### Option 2: Minimal Safe Updates

```bash
# Only do safe fixes
npm audit fix
npm i baseline-browser-mapping@latest -D
npm test
```

### Option 3: Just Get It Running

```bash
# If everything is already working, just verify
npm test
npm run dev
```

---

## 🎯 Success Criteria

After completing the action plan, you should have:

- ✅ Zero or minimal security vulnerabilities
- ✅ All dependencies up to date
- ✅ All tests passing
- ✅ API credentials configured (if needed)
- ✅ Clean application logs
- ✅ Environment validation in place
- ✅ Updated documentation

---

## 📊 Current vs. Target State

| Metric                   | Current      | Target        |
| ------------------------ | ------------ | ------------- |
| Security Vulnerabilities | 9            | 0             |
| Test Pass Rate           | 100% (31/31) | 100%          |
| Outdated Dependencies    | 1            | 0             |
| API Integration          | Partial      | Full          |
| Error Handling           | Basic        | Comprehensive |
| Documentation            | Good         | Excellent     |

---

## 🔍 Verification Steps

After completing fixes:

1. **Security Check:**
   ```bash
   npm audit
   # Should show 0 vulnerabilities or only low-risk ones
   ```

2. **Functionality Check:**
   ```bash
   npm test
   # Should show 31 passing tests
   ```

3. **Runtime Check:**
   ```bash
   npm run dev
   # Should start without errors
   # Visit http://localhost:3000
   ```

4. **Health Check:**
   ```bash
   curl http://localhost:3000/health
   # Should return {"status":"healthy",...}
   ```

5. **Data Collection Check:**
   ```bash
   npm run bing:status
   # Should show data if API key is configured
   ```

---

## 💡 Tips

- **Backup First:** Before making changes, commit your current state to git
- **Test Incrementally:** Don't apply all fixes at once; test after each change
- **Read Warnings:** Pay attention to npm warnings about breaking changes
- **Check Logs:** Monitor logs after each change for new errors
- **Use Version Control:** Commit after each successful fix

---

## 🆘 If Something Breaks

### Rollback Strategy

```bash
# Restore package files
git checkout package.json package-lock.json

# Reinstall
npm install

# Verify
npm test
```

### Get Help

1. Check error logs in `/logs/error.log`
2. Review npm error output
3. Search for specific error messages
4. Check package changelogs for breaking changes

---

**End of Action Plan**
