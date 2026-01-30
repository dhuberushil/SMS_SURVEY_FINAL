// Deprecated: `User` model removed in favor of a single `FormSubmission` table.
// Keep a no-op export to avoid hard crashes if some other file still requires it.

const logger = require('../logger');
logger.warn('Deprecated model `src/models/User.js` loaded. Use `FormSubmission` instead.');

module.exports = null;
