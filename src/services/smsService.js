const twilio = require('twilio');
const logger = require('../logger');
require('dotenv').config();

if (
  !process.env.TWILIO_ACCOUNT_SID ||
  !process.env.TWILIO_AUTH_TOKEN ||
  !process.env.TWILIO_PHONE_NUMBER
) {
  logger.warn('Twilio environment variables are not all set. SMS will fail until configured.');
}

let client = null;
function getTwilioClient() {
  if (client) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  if (!sid || !token) return null;
  client = twilio(sid, token);
  return client;
}

const sendSMS = async (to, body) => {
  try {
    const hasCreds = !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    );
    logger.info('smsService.sendSMS attempt', {
      to,
      bodyLength: body ? body.length : 0,
      hasTwilioCreds: hasCreds,
    });
    if (!hasCreds) {
      logger.error(
        'Twilio credentials missing; skipping send. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER.'
      );
      return { success: false, error: 'twilio_not_configured' };
    }

    const clientInst = getTwilioClient();
    if (!clientInst) {
      logger.error('Failed to create Twilio client; invalid credentials.');
      return { success: false, error: 'twilio_client_error' };
    }

    const resp = await clientInst.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
    logger.info('smsService.sendSMS success', { to, sid: resp && resp.sid ? resp.sid : null });
    return { success: true, sid: resp && resp.sid };
  } catch (error) {
    // Optimization for Trial Account debugging
    if (error && error.code === 21608) {
      logger.error(
        `TRIAL ERROR: The number ${to} is not verified. On a Trial account, you can only send to verified Caller IDs.`
      );
    } else if (error && error.code === 21408) {
      logger.error(
        `PERMISSION ERROR: International permission not enabled for this region in Twilio Console.`
      );
    } else {
      logger.error('SMS Send Error: %o', error);
    }
    return { success: false, error };
  }
};

module.exports = { sendSMS };
