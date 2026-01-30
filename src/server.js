require('dotenv').config();
const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const sequelize = require('./config/database');
const FormSubmission = require('./models/FormSubmission');
const SubmissionHistory = require('./models/SubmissionHistory');
const questions = require('./config/questions');
const { sendSMS } = require('./services/smsService');
require('./workers/nudgeWorker'); // Starts the cron job

// Security & middleware
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const logger = require('./logger');
const CALENDLY_URL =
  process.env.CALENDLY_URL ||
  'https://calendly.com/admin-ethosh/doctor-appointment?text_color=9b31d6&primary_color=ff2da6';

const app = express();

// If running behind a proxy (ngrok, load-balancer), enable trust proxy
// Set TRUST_PROXY=false to keep default behavior when not behind a proxy.
if (process.env.TRUST_PROXY !== 'false') {
  app.set('trust proxy', 1);
  logger.info('Express trust proxy enabled');
}

// Basic middlewares
// Configure a Content Security Policy that allows:
// - images from same origin, data: and blob: (for local blob previews)
// - connect (fetch/XHR) to the configured S3 bucket host (signed PUT URLs)
// The S3 host is constructed from env vars when available so production
// signed URLs are permitted by CSP.
const s3Bucket = (process.env.S3_BUCKET || '').replace(/^\s*"?(.*?)"?\s*$/, '$1').trim();
const s3Region = (process.env.S3_REGION || '').trim();
let s3Host = null;
if (s3Bucket && s3Region) {
  s3Host = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`;
} else if (s3Bucket) {
  s3Host = `https://${s3Bucket}.s3.amazonaws.com`;
}

const cspDirectives = {
  defaultSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
};
if (s3Host) {
  cspDirectives.connectSrc.push(s3Host);
  // allow the common s3 host pattern too (covers buckets without region-style host)
  cspDirectives.connectSrc.push('https://*.s3.amazonaws.com');
}

app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives } }));
app.use(compression());
// CORS: dynamic allowlist managed in-memory; initialize from env but
// allow runtime updates via admin routes. If no origins configured, allow
// non-browser requests (no Origin) for server-to-server calls.
const corsList = require('./services/corsList');
const corsOptions = {
  origin: (origin, callback) => {
    // allow server-to-server or curl (no origin)
    if (!origin) return callback(null, true);
    const allowed = corsList.getAllowed();
    if (!allowed || allowed.length === 0) return callback(null, true);
    if (allowed.includes(origin)) return callback(null, true);
    return callback(new Error('CORS policy: origin not allowed'));
  },
  credentials: true,
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
};
app.use(cors(corsOptions));
// Increase JSON/urlencoded limits to allow inline base64 image submissions during testing.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Debugging middleware: log incoming request size and origin (helps diagnose 413 errors)
app.use((req, res, next) => {
  try {
    const cl = req.headers['content-length'] || '-';
    logger.info(
      `Incoming request: ${req.method} ${req.originalUrl} Content-Length=${cl} Host=${req.get('host')} Origin=${req.get('origin') || '-'} Referer=${req.get('referer') || '-'} IP=${req.ip}`
    );
  } catch (e) {
    // ignore logging errors
  }
  next();
});

// Logging
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Rate limiting
const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use(limiter);

// Log when Step B link is opened, then serve static files
app.get('/stepb.html', (req, res, next) => {
  try {
    const token = req.query.token || req.headers['x-stepb-token'] || null;
    logger.info('Step B link opened', {
      token,
      ip: req.ip,
      ua: req.get('user-agent'),
      time: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('Step B log error', e.message || e);
  }
  return next();
});

// Serve simple frontend
app.use(express.static(path.join(__dirname, 'public')));

// Lightweight health endpoint for quick checks (used by ngrok or uptime probes)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  });
});

// Mount form routes (Step B flow)
const formsRouter = require('./routes/forms');
app.use('/api/form', formsRouter);

// Admin routes (runtime CORS management)
try {
  const adminRouter = require('./routes/admin');
  app.use('/api/admin', adminRouter);
} catch (e) {
  logger.warn('Admin routes not available: %s', e && e.message);
}

// Serve a tiny inline SVG as favicon to avoid 404s (keeps it simple)
app.get('/favicon.ico', (req, res) => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <rect width="16" height="16" rx="3" ry="3" fill="#007bff"/>
    <text x="8" y="11" font-size="10" text-anchor="middle" fill="#fff">S</text>
  </svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send(svg);
});

// 1. WEB FORM SUBMISSION
app.post('/api/submit-form', async (req, res) => {
  try {
    const { name, mobile, phone, age, gender, address, country, postal_address, consent } =
      req.body;
    const primaryMobile = mobile || phone;
    if (!consent) return res.status(400).json({ success: false, message: 'Consent is required' });
    if (!primaryMobile)
      return res.status(400).json({ success: false, message: 'Mobile is required' });

    const defaults = {
      name,
      mobile: primaryMobile,
      phone: primaryMobile,
      age: age || null,
      gender: gender || null,
      address: address || null,
      country: country || null,
      postal_address: postal_address || null,
      status: 'STARTED',
      current_step: 0,
      last_active: new Date(),
    };

    // Create or update existing submission by mobile
    const [submission, created] = await FormSubmission.findOrCreate({
      where: { mobile: primaryMobile },
      defaults,
    });

    if (!created) {
      // Update existing record and restart survey state
      const before = submission.toJSON();
      await submission.update({ ...defaults });
      try {
        const SubmissionHistory = require('./models/SubmissionHistory');
        await SubmissionHistory.create({
          submissionId: submission.id,
          changeType: 'web-submit-update',
          data: { before, after: submission.toJSON() },
        });
      } catch (e) {
        logger.warn('history web-submit-update failed: %s', e && e.message);
      }
    } else {
      try {
        const SubmissionHistory = require('./models/SubmissionHistory');
        await SubmissionHistory.create({
          submissionId: submission.id,
          changeType: 'web-submit-create',
          data: { defaults },
        });
      } catch (e) {
        logger.warn('history web-submit-create failed: %s', e && e.message);
      }
    }

    // Send First Question (fire-and-forget — do not crash the API if SMS fails)
    try {
      await sendSMS(primaryMobile, `Hi ${name || 'Participant'}! ${questions[0]}`);
    } catch (smsErr) {
      logger.error('SMS send failed: %o', smsErr);
    }

    res.json({
      success: true,
      created,
      message: created ? 'Survey initiated' : 'Survey restarted',
    });
  } catch (err) {
    logger.error('Submit Error: %o', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. TWILIO SMS WEBHOOK
const { Op } = require('sequelize');

async function handleSmsWebhook(req, res) {
  try {
    // Debug logging to verify Twilio/ngrok reach this endpoint
    logger.debug('SMS webhook request headers: %o', { headers: req.headers });
    logger.debug('SMS webhook request body: %o', { body: req.body });

    const from = (req.body.From || '').toString(); // Twilio sends E.164 (e.g., +1234567890)
    const body = (req.body.Body || '').toString().trim();

    if (!from) {
      logger.warn('SMS webhook: empty From');
      return res.type('text/xml').send('<Response></Response>');
    }

    // OPTIMIZATION: Match EXACT mobile number (E.164).
    // Previous logic (last 10 digits) causes issues with international numbers of varying lengths.
    const submission = await FormSubmission.findOne({
      where: {
        [Op.or]: [{ mobile: from }, { phone: from }],
        status: 'STARTED',
      },
    });
    if (!submission) {
      logger.warn('SMS webhook: no matching submission for %s', from);
      return res.type('text/xml').send('<Response></Response>');
    }

    const step = submission.current_step || 0;

    // Save answer into JSON `answers` instead of dynamic columns
    const existing = submission.answers || {};
    existing[`q${step}_answer`] = body;
    await submission.update({ answers: existing, last_active: new Date() });
    try {
      await SubmissionHistory.create({
        submissionId: submission.id,
        changeType: 'sms-answer',
        data: { step, body },
      });
    } catch (e) {
      logger.warn('history sms-answer failed: %s', e && e.message);
    }

    const nextStep = step + 1;

    if (nextStep < questions.length) {
      await sendSMS(submission.mobile || submission.phone, questions[nextStep]);
      await submission.update({ current_step: nextStep });
      try {
        await SubmissionHistory.create({
          submissionId: submission.id,
          changeType: 'sms-nudge',
          data: { nextStep },
        });
      } catch (e) {
        logger.warn('history sms-nudge failed: %s', e && e.message);
      }
    } else {
      const finalMsg = `Thank you! You have completed the survey.\n\nSchedule an appointment: ${CALENDLY_URL}`;
      await sendSMS(submission.mobile || submission.phone, finalMsg);
      await submission.update({ status: 'COMPLETED' });
      try {
        await SubmissionHistory.create({
          submissionId: submission.id,
          changeType: 'sms-complete',
          data: {},
        });
      } catch (e) {
        logger.warn('history sms-complete failed: %s', e && e.message);
      }
    }

    // Respond with empty TwiML to acknowledge delivery
    return res.type('text/xml').send('<Response></Response>');
  } catch (err) {
    logger.error('SMS webhook error: %o', err);
    return res.type('text/xml').send('<Response></Response>');
  }
}

app.post('/api/sms-webhook', handleSmsWebhook);
// Alias route common in Twilio examples (so you can point Twilio to /sms)
app.post('/sms', handleSmsWebhook);

// 3. EXCEL EXPORT
app.get('/api/export', async (req, res) => {
  const subs = await FormSubmission.findAll();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Survey Results');

  const columns = [
    { header: 'id', key: 'id' },
    { header: 'fullName', key: 'fullName' },
    { header: 'email', key: 'email' },
    { header: 'mobile', key: 'mobile' },
    { header: 'timezone', key: 'timezone' },
    { header: 'status', key: 'status' },
    { header: 'current_step', key: 'current_step' },
    { header: 'last_active', key: 'last_active' },
    { header: 'height_cm', key: 'height' },
    { header: 'weight_kg', key: 'weight' },
    { header: 'bmi', key: 'bmi' },
  ];

  // Add question columns dynamically (pulled from answers JSON)
  questions.forEach((q, i) => columns.push({ header: q, key: `q${i}_answer` }));
  columns.push({ header: 'Status', key: 'status' });

  sheet.columns = columns;

  subs.forEach((u) => {
    const pub = typeof u.toPublic === 'function' ? u.toPublic() : u.toJSON ? u.toJSON() : {};
    const answers = pub.answers || {};
    // attach question answers as q{n}_answer
    questions.forEach((_, i) => {
      pub[`q${i}_answer`] = answers[`q${i}_answer`] || null;
    });
    sheet.addRow(pub);
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename=results.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

// Sync DB and Start Server
// Respect CLI `--port` or `-p` flags (e.g. `node src/server.js --port 3001`),
// otherwise fall back to `PORT` env var or 3000.
const argvPort = (() => {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') {
      const v = argv[i + 1];
      if (v) return parseInt(v, 10);
    } else if (a.startsWith('--port=')) {
      const parts = a.split('=');
      if (parts[1]) return parseInt(parts[1], 10);
    }
  }
  return null;
})();
const envPort = parseInt(process.env.PORT, 10);
const PORT = argvPort || (!isNaN(envPort) ? envPort : 3000);

// Authenticate DB connection, then sync models and start server.
// NOTE: `sequelize.sync()` is used here for convenience. For production use,
// consider using proper migrations instead of `sync()` to manage schema changes.
(async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection authenticated');
    // Safe DB startup:
    // - In production, avoid using `sequelize.sync({ alter: true })` because it
    //   can alter production schemas unexpectedly. Require explicit migrations.
    // - In non-production environments, `sync({ alter: true })` is convenient
    //   for bootstrapping and local development.
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        'Production environment detected: skipping sequelize.sync({ alter: true }). Run migrations via `npm run migrate` instead.'
      );
    } else {
      await sequelize.sync({ alter: true });
      logger.info('Database synchronized (tables created/updated as needed)');
    }

    const server = app.listen(PORT, () => logger.info('Server running on port %s', PORT));

    // Graceful shutdown
    const shutdown = (signal) => {
      logger.info('Received %s - closing server...', signal);
      server.close(() => {
        logger.info('HTTP server closed.');
        sequelize.close().then(() => {
          logger.info('DB connection closed. Exiting.');
          process.exit(0);
        });
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to initialize database or start server:', err && (err.message || err));
    process.exit(1);
  }
})();
