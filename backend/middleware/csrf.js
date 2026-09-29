const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getOrigin(req) {
  if (req.headers.origin) return req.headers.origin;
  if (!req.headers.referer) return null;
  try {
    return new URL(req.headers.referer).origin;
  } catch (error) {
    return null;
  }
}

function allowedOrigins() {
  const configured = process.env.APP_BASE_URL;
  const origins = new Set();
  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch (error) {
      throw new Error('APP_BASE_URL must be a valid URL.');
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add(`http://localhost:${process.env.PORT || 5000}`);
    origins.add(`http://127.0.0.1:${process.env.PORT || 5000}`);
  }
  return origins;
}

function isAllowedOrigin(origin) {
  if (allowedOrigins().has(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;

  try {
    const url = new URL(origin);
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && Boolean(url.port);
  } catch (error) {
    return false;
  }
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method) || req.originalUrl === '/api/payments/webhook' || req.path === '/webhook') {
    return next();
  }

  const origin = getOrigin(req);
  if (!origin) {
    return next();
  }

  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ message: 'Cross-site request blocked.' });
  }

  next();
}

module.exports = { csrfProtection };
