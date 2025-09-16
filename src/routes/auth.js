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
    
    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    
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
    const username = req.session?.username || 'unknown';
    
    logout(req);
    
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
    if (req.session && req.session.userId) {
      res.json({
        authenticated: true,
        user: {
          id: req.session.userId,
          username: req.session.username,
          role: req.session.role
        }
      });
    } else {
      res.json({
        authenticated: false
      });
    }
  } catch (error) {
    logger.error('Auth status check error:', error);
    res.status(500).json({
      error: 'Status Check Failed',
      message: 'An error occurred checking authentication status'
    });
  }
});

module.exports = router;
