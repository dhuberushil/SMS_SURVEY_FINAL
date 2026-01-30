// One-off send script: node scripts/send_sms_now.js <phone> [<message>]
// Example: node scripts/send_sms_now.js 8261026023 "Custom message"

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const sms = require('../src/services/smsService');
const logger = require('../src/logger');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    logger.error('Usage: node scripts/send_sms_now.js <phone> [<message>]');
    process.exit(2);
  }
  const to = args[0];
  const msg =
    args[1] ||
    `Reminder: please complete your remaining form here: ${process.env.FORM_BASE_URL || process.env.APP_URL || 'http://localhost:3000'}/stepb.html`;
  logger.info('Sending to %s: %s', to, msg);
  try {
    await sms.sendSMS(to, msg);
    logger.info('Send attempt complete. Check logs for success/failure.');
  } catch (err) {
    logger.error('Send failed: %o', err && err.message ? err.message : err);
  }
}

main();
