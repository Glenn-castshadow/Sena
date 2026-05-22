module.exports = {
  apps: [{
    name: 'sena-job-tracker',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      BASE_PATH: '/jobtrack',
      // SESSION_SECRET: set this in your server's .env file — do not commit secrets
    },
  }],
};
