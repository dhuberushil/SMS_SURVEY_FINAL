const express = require('express');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const FormSubmission = require('../models/FormSubmission');
const SubmissionHistory = require('../models/SubmissionHistory');
const { generatePresignedUrls, deleteObjects } = require('../services/s3');
const { sendSMS } = require('../services/smsService');
require('dotenv').config();

const router = express.Router();
const logger = require('../logger');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-token-secret';
const FORM_BASE_URL = process.env.FORM_BASE_URL || process.env.APP_URL || 'http://localhost:3000';
const CALENDLY_URL =
  process.env.CALENDLY_URL ||
  'https://calendly.com/admin-ethosh/doctor-appointment?text_color=9b31d6&primary_color=ff2da6';

function verifyTokenMiddleware(req, res, next) {
  const token =
    (req.body && req.body.token) ||
    (req.query && req.query.token) ||
    req.headers['x-stepb-token'] ||
    (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) {
    logger.warn('verifyToken: missing token (req path=%s ip=%s)', req.originalUrl, req.ip);
    return res.status(401).json({ success: false, error: 'missing token' });
  }

  try {
    logger.debug('verifyToken: attempting verify token (prefix=%s)', token && token.slice ? token.slice(0, 8) : '[none]');
    const decoded = jwt.verify(token, TOKEN_SECRET);
    if (!decoded || !decoded.email) {
      logger.warn(
        'verifyToken: token decoded but missing email (token=%s)',
        token && token.slice ? token.slice(0, 8) : '[redacted]'
      );
      return res.status(401).json({ success: false, error: 'invalid token' });
    }
    req.stepb = { token, email: decoded.email };
    return next();
  } catch (err) {
    logger.warn('verifyToken: token verification failed: %s', err && err.message);
    logger.debug('verifyToken error stack: %s', err && err.stack);
    return res.status(401).json({ success: false, error: 'invalid or expired token' });
  }
}

// Initial submit: called after Step A to generate token and send SMS with Step B link
router.post('/initial-submit', async (req, res) => {
  try {
    logger.info('initial-submit payload', {
      ip: req.ip,
      host: req.get && req.get('host'),
      body: req.body && { email: req.body.email, phone: req.body.phone || req.body.mobile },
    });
    let { email, firstName, lastName, phone, mobile, name } = req.body;
    // Accept either `phone` or `mobile` from the client (form uses `mobile` hidden input)
    phone = phone || mobile;
    if (!email || !phone) {
      const missing = [];
      if (!email) missing.push('email');
      if (!phone) missing.push('phone');
      return res
        .status(400)
        .json({ success: false, error: `${missing.join(' and ')} are required` });
    }

    // Require explicit consent (must be truthy)
    const consent = req.body.consent;
    if (!consent) {
      return res.status(400).json({ success: false, error: 'consent is required' });
    }

    // Require explicit first and last name from the initial form
    if (!firstName || !lastName) {
      return res.status(400).json({ success: false, error: 'firstName and lastName are required' });
    }

    const token = jwt.sign({ email }, TOKEN_SECRET, { expiresIn: '7d' });
    const issuedAt = new Date();
    // Prefer to find an existing submission by email OR mobile (phone) to avoid duplicate records
    const whereClause = { [Op.or]: [] };
    if (email) whereClause[Op.or].push({ email });
    if (phone) whereClause[Op.or].push({ mobile: phone });

    let submission = null;
    let created = false;
    let before = undefined;
    if (whereClause[Op.or].length > 0) {
      submission = await FormSubmission.findOne({ where: whereClause });
    }
    if (!submission) {
      // store full name in `name` column per new requirements
      const fullName =
        firstName || name || ''
          ? ((firstName || '') + (lastName ? ' ' + lastName : '')).trim()
          : name || null;
      submission = await FormSubmission.create({
        email,
        firstName,
        lastName,
        name: fullName,
        phone,
        mobile: phone || null,
        stepBToken: token,
        stepBTokenIssuedAt: issuedAt,
        stepBCompleted: false,
        stepBNudgeCount: 0,
      });
      created = true;
      // record history
      try {
        await SubmissionHistory.create({
          submissionId: submission.id,
          changeType: 'initial-create',
          data: { email, firstName, lastName, phone },
        });
      } catch (e) {
        logger.warn('history create failed: %s', e && e.message);
      }
    } else {
      // update contact info and token; keep `name` as full name
      before = submission.toJSON();
      const fullName =
        firstName || name || ''
          ? ((firstName || '') + (lastName ? ' ' + lastName : '')).trim()
          : name || submission.name || null;
      await submission.update({
        email,
        firstName,
        lastName,
        name: fullName,
        phone,
        mobile: phone || submission.mobile,
        stepBToken: token,
        stepBTokenIssuedAt: issuedAt,
        stepBCompleted: false,
      });
      try {
        await SubmissionHistory.create({
          submissionId: submission.id,
          changeType: 'initial-update',
          data: { before, after: submission.toJSON() },
        });
      } catch (e) {
        logger.warn('history update failed: %s', e && e.message);
      }
    }

    // Prefer configured FORM_BASE_URL; if not set or running in dev, build link from incoming request
    const reqBase =
      req && req.protocol && req.get && req.get('host')
        ? `${req.protocol}://${req.get('host')}`
        : FORM_BASE_URL;
    const baseForLink =
      process.env.FORM_BASE_URL && process.env.FORM_BASE_URL.length > 0
        ? process.env.FORM_BASE_URL
        : reqBase || FORM_BASE_URL;
    const link = `${baseForLink}/stepb.html?token=${encodeURIComponent(token)}`;
    const displayName = (firstName || name || '').toString().trim();
    const message = `Thanks for filling out the initial form, ${displayName}.

  To check whether your health insurance covers the Lap‑Band procedure, please upload a photo of the FRONT and BACK of your insurance card (screenshots are fine) and provide a bit more information at the link below:

  ${link}

  Thanks!`;
    try {
      await sendSMS(phone, message);
    } catch (err) {
      logger.error('SMS error: %o', err);
    }

    // Prepare user-facing note: show if this was a create or update and last 4 digits
    const last4 = phone ? phone.toString().replace(/\D+/g, '').slice(-4) : null;
    let note = null;
    if (created) {
      note = `New registration created for email ${email} and phone ending ${last4 || '****'}.`;
    } else {
      // `before` exists when updating an existing submission (see update branch)
      if (typeof before !== 'undefined' && before && before.email && before.email !== email) {
        note = `This number was already registered to ${before.email}; updated to ${email}.`;
      } else if (
        typeof before !== 'undefined' &&
        before &&
        before.mobile &&
        before.mobile !== (phone || submission.mobile)
      ) {
        note = `This email was previously registered with ${before.mobile}; updated to ${phone || submission.mobile}.`;
      } else {
        note = `Updated registration for ${email} and phone ending ${last4 || '****'}.`;
      }
    }

    return res.json({
      success: true,
      message: 'Step B link sent',
      created,
      note,
      phoneLast4: last4,
    });
  } catch (err) {
    logger.error('initial-submit error: %o', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// New: robust registration endpoint with duplicate detection and confirm-update flow
// POST /api/form/register
router.post('/register', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const SubmissionHistory = require('../models/SubmissionHistory');

    const raw = req.body || {};
    // Basic validation
    const name = (raw.name || '').toString().trim();
    const firstName = (raw.firstName || '').toString().trim();
    const lastName = (raw.lastName || '').toString().trim();
    const emailRaw = (raw.email || '').toString();
    const phoneRaw = (raw.phone || raw.mobile || '').toString();
    const confirmUpdate = raw.confirmUpdate === true || raw.confirmUpdate === 'true';
    const restartSurvey = raw.restartSurvey === true || raw.restartSurvey === 'true';
    const idempotencyKey = raw.idempotencyKey || null;

    // Normalize helpers
    const normalizeEmail = (e) => (e || '').toString().trim().toLowerCase() || null;
    const normalizePhone = (p) => {
      if (!p) return null;
      const digits = p.toString().replace(/\D+/g, '');
      if (!digits) return null;
      return digits.indexOf('+') === 0 ? digits : ('+' + digits).replace(/\+\+/, '+');
    };

    const email = normalizeEmail(emailRaw);
    const phone = normalizePhone(phoneRaw);

    if (!name && (!firstName || !lastName))
      return res
        .status(400)
        .json({ status: 'error', message: 'name or firstName+lastName required' });
    if (!email) return res.status(400).json({ status: 'error', message: 'email required' });
    if (!phone) return res.status(400).json({ status: 'error', message: 'phone required' });

    // Idempotency: return previous response if same key already processed
    if (idempotencyKey) {
      const prev = await SubmissionHistory.findOne({
        where: { changeType: 'idempotency' },
        transaction: t,
      });
      if (prev && prev.data && prev.data.idempotencyKey === idempotencyKey && prev.data.response) {
        await t.rollback();
        return res.json(prev.data.response);
      }
    }

    // Prefer matching by phone first (highest priority)
    const phoneMatches = await FormSubmission.findAll({
      where: { [Op.or]: [{ mobile: phone }, { phone }] },
      transaction: t,
    });
    if (phoneMatches && phoneMatches.length > 1) {
      await t.rollback();
      return res.status(409).json({
        status: 'conflict',
        message: 'multiple records found for phone',
        matches: phoneMatches.map((s) => s.id),
      });
    }
    let existing = phoneMatches && phoneMatches.length === 1 ? phoneMatches[0] : null;

    // If no phone match, try email
    if (!existing) {
      const emailMatches = await FormSubmission.findAll({ where: { email }, transaction: t });
      if (emailMatches && emailMatches.length > 1) {
        await t.rollback();
        return res.status(409).json({
          status: 'conflict',
          message: 'multiple records found for email',
          matches: emailMatches.map((s) => s.id),
        });
      }
      existing = emailMatches && emailMatches.length === 1 ? emailMatches[0] : null;
    }

    // If user exists and frontend hasn't confirmed update, return exists response
    if (existing && !confirmUpdate) {
      await t.rollback();
      const note =
        existing.mobile && existing.mobile !== phone
          ? `This email is registered with ${existing.mobile.replace(/\D+/g, '').slice(-4).padStart(4, '*')}`
          : existing.email && existing.email !== email
            ? `This phone is registered to ${existing.email}`
            : 'User already exists';
      // return minimal identifying info and include suggestion to prompt restart of survey
      return res.json({
        status: 'exists',
        message: 'User already exists. Do you want to update your information?',
        existingUserId: existing.id,
        note,
        phoneLast4:
          existing.mobile || existing.phone
            ? (existing.mobile || existing.phone).toString().replace(/\D+/g, '').slice(-4)
            : null,
        // hint for frontend: ask user whether to restart survey
        promptRestartSurvey: true,
        currentSurveyStatus: { status: existing.status, current_step: existing.current_step || 0 },
      });
    }

    // Proceed to create or update inside transaction
    if (!existing) {
      // Create new
      const toCreate = {
        name: name || `${firstName} ${lastName}`.trim(),
        firstName: firstName || null,
        lastName: lastName || null,
        email,
        phone: phone,
        mobile: phone,
        status: 'STARTED',
        last_active: new Date(),
      };
      const created = await FormSubmission.create(toCreate, { transaction: t });

      // Generate Step-B token and persist it on the newly created record
      try {
        const token = jwt.sign({ email }, TOKEN_SECRET, { expiresIn: '7d' });
        await created.update(
          {
            stepBToken: token,
            stepBTokenIssuedAt: new Date(),
            stepBCompleted: false,
            stepBNudgeCount: 0,
          },
          { transaction: t }
        );
        // store idempotency record if key provided
        const response = {
          status: 'created',
          message: 'User created',
          id: created.id,
          phoneLast4: phone ? phone.replace(/\D+/g, '').slice(-4) : null,
        };
        if (idempotencyKey)
          await SubmissionHistory.create(
            {
              submissionId: created.id,
              changeType: 'idempotency',
              data: { idempotencyKey, response },
            },
            { transaction: t }
          );
        await SubmissionHistory.create(
          {
            submissionId: created.id,
            changeType: 'web-register-create',
            data: { payload: toCreate },
          },
          { transaction: t }
        );
        await t.commit();

        // Send Step-B link via SMS outside the transaction to avoid blocking
        try {
          const link = `${FORM_BASE_URL}/stepb.html?token=${encodeURIComponent(token)}`;
          logger.info('register: sending post-create StepB SMS', {
            phone,
            token: token && token.slice ? token.slice(0, 8) : null,
          });
          if (phone)
            await sendSMS(
              phone,
              `Thanks for registering. Please complete the rest of your form here: ${link}`
            );
        } catch (smsErr) {
          logger.error('register: post-create SMS error: %o', smsErr);
        }

        return res.json(response);
      } catch (innerErr) {
        // If token generation or update failed, rollback and surface error
        try {
          await t.rollback();
        } catch (e) {
          logger.warn('Transaction rollback failed: %s', e && e.message);
        }
        logger.error('register create token/update error: %o', innerErr);
        return res.status(500).json({ status: 'error', message: innerErr.message });
      }
    }

    // existing found and confirmUpdate === true -> update changed fields only
    const before = existing.toJSON();
    const updates = {};
    const setIfChanged = (field, value) => {
      if (value === undefined || value === null) return;
      const cur = before[field];
      if (value !== '' && String(value) !== String(cur)) updates[field] = value;
    };

    setIfChanged('name', name || `${firstName} ${lastName}`.trim());
    setIfChanged('firstName', firstName || null);
    setIfChanged('lastName', lastName || null);
    setIfChanged('email', email || null);
    setIfChanged('mobile', phone || null);
    setIfChanged('phone', phone || null);

    // If caller asked to restart the SMS survey, reset runtime fields
    if (restartSurvey) {
      updates.status = 'STARTED';
      updates.current_step = 0;
      updates.last_active = new Date();
      // Optionally clear previous answers so survey starts fresh
      updates.answers = {};
    }

    if (Object.keys(updates).length === 0) {
      await t.rollback();
      return res.json({
        status: 'updated',
        message: 'No changes detected',
        existingUserId: existing.id,
      });
    }

    updates.last_active = new Date();
    await existing.update(updates, { transaction: t });
    await SubmissionHistory.create(
      {
        submissionId: existing.id,
        changeType: 'web-register-update',
        data: { before, after: existing.toJSON(), changed: Object.keys(updates) },
      },
      { transaction: t }
    );

    const response = {
      status: 'updated',
      message: 'User updated',
      existingUserId: existing.id,
      changed: Object.keys(updates),
      phoneLast4:
        existing.mobile || existing.phone
          ? (existing.mobile || existing.phone).toString().replace(/\D+/g, '').slice(-4)
          : null,
      restartApplied: !!restartSurvey,
    };
    if (idempotencyKey)
      await SubmissionHistory.create(
        {
          submissionId: existing.id,
          changeType: 'idempotency',
          data: { idempotencyKey, response },
        },
        { transaction: t }
      );

    await t.commit();

    // After committing updates, send a new Step-B link if contact changed
    try {
      const changedContact = updates.mobile || updates.phone || updates.email;
      if (changedContact) {
        const token = jwt.sign({ email }, TOKEN_SECRET, { expiresIn: '7d' });
        try {
          await existing.update(
            { stepBToken: token, stepBTokenIssuedAt: new Date(), stepBCompleted: false },
            { transaction: null }
          );
        } catch (uErr) {
          logger.warn('register: failed to persist token after update: %s', uErr && uErr.message);
        }
        const link = `${FORM_BASE_URL}/stepb.html?token=${encodeURIComponent(token)}`;
        logger.info('register: sending post-update StepB SMS', {
          phone,
          token: token && token.slice ? token.slice(0, 8) : null,
          changed: Object.keys(updates),
        });
        if (phone)
          await sendSMS(phone, `Your details were updated. Complete your form here: ${link}`);
      }
    } catch (smsErr) {
      logger.error('register: post-update SMS error: %o', smsErr);
    }

    return res.json(response);
  } catch (err) {
    try {
      await t.rollback();
    } catch (e) {
      logger.warn('Transaction rollback failed (final error handler): %s', e && e.message);
    }
    logger.error('register endpoint error: %o', err && (err.stack || err.message));
    return res.status(500).json({ status: 'error', message: err && err.message ? err.message : 'Internal Server Error' });
  }
});

// Presign endpoints for direct S3 uploads
router.post('/presign', verifyTokenMiddleware, async (req, res) => {
  try {
    const { files } = req.body; // expecting [{ name, contentType }]
    if (!Array.isArray(files) || files.length === 0)
      return res.status(400).json({ success: false, error: 'files required' });
    const results = await generatePresignedUrls(req.stepb.email, files);
    // return under `presigned` key so frontend can use `.presigned` consistently
    return res.json({ success: true, presigned: results });
  } catch (err) {
    logger.error('presign error: %o', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Final submit: accept Step B data and image keys (presigned flow)
router.post('/submit', verifyTokenMiddleware, async (req, res) => {
  try {
    const email = req.stepb.email;
    logger.info('[/api/form/submit] incoming headers', {
      'content-length': req.headers['content-length'],
      host: req.get && req.get('host'),
      referer: req.get && req.get('referer'),
    });
    const payload = req.body || {};
    const imageObjects = payload.imageObjects || [];

    const submission = await FormSubmission.findOne({ where: { email } });
    if (!submission) return res.status(404).json({ success: false, error: 'submission not found' });

    // Delete old images if present and different
    const oldKeys = (submission.imageObjects || []).map((i) => i.key).filter(Boolean);
    const newKeys = imageObjects.map((i) => i.key).filter(Boolean);
    const toDelete = oldKeys.filter((k) => !newKeys.includes(k));
    if (toDelete.length > 0) {
      try {
        await deleteObjects(toDelete);
      } catch (err) {
        logger.error('deleteObjects error: %o', err);
      }
    }

    // Calculate BMI server-side if height/weight present (supports feet/inches & lbs, or cm & kg)
    const updates = { ...payload, stepBCompleted: true, stepBCompletedAt: new Date() };

    try {
      // Determine weight in lbs
      let weightLbs = null;
      if (payload.weightLbs) weightLbs = Number(payload.weightLbs);
      else if (payload.weight_lbs) weightLbs = Number(payload.weight_lbs);
      else if (payload.weightKg) weightLbs = Number(payload.weightKg) * 2.2046226218;
      else if (payload.weight_kg) weightLbs = Number(payload.weight_kg) * 2.2046226218;
      else if (submission.weightLbs) weightLbs = Number(submission.weightLbs);

      // Determine height in inches
      let totalInches = null;
      if (payload.heightFeet != null || payload.heightInches != null) {
        const hf = Number(payload.heightFeet || 0);
        const hi = Number(payload.heightInches || 0);
        totalInches = hf * 12 + hi;
      } else if (payload.height_cm || payload.heightCm) {
        const cm = Number(payload.height_cm || payload.heightCm);
        if (!isNaN(cm) && cm > 0) totalInches = cm / 2.54;
      } else if (submission.heightFeet != null || submission.heightInches != null) {
        const hf = Number(submission.heightFeet || 0);
        const hi = Number(submission.heightInches || 0);
        totalInches = hf * 12 + hi;
      }

      if (weightLbs && totalInches && totalInches > 0) {
        const bmi = (weightLbs / (totalInches * totalInches)) * 703;
        updates.bmi = Math.round(bmi * 100) / 100; // round to 2 decimals
        // also persist normalized weight/height fields
        updates.weightLbs = Math.round(weightLbs * 100) / 100;
        if (totalInches) {
          updates.heightFeet = Math.floor(totalInches / 12);
          updates.heightInches = Math.round(totalInches % 12);
        }
      }
    } catch (e) {
      logger.warn('BMI calculation skipped due to invalid inputs: %s', e && e.message);
    }

    await submission.update(updates);
    try {
      await SubmissionHistory.create({
        submissionId: submission.id,
        changeType: 'stepb-submit',
        data: { payload: updates },
      });
    } catch (e) {
      logger.warn('history stepb-submit failed: %s', e && e.message);
    }

    // Send post-submission SMS (include Calendly scheduling link)
    if (submission.phone) {
      try {
        const postSubmitMsg = `Thanks — we received your information. We will contact you with next steps.\n\nSchedule an appointment: ${CALENDLY_URL}`;
        await sendSMS(submission.phone, postSubmitMsg);
      } catch (err) {
        logger.error('post-submit SMS error: %o', err);
      }
    }

    return res.json({ success: true, message: 'Submission saved' });
  } catch (err) {
    logger.error('submit error: %o', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Resend StepB link (rate-limited by DB field)
router.post('/resend-stepb', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'email required' });
    const submission = await FormSubmission.findOne({ where: { email } });
    if (!submission) return res.status(404).json({ success: false, error: 'not found' });

    const max = parseInt(process.env.MAX_NUDGES || '3', 10);
    if ((submission.stepBNudgeCount || 0) >= max)
      return res.status(429).json({ success: false, error: 'max resends reached' });

    const token = jwt.sign({ email }, TOKEN_SECRET, { expiresIn: '7d' });
    await submission.update({
      stepBToken: token,
      stepBTokenIssuedAt: new Date(),
      stepBNudgeCount: (submission.stepBNudgeCount || 0) + 1,
      stepBLastNudgeAt: new Date(),
    });

    const link = `${FORM_BASE_URL}/stepb.html?token=${encodeURIComponent(token)}`;
    if (submission.phone) await sendSMS(submission.phone, `Reminder: complete your form ${link}`);

    return res.json({ success: true, message: 'Resent' });
  } catch (err) {
    logger.error('resend-stepb error: %o', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Status check by token
router.get('/status', verifyTokenMiddleware, async (req, res) => {
  try {
    const email = req.stepb && req.stepb.email;
    logger.debug('/status: checking submission status for %s', email);
    const submission = await FormSubmission.findOne({ where: { email } });
    logger.debug('/status: found submission: %o', submission ? submission.toJSON() : null);
    if (!submission) return res.status(404).json({ success: false, error: 'not found' });
    return res.json({
      success: true,
      stepBCompleted: submission.stepBCompleted,
      stepBNudgeCount: submission.stepBNudgeCount || 0,
    });
  } catch (err) {
    logger.error('status error: %o', err && (err.stack || err.message));
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
