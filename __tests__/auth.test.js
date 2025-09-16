const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Mock the auth middleware
const mockAuth = {
  requireAuth: (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'your-secret-key-change-in-production');
      req.user = { id: decoded.userId, username: decoded.username, role: decoded.role };
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
};

describe('Authentication', () => {
  const validToken = jwt.sign(
    { userId: 1, username: 'admin', role: 'admin' },
    process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    { expiresIn: '24h' }
  );

  const invalidToken = 'invalid.token.here';

  describe('Token Validation', () => {
    test('should accept valid JWT token', () => {
      const req = {
        headers: { authorization: `Bearer ${validToken}` },
        cookies: {}
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      mockAuth.requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.username).toBe('admin');
    });

    test('should reject invalid JWT token', () => {
      const req = {
        headers: { authorization: `Bearer ${invalidToken}` },
        cookies: {}
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      mockAuth.requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
      expect(next).not.toHaveBeenCalled();
    });

    test('should reject request without token', () => {
      const req = {
        headers: {},
        cookies: {}
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      mockAuth.requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Password Hashing', () => {
    test('should hash passwords correctly', async () => {
      const password = 'testpassword';
      const hashedPassword = await bcrypt.hash(password, 10);
      
      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe(password);
      expect(hashedPassword.length).toBeGreaterThan(50);
    });

    test('should verify hashed passwords correctly', async () => {
      const password = 'testpassword';
      const hashedPassword = await bcrypt.hash(password, 10);
      const isValid = await bcrypt.compare(password, hashedPassword);
      
      expect(isValid).toBe(true);
    });

    test('should reject incorrect passwords', async () => {
      const password = 'testpassword';
      const wrongPassword = 'wrongpassword';
      const hashedPassword = await bcrypt.hash(password, 10);
      const isValid = await bcrypt.compare(wrongPassword, hashedPassword);
      
      expect(isValid).toBe(false);
    });
  });
});
