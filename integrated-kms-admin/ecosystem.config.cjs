const optionalEnv = (name) => (process.env[name] ? { [name]: process.env[name] } : {})

module.exports = {
  apps: [
    {
      name: 'integrated-kms-admin',
      cwd: __dirname,
      script: 'backend/.venv/bin/kms-admin-server',
      interpreter: 'none',
      env: {
        KMS_ADMIN_ENV: process.env.KMS_ADMIN_ENV || 'development',
        KMS_ADMIN_HOST: '0.0.0.0',
        ...optionalEnv('KMS_ADMIN_PORT'),
        ...optionalEnv('KMS_ADMIN_DATABASE_URL'),
        ...optionalEnv('KMS_ADMIN_JWT_SECRET'),
        ...optionalEnv('ADMIN_PASSWORD_PEPPER'),
        ...optionalEnv('KMS_ADMIN_API_KEY_PEPPER'),
        ...optionalEnv('ADMIN_BOOTSTRAP_ID'),
        ...optionalEnv('ADMIN_BOOTSTRAP_PASSWORD'),
        KMS_ADMIN_LOG_BACKUP_DAYS: process.env.KMS_ADMIN_LOG_BACKUP_DAYS || '30',
        LIGHTRAG_BASE_URL: process.env.LIGHTRAG_BASE_URL || 'http://127.0.0.1:9422'
      },
      autorestart: true,
      max_restarts: 10,
      time: true,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log'
    }
  ]
}
