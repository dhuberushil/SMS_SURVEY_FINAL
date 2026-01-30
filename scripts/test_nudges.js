// Dry-run script: simulate reminder messages without sending SMS
// Run with: node scripts/test_nudges.js

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const questions = require('../src/config/questions');
const logger = require('../src/logger');

function getReminderDays() {
  const explicit = [];
  const r3 = parseInt(process.env.REMINDER_3DAYS, 10);
  const r7 = parseInt(process.env.REMINDER_7DAYS, 10);
  const r1m = parseInt(process.env.REMINDER_1MONTH, 10);
  const r2m = parseInt(process.env.REMINDER_2MONTHS, 10);
  if (!isNaN(r3)) explicit.push(r3);
  if (!isNaN(r7)) explicit.push(r7);
  if (!isNaN(r1m)) explicit.push(r1m);
  if (!isNaN(r2m)) explicit.push(r2m);

  if (explicit.length > 0) return explicit.sort((a, b) => a - b);
  const reminderDaysEnv = process.env.REMINDER_DAYS || '3,7,30,60';
  return reminderDaysEnv
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
}

function formatStuckMessage(sub) {
  const idx = sub.current_step || 0;
  const currentQ = questions[idx] || '(unknown question)';
  return `To: ${sub.mobile || sub.phone} | Message: Reminder: ${currentQ}`;
}

function formatStepBMessage(sub) {
  const now = Date.now();
  const issuedAt = sub.stepBTokenIssuedAt
    ? new Date(sub.stepBTokenIssuedAt)
    : sub.createdAt
      ? new Date(sub.createdAt)
      : new Date();
  const elapsedDays = Math.floor((now - issuedAt.getTime()) / (24 * 3600 * 1000));
  const currentCount = parseInt(sub.stepBNudgeCount || 0, 10);
  const reminderDays = getReminderDays();
  const due = currentCount < reminderDays.length && elapsedDays >= reminderDays[currentCount];
  const token = sub.stepBToken;
  const link = token
    ? `${process.env.FORM_BASE_URL || process.env.APP_URL || 'http://localhost:3000'}/stepb.html?token=${encodeURIComponent(token)}`
    : null;
  const message = link
    ? `Reminder: please complete your remaining form here: ${link}`
    : 'Reminder: please complete your form.';
  return {
    to: sub.phone || sub.mobile,
    elapsedDays,
    currentCount,
    nextThreshold: reminderDays[currentCount],
    due,
    text: message,
  };
}

// Sample entries to exercise both flows
const stuckSample = { current_step: 1, mobile: '+15550001001' };
const stepBDueSample = {
  stepBToken: 'tok-abc-123',
  stepBTokenIssuedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
  stepBNudgeCount: 0,
  phone: '+15550001002',
  email: 'user@example.com',
  createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
};
const stepBNotDueSample = {
  stepBToken: 'tok-xyz-999',
  stepBTokenIssuedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
  stepBNudgeCount: 0,
  phone: '+15550001003',
  email: 'other@example.com',
  createdAt: new Date().toISOString(),
};

logger.info('Parsed reminder days: %s', getReminderDays().join(','));

logger.info('-- Stuck-submission nudge (simulation) --');
logger.info(formatStuckMessage(stuckSample));

logger.info('-- Step-B scheduled reminders (simulation) --');
[stepBDueSample, stepBNotDueSample].forEach((s) => {
  const r = formatStepBMessage(s);
  logger.info(
    'To: %s | elapsedDays=%d | stepBNudgeCount=%d | nextThreshold=%s | due=%s',
    r.to,
    r.elapsedDays,
    r.currentCount,
    r.nextThreshold,
    r.due
  );
  logger.info('Message: %s', r.text);
});

logger.info('Dry-run complete. No SMS sent.');
