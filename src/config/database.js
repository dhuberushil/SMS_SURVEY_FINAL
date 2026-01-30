const { Sequelize } = require('sequelize');
require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL || process.env.DB_URL || process.env.DATABASEURL;

let sequelize;
if (databaseUrl) {
  sequelize = new Sequelize(databaseUrl, {
    dialect: 'postgres',
    logging: false,
  });
} else {
  // Ensure password and other env vars are strings
  const dbName = process.env.DB_NAME || 'sms_survey';
  const dbUser = process.env.DB_USER || 'postgres';
  const dbPass = process.env.DB_PASS ? String(process.env.DB_PASS) : '';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;

  sequelize = new Sequelize(dbName, dbUser, dbPass, {
    host: dbHost,
    port: dbPort,
    dialect: 'postgres',
    logging: false,
  });
}

module.exports = sequelize;
