// middleware/auth.js
// Middleware functions run BEFORE a route's main logic.
// These two check that a valid login token (JWT) was sent with the request,
// and block the request if not — this is how we protect dashboards, fees, etc.

const jwt = require('jsonwebtoken'); // library that creates/verifies JSON Web Tokens
require('dotenv').config();

// Generic function: verifies the token and attaches the decoded user info to req.user
function verifyToken(req, res, next) {
  // Tokens are sent in the "Authorization" header as: "Bearer <token>"
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // grab just the token part

  // No token at all -> the user is not logged in
  if (!token) {
    return res.status(401).json({ message: 'No token provided. Please log in.' });
  }

  // Try to verify the token using our secret key
  jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
    if (err) {
      // Token is invalid or has expired
      return res.status(403).json({ message: 'Invalid or expired token. Please log in again.' });
    }
    req.user = decoded; // decoded contains { id, role } — attach it so later code can use it
    next(); // move on to the actual route handler
  });
}

// Only allows the request through if the logged-in user is a student
function requireStudent(req, res, next) {
  if (req.user.role !== 'student') {
    return res.status(403).json({ message: 'Access denied: students only.' });
  }
  next();
}

// Only allows the request through if the logged-in user is a teacher
function requireTeacher(req, res, next) {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Access denied: teachers only.' });
  }
  next();
}

// Only allows the request through if the logged-in user is an admin
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied: admins only.' });
  }
  next();
}

module.exports = { verifyToken, requireStudent, requireTeacher, requireAdmin };
