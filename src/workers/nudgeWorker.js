const cron = require('node-cron');
const { Op } = require('sequelize');
const questions = require('../config/questions');
const sms = require('../services/smsService');
const FormSubmission = require('../models/FormSubmission');
const logger = require('../logger');

// Runs every hour
cron.schedule('0 * * * *', async () => {
  logger.info('Running nudge worker...');
  const checkTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stuckSubs = await FormSubmission.findAll({
    where: {
      status: 'STARTED',
      last_active: { [Op.lt]: checkTime },
    },
  });

  for (const sub of stuckSubs) {
    if ((sub.current_step || 0) < questions.length) {
      const currentQ = questions[sub.current_step || 0];
      try {
        await sms.sendSMS(sub.mobile || sub.phone, `Reminder: ${currentQ}`);
        await sub.update({ last_active: new Date() });
        logger.info(
          'Sent question nudge to %s (step=%d)',
          sub.mobile || sub.phone,
          sub.current_step || 0
        );
      } catch (error) {
        logger.error(
          `Failed to nudge ${sub.mobile || sub.phone}: %s`,
          error && (error.message || error)
        );
      }
    }
  }

  // Nudge Step B incomplete form submissions according to scheduled reminder days
  try {
    // Prefer explicit env vars if provided, otherwise fall back to REMINDER_DAYS
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
    if (reminderDays.length === 0) return;

    const now = Date.now();
    const pending = await FormSubmission.findAll({ where: { stepBCompleted: false } });

    for (const s of pending) {
      try {
        const issuedAt = s.stepBTokenIssuedAt
          ? new Date(s.stepBTokenIssuedAt)
          : new Date(s.createdAt);
        const elapsedDays = Math.floor((now - issuedAt.getTime()) / (24 * 3600 * 1000));
        const currentCount = parseInt(s.stepBNudgeCount || 0, 10);

        // If the next scheduled reminder threshold has passed, send one reminder.
        if (currentCount < reminderDays.length && elapsedDays >= reminderDays[currentCount]) {
          const token = s.stepBToken;
          const link = token
            ? `${process.env.FORM_BASE_URL || process.env.APP_URL || 'http://localhost:3000'}/stepb.html?token=${encodeURIComponent(token)}`
            : null;
          if (s.phone && link) {
            await sms.sendSMS(
              s.phone,
              `Reminder: please complete your remaining form here: ${link}`
            );
            await s.update({ stepBNudgeCount: currentCount + 1, stepBLastNudgeAt: new Date() });
            logger.info(
              'Sent Step-B reminder %d to %s (email=%s, elapsedDays=%d)',
              currentCount + 1,
              s.phone,
              s.email,
              elapsedDays
            );
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
  } catch (err) {
    logger.error('nudgeFormSubmissions error: %o', err && (err.message || err));
  }
});
