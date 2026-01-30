'use strict';

module.exports = {
  up: async (queryInterface, _Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Add missing columns safely
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "FormSubmissions"
          ADD COLUMN IF NOT EXISTS "mobile" VARCHAR,
          ADD COLUMN IF NOT EXISTS "phone" VARCHAR,
          ADD COLUMN IF NOT EXISTS "name" VARCHAR,
          ADD COLUMN IF NOT EXISTS "age" INTEGER,
          ADD COLUMN IF NOT EXISTS "gender" VARCHAR,
          ADD COLUMN IF NOT EXISTS "address" VARCHAR,
          ADD COLUMN IF NOT EXISTS "postal_address" VARCHAR,
          ADD COLUMN IF NOT EXISTS "country" VARCHAR,
          ADD COLUMN IF NOT EXISTS "heightFeet" INTEGER,
          ADD COLUMN IF NOT EXISTS "heightInches" INTEGER,
          ADD COLUMN IF NOT EXISTS "weightLbs" DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS "bmi" DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS "created_at_utc" TIMESTAMPTZ DEFAULT now(),
          ADD COLUMN IF NOT EXISTS "created_at_us" TEXT,
          ADD COLUMN IF NOT EXISTS "created_at_ist" TEXT,
          ADD COLUMN IF NOT EXISTS "current_step" INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "status" VARCHAR DEFAULT 'STARTED',
          ADD COLUMN IF NOT EXISTS "last_active" TIMESTAMP;
      `,
        { transaction }
      );

      // Create unique indexes if they do not exist
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX IF NOT EXISTS formsubmissions_email_unique_idx ON "FormSubmissions" (email);
      `,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX IF NOT EXISTS formsubmissions_mobile_unique_idx ON "FormSubmissions" (mobile);
      `,
        { transaction }
      );

      // If a legacy Users table exists, copy/merge data into FormSubmissions
      // This will insert new rows or update existing ones by mobile
      await queryInterface.sequelize.query(
        `
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'Users') THEN
            INSERT INTO "FormSubmissions" (mobile, name, age, gender, address, postal_address, current_step, status, last_active, "createdAt", "updatedAt")
            SELECT mobile, name, age, gender, address, postal_address, current_step, status, last_active, NOW(), NOW()
            FROM "Users"
            ON CONFLICT (mobile) DO UPDATE SET
              name = EXCLUDED.name,
              age = EXCLUDED.age,
              gender = EXCLUDED.gender,
              address = EXCLUDED.address,
              postal_address = EXCLUDED.postal_address,
              current_step = EXCLUDED.current_step,
              status = EXCLUDED.status,
              last_active = EXCLUDED.last_active;
          END IF;
        END$$;
      `,
        { transaction }
      );

      // Backfill created_at_* fields for existing rows using createdAt (or now())
      await queryInterface.sequelize.query(
        `
        UPDATE "FormSubmissions" SET
          created_at_utc = COALESCE("createdAt", now()),
          created_at_us = to_char(timezone('America/New_York', COALESCE("createdAt", now())), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
          created_at_ist = to_char(timezone('Asia/Kolkata', COALESCE("createdAt", now())), 'YYYY-MM-DD"T"HH24:MI:SSOF')
        WHERE created_at_utc IS NULL OR created_at_us IS NULL OR created_at_ist IS NULL;
      `,
        { transaction }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  down: async (queryInterface, _Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Remove columns if they exist (be careful: destructive)
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "FormSubmissions"
          DROP COLUMN IF EXISTS "bmi",
          DROP COLUMN IF EXISTS "weightLbs",
          DROP COLUMN IF EXISTS "heightInches",
          DROP COLUMN IF EXISTS "heightFeet",
          DROP COLUMN IF EXISTS "last_active",
          DROP COLUMN IF EXISTS "status",
          DROP COLUMN IF EXISTS "current_step",
          DROP COLUMN IF EXISTS "country",
          DROP COLUMN IF EXISTS "postal_address",
          DROP COLUMN IF EXISTS "address",
          DROP COLUMN IF EXISTS "gender",
          DROP COLUMN IF EXISTS "age",
          DROP COLUMN IF EXISTS "name",
          DROP COLUMN IF EXISTS "phone",
          DROP COLUMN IF EXISTS "mobile";
      `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS formsubmissions_email_unique_idx;`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS formsubmissions_mobile_unique_idx;`,
        { transaction }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
