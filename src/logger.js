const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';
const logDir = path.resolve(process.cwd(), 'logs');
try {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
} catch (e) {
  /* ignore */
}

const consoleFormat = isProd
  ? format.combine(format.timestamp(), format.errors({ stack: true }), format.json())
  : format.combine(
      format.colorize({ all: true }),
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.printf((info) => {
        const { timestamp, level, message, ...meta } = info;
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 0) : '';
        return `${timestamp} ${level}: ${typeof message === 'object' ? JSON.stringify(message) : message} ${metaStr}`;
      })
    );

const logger = createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: format.combine(format.errors({ stack: true }), format.splat()),
});

// Console transport (pretty in dev, json in prod)
logger.add(new transports.Console({ format: consoleFormat, stderrLevels: ['error'] }));

// File transport for persistent logs (use JSON format to avoid 'undefined' lines)
if (process.env.LOG_TO_FILE !== 'false') {
  logger.add(
    new transports.File({
      filename: path.join(logDir, 'app.log'),
      level: process.env.LOG_FILE_LEVEL || 'info',
      maxsize: 10 * 1024 * 1024,
      format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
    })
  );
}

// Daily cleanup: remove log files older than 7 days to limit disk growth.
try {
  const cron = require('node-cron');
  cron.schedule(
    '0 0 * * *',
    async () => {
      try {
        const files = await fs.promises.readdir(logDir);
        const now = Date.now();
        const cutoff = 7 * 24 * 60 * 60 * 1000; // 7 days
        for (const f of files) {
          const full = path.join(logDir, f);
          try {
            const st = await fs.promises.stat(full);
            if (st.isFile() && now - st.mtimeMs > cutoff) {
              await fs.promises.unlink(full);
              logger.info('Deleted old log file: %s', full);
            }
          } catch (e) {
            // don't crash on individual file errors
            logger.warn('Log cleanup error for %s: %s', full, e && e.message);
          }
        }
      } catch (e) {
        logger.warn('Log cleanup directory read failed: %s', e && e.message);
      }
    },
    { scheduled: true }
  );
} catch (e) {
  logger.warn('Failed to schedule log cleanup: %s', e && e.message);
}

module.exports = logger;
