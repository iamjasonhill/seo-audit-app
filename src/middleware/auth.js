const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const databaseService = require('../services/database');

// Middleware to check if user is authenticated
const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  
  const fullPath = req.originalUrl || req.url || req.path || '';
  if (!token) {
    if (fullPath.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    } else {
      return res.redirect('/login');
    }
  }
  
  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'your-secret-key-change-in-production');
    const user = await databaseService.prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) throw new Error('User not found');
    req.user = { 
      id: user.id, 
      username: user.name || user.email,
      email: user.email,
      role: user.role,
      status: user.status
    };
    next();
  } catch (error) {
    logger.error('JWT verification failed:', error.message);
    
    if (fullPath.startsWith('/api/')) {
      return res.status(401).json({ error: 'Invalid token' });
    } else {
      return res.redirect('/login');
    }
  }
};

// Middleware to check if user is already authenticated (for login page)
const redirectIfAuthenticated = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'your-secret-key-change-in-production');
      const user = await databaseService.prisma.user.findUnique({ where: { id: decoded.userId } });
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
    const user = await databaseService.prisma.user.findFirst({ where: { username } });
    if (!user || user.status !== 'active' || !user.passwordHash) throw new Error('Invalid credentials');
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) throw new Error('Invalid credentials');
    const token = jwt.sign({ userId: user.id, username: user.username || user.email, role: user.role }, process.env.SESSION_SECRET || 'your-secret-key-change-in-production', { expiresIn: '30d' });
    return { id: user.id, username: user.username || user.email, role: user.role, token };
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
};

