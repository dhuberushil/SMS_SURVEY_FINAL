module.exports = {
  apps: [
    {
      name: 'sms-survey-engine',
      script: 'src/server.js',
      cwd: '.',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
