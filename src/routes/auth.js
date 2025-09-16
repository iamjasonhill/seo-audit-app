const express = require('express');
const Joi = require('joi');
const { login, logout, redirectIfAuthenticated } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schema for login
const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});

// POST /api/auth/login - Login endpoint
router.post('/login', async (req, res, next) => {
  try {
    // Validate request body
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { username, password } = value;
    
    logger.info(`Login attempt for user: ${username}`);
    
    // Attempt login
    const user = await login(username, password);
    
    // Set token as HTTP-only cookie
    res.cookie('token', user.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    });
    
    logger.info(`User ${username} logged in successfully`);
    
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
    
  } catch (error) {
    logger.error('Login failed:', error.message);
    res.status(401).json({
      error: 'Authentication Failed',
      message: 'Invalid username or password'
    });
  }
});

// POST /api/auth/logout - Logout endpoint
router.post('/logout', (req, res, next) => {
  try {
    const username = req.user?.username || 'unknown';
    
    logout(req, res);
    
    logger.info(`User ${username} logged out`);
    
    res.json({
      success: true,
      message: 'Logout successful'
    });
    
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      error: 'Logout Failed',
      message: 'An error occurred during logout'
    });
  }
});

// GET /api/auth/status - Check authentication status
router.get('/status', (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    
    logger.info('Auth status check:', {
      hasAuthHeader: !!req.headers.authorization,
      hasTokenCookie: !!req.cookies?.token,
      tokenLength: token?.length || 0,
      cookies: Object.keys(req.cookies || {})
    });
    
    if (!token) {
      return res.json({
        authenticated: false
      });
    }
    
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'your-secret-key-change-in-production');
    
    res.json({
      authenticated: true,
      user: {
        id: decoded.userId,
        username: decoded.username,
        role: decoded.role
      }
    });
    
  } catch (error) {
    logger.error('Auth status check error:', error);
    res.json({
      authenticated: false
    });
  }
});

module.exports = router;
