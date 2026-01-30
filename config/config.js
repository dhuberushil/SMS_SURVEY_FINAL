require('dotenv').config();

const dbUrl = process.env.DATABASE_URL || process.env.DB_URL || process.env.DATABASEURL || null;
const dbUrlEnvName = process.env.DATABASE_URL
  ? 'DATABASE_URL'
  : process.env.DB_URL
  ? 'DB_URL'
  : process.env.DATABASEURL
  ? 'DATABASEURL'
  : null;

const defaultConfig = {
  dialect: 'postgres',
  logging: false,
};

function connFromEnv() {
  // Use the actual env var name that contained the DB URL so sequelize-cli
  // doesn't attempt to parse an undefined variable.
  const envName = dbUrlEnvName || 'DATABASE_URL';
  return {
    use_env_variable: envName,
    ...defaultConfig,
  };
}

function connFromParts() {
  return {
    username: process.env.DB_USER || process.env.PGUSER || 'postgres',
    password: process.env.DB_PASS || process.env.PGPASSWORD || null,
    database: process.env.DB_NAME || process.env.PGDATABASE || 'sms_survey',
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    ...defaultConfig,
  };
}

module.exports = {
  development: dbUrl ? connFromEnv() : connFromParts(),
  test: dbUrl ? connFromEnv() : connFromParts(),
  production: dbUrl ? connFromEnv() : connFromParts(),
};
