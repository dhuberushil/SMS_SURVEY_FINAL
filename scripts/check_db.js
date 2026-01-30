const sequelize = require('../src/config/database');
const FormSubmission = require('../src/models/FormSubmission');
const User = require('../src/models/User');
const logger = require('../src/logger');

(async () => {
  try {
    await sequelize.authenticate();
    logger.info('DB connected');

    // Ensure models are available (no sync here to avoid accidental schema changes)
    const [fCount, uCount] = await Promise.all([FormSubmission.count(), User.count()]);

    logger.info('FormSubmission count: %d', fCount);
    logger.info('User count: %d', uCount);

    const one = await FormSubmission.findOne();
    logger.info('Sample FormSubmission: %o', one ? one.toJSON() : 'none');

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    logger.error('DB check failed: %o', err && (err.message || err));
    try {
      await sequelize.close();
    } catch (e) {
      logger.warn('Failed to close DB connection during check_db: %s', e && e.message);
    }
    process.exit(1);
  }
})();
