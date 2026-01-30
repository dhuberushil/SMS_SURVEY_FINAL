// Run the nudge worker logic once against the real DB (will send SMS via Twilio)
// Usage: node scripts/run_nudge_once.js
// Set DRY_RUN=1 in env for logging only

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { Op } = require('sequelize');
const questions = require('../src/config/questions');
const sms = require('../src/services/smsService');
const FormSubmission = require('../src/models/FormSubmission');
const logger = require('../src/logger');

(async function run() {
  try {
    logger.info('Running one-off nudge check (DRY_RUN=%s)', process.env.DRY_RUN || '0');

    // Stuck submissions (status STARTED, last_active > 24h)
    const checkTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuckSubs = await FormSubmission.findAll({
      where: { status: 'STARTED', last_active: { [Op.lt]: checkTime } },
    });
    logger.info('Found %d stuck submissions', stuckSubs.length);
    for (const sub of stuckSubs) {
      if ((sub.current_step || 0) < questions.length) {
        const currentQ = questions[sub.current_step || 0];
        const to = sub.mobile || sub.phone;
        const text = `Reminder: ${currentQ}`;
        logger.info('Would send to %s: %s', to, text);
        if (!process.env.DRY_RUN) await sms.sendSMS(to, text);
        await sub.update({ last_active: new Date() });
      }
    }

    // Step-B incomplete reminders
    const explicit = [];
    const r3 = parseInt(process.env.REMINDER_3DAYS, 10);
    const r7 = parseInt(process.env.REMINDER_7DAYS, 10);
    const r1m = parseInt(process.env.REMINDER_1MONTH, 10);
    const r2m = parseInt(process.env.REMINDER_2MONTHS, 10);
    if (!isNaN(r3)) explicit.push(r3);
    if (!isNaN(r7)) explicit.push(r7);
    if (!isNaN(r1m)) explicit.push(r1m);
    if (!isNaN(r2m)) explicit.push(r2m);

    let reminderDays = [];
    if (explicit.length > 0) {
      reminderDays = explicit.sort((a, b) => a - b);
    } else {
      const reminderDaysEnv = process.env.REMINDER_DAYS || '3,7,30,60';
      reminderDays = reminderDaysEnv
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b);
    }
    if (reminderDays.length === 0) {
      logger.info('No reminder days configured; skipping Step-B reminders.');
      return process.exit(0);
    }

    const now = Date.now();
    const pending = await FormSubmission.findAll({ where: { stepBCompleted: false } });
    logger.info('Found %d pending Step-B submissions', pending.length);

    for (const s of pending) {
      try {
        const issuedAt = s.stepBTokenIssuedAt
          ? new Date(s.stepBTokenIssuedAt)
          : new Date(s.createdAt);
        const elapsedDays = Math.floor((now - issuedAt.getTime()) / (24 * 3600 * 1000));
        const currentCount = parseInt(s.stepBNudgeCount || 0, 10);

        if (currentCount < reminderDays.length && elapsedDays >= reminderDays[currentCount]) {
          const token = s.stepBToken;
          const link = token
            ? `${process.env.FORM_BASE_URL || process.env.APP_URL || 'http://localhost:3000'}/stepb.html?token=${encodeURIComponent(token)}`
            : null;
          if (s.phone && link) {
            const text = `Reminder: please complete your remaining form here: ${link}`;
            logger.info('Would send to %s: %s', s.phone, text);
            if (!process.env.DRY_RUN) {
              await sms.sendSMS(s.phone, text);
              await s.update({ stepBNudgeCount: currentCount + 1, stepBLastNudgeAt: new Date() });
              logger.info('Sent and updated DB for %s', s.email || s.phone);
            }
          }
        }
      } catch (err) {
        logger.error(
          'Failed to process nudge for submission %s: %o',
          s.email,
          err && (err.message || err)
        );
      }
    }

    logger.info('Nudge run complete.');
    process.exit(0);
  } catch (err) {
    logger.error('run_nudge_once error: %o', err && (err.message || err));
    process.exit(1);
  }
})();
