const crypto = require('crypto');

const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');

function getSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }

  return `dev-session-secret-${crypto.randomBytes(32).toString('hex')}`;
}

module.exports = {
  BASE_PATH,
  sessionSecret: getSessionSecret(),
};
