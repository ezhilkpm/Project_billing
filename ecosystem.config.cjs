// ecosystem.config.cjs - PM2 Configuration for Ubuntu / Windows Server
module.exports = {
  apps: [
    {
      name: 'chefpulse-pos',
      script: 'server/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        HOST: '0.0.0.0'
      }
    }
  ]
};
