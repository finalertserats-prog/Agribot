module.exports = {
  apps: [
    {
      name: "agrifriend",
      script: "./dist/index.js",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      // Loop guard: a WhatsApp logout makes the app exit almost immediately.
      // With min_uptime 60s, such a fast exit counts as a crash, so pm2 stops
      // after max_restarts (5) instead of hammering WhatsApp forever — and the
      // 60s restart_delay throttles any retries to once a minute, not once a
      // few seconds (repeated re-links are what triggers WhatsApp's block).
      max_restarts: 5,
      min_uptime: 60000,
      restart_delay: 60000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
