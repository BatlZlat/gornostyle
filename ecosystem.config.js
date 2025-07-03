module.exports = {
  apps: [
    {
      name: 'gornostyle',
      script: './src/app.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false
    }
  ]
}; 