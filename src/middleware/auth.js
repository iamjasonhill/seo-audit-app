const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  
  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    } else {
      return res.redirect('/login');
    }
  }
  
  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'your-secret-key-change-in-production');
    const user = users.find(u => u.id === decoded.userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    req.user = user;
    next();
  } catch (error) {
    logger.error('JWT verification failed:', error.message);
    
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Invalid token' });
    } else {
      return res.redirect('/login');
    }
  }
};

// Middleware to check if user is already authenticated (for login page)
const redirectIfAuthenticated = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'your-secret-key-change-in-production');
      const user = users.find(u => u.id === decoded.userId);
      
      if (user) {
        return res.redirect('/dashboard');
      }
    } catch (error) {
      // Token is invalid, continue to login page
    }
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
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '24h' }
    );
    
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      token
    };
  } catch (error) {
    logger.error('Login error:', error);
    throw error;
  }
};

// Logout function
const logout = (req, res) => {
  // Clear the token cookie
  res.clearCookie('token');
  return { success: true };
};

module.exports = {
  requireAuth,
  redirectIfAuthenticated,
  login,
  logout,
  users
};

