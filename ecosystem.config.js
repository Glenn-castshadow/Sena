module.exports = {
  apps: [{
    name: 'sena-job-tracker',
    cwd: __dirname,
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      BASE_PATH: '',
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      BASE_PATH: '/jobtrack',
      // SESSION_SECRET: set this in your server's .env file or shell environment; do not commit secrets
    },
  }],
};
