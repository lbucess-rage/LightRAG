const fs = require('fs')
const path = require('path')

// Load secrets/config from a non-committed env file (default: .env.production).
// Override the path with KMS_ADMIN_ENV_FILE. Process env always takes precedence.
const loadEnvFile = (file) => {
  const result = {}
  try {
    const content = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx === -1) continue
      const key = line.slice(0, idx).trim()
      let value = line.slice(idx + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      result[key] = value
    }
  } catch (_) {
    // env file is optional
  }
  return result
}

const fileEnv = loadEnvFile(process.env.KMS_ADMIN_ENV_FILE || '.env.production')
const merged = (name) => process.env[name] || fileEnv[name]
const pick = (name, fallback) => merged(name) || fallback
const optionalEnv = (name) => (merged(name) ? { [name]: merged(name) } : {})

module.exports = {
  apps: [
    {
      name: 'integrated-kms-admin',
      cwd: __dirname,
      script: 'backend/.venv/bin/kms-admin-server',
      interpreter: 'none',
      env: {
        KMS_ADMIN_ENV: pick('KMS_ADMIN_ENV', 'development'),
        KMS_ADMIN_HOST: pick('KMS_ADMIN_HOST', '0.0.0.0'),
        KMS_ADMIN_LOG_BACKUP_DAYS: pick('KMS_ADMIN_LOG_BACKUP_DAYS', '30'),
        LIGHTRAG_BASE_URL: pick('LIGHTRAG_BASE_URL', 'http://127.0.0.1:9621'),
        ...optionalEnv('KMS_ADMIN_PORT'),
        ...optionalEnv('KMS_ADMIN_DATABASE_URL'),
        ...optionalEnv('KMS_ADMIN_JWT_SECRET'),
        ...optionalEnv('ADMIN_PASSWORD_PEPPER'),
        ...optionalEnv('KMS_ADMIN_API_KEY_PEPPER'),
        ...optionalEnv('ADMIN_BOOTSTRAP_ID'),
        ...optionalEnv('ADMIN_BOOTSTRAP_PASSWORD')
      },
      autorestart: true,
      max_restarts: 10,
      time: true,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log'
    }
  ]
}
