// pm2 process file — see README.md "Deploy". Secrets come from
// payment-server/.env (loaded by src/config.js), never from this file.
module.exports = {
  apps: [
    {
      name: 'glow-payment',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      time: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
