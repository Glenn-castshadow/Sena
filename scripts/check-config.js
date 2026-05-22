require('dotenv').config();

try {
  const { BASE_PATH, port } = require('../config');

  const summary = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: port,
    BASE_PATH: BASE_PATH || '/',
    DB_PATH: process.env.DB_PATH || './jobs.db',
    SESSION_SECRET: process.env.SESSION_SECRET ? 'set' : 'generated for non-production use',
  };

  console.log('Configuration OK');
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error('Configuration error');
  console.error(error.message);
  process.exit(1);
}
