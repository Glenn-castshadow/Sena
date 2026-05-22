const crypto = require('crypto');

function normalizeBasePath(value) {
  if (!value || value === '/') return '';
  if (!value.startsWith('/')) {
    throw new Error('BASE_PATH must start with "/" when set');
  }
  return value.replace(/\/$/, '');
}

const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');

function getSessionSecret() {
  if (process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === 'production' && process.env.SESSION_SECRET.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters in production');
    }
    return process.env.SESSION_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }

  return `dev-session-secret-${crypto.randomBytes(32).toString('hex')}`;
}

function getPort() {
  const rawPort = process.env.PORT || '3000';
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }
  return port;
}

module.exports = {
  BASE_PATH,
  port: getPort(),
  sessionSecret: getSessionSecret(),
};
