const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

// Simple in-memory user store (in production, use a database)
const users = [
  {
    id: 1,
    username: 'admin',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password: 'password'
    role: 'admin'
  }
];

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) {
    const user = users.find(u => u.id === req.session.userId);
    if (user) {
      req.user = user;
      return next();
    }
  }
  
  // If not authenticated, redirect to login or return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  } else {
    return res.redirect('/login');
  }
};

// Middleware to check if user is already authenticated (for login page)
const redirectIfAuthenticated = (req, res, next) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  next();
};

// Login function
const login = async (username, password) => {
  try {
    const user = users.find(u => u.username === username);
    if (!user) {
      throw new Error('Invalid credentials');
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }
    
    return {
      id: user.id,
      username: user.username,
      role: user.role
    };
  } catch (error) {
    logger.error('Login error:', error);
    throw error;
  }
};

// Logout function
const logout = (req) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        logger.error('Logout error:', err);
      }
    });
  }
};

module.exports = {
  requireAuth,
  redirectIfAuthenticated,
  login,
  logout,
  users
};
