const path = require('path');
module.exports = {
  apps: [{
    name: 'yingto-copy',
    script: 'server/server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '900M',
    env: {
      NODE_ENV: 'production',
      PORT: 8787,
      TZ: 'Asia/Singapore',
      APP_TZ: 'Asia/Singapore',
      MIN_FOLLOW_DAYS: 7,
      DB_PATH: path.join(__dirname, 'data', 'elitetrade.db'),
      UPLOAD_DIR: path.join(__dirname, 'uploads'),
      APP_URL: 'https://your-domain.com',
      ADMIN_JWT_SECRET: 'CHANGE_ME_ADMIN_SECRET',
      USER_JWT_SECRET: 'CHANGE_ME_USER_SECRET'
    }
  }]
};
