const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// In-memory allowlist. Initialized from CORS_ORIGINS or FORM_BASE_URL env var.
const raw = process.env.CORS_ORIGINS || process.env.FORM_BASE_URL || '';
const initial = raw
  .toString()
  .split(',')
  .map((s) => (s || '').trim())
  .filter(Boolean);

// Optional persistence: set CORS_PERSIST=true and optionally CORS_PERSIST_PATH
const persist = String(process.env.CORS_PERSIST || '').toLowerCase() === 'true';
const persistPath = process.env.CORS_PERSIST_PATH || path.join(process.cwd(), 'data', 'cors-allowlist.json');

function ensurePersistDir() {
  try {
    const dir = path.dirname(persistPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    logger.warn('Failed to ensure cors persist dir: %s', e && e.message);
  }
}

function loadPersisted() {
  try {
    if (!fs.existsSync(persistPath)) return null;
    const raw = fs.readFileSync(persistPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((s) => s.toString().trim()).filter(Boolean);
  } catch (e) {
    logger.warn('Failed to load persisted CORS allowlist: %s', e && e.message);
  }
  return null;
}

function savePersisted(list) {
  try {
    ensurePersistDir();
    fs.writeFileSync(persistPath, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    logger.warn('Failed to persist CORS allowlist: %s', e && e.message);
  }
}

const allowList = new Set(initial);

if (persist) {
  const p = loadPersisted();
  if (p && p.length) {
    allowList.clear();
    p.forEach((i) => allowList.add(i));
    logger.info('Loaded persisted CORS allowlist (%d entries)', allowList.size);
  } else {
    // persist the initial list so admin can later modify
    savePersisted(Array.from(allowList));
  }
}

function normalizeOrigin(origin) {
  if (!origin) return null;
  return origin.toString().trim();
}

function getAllowed() {
  return Array.from(allowList);
}

function addOrigin(origin) {
  const o = normalizeOrigin(origin);
  if (!o) return false;
  allowList.add(o);
  if (persist) savePersisted(Array.from(allowList));
  logger.info('CORS allowlist add: %s', o);
  return true;
}

function removeOrigin(origin) {
  const o = normalizeOrigin(origin);
  if (!o) return false;
  const removed = allowList.delete(o);
  if (removed) {
    if (persist) savePersisted(Array.from(allowList));
    logger.info('CORS allowlist removed: %s', o);
  }
  return removed;
}

function resetToInitial() {
  allowList.clear();
  initial.forEach((i) => allowList.add(i));
  if (persist) savePersisted(Array.from(allowList));
  logger.info('CORS allowlist reset to initial values');
}

module.exports = { getAllowed, addOrigin, removeOrigin, resetToInitial };
