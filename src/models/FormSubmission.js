const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const logger = require('../logger');

const FormSubmission = sequelize.define(
  'FormSubmission',
  {
    // Identifiers
    email: { type: DataTypes.STRING, unique: true },
    phone: { type: DataTypes.STRING },
    mobile: { type: DataTypes.STRING, unique: true },

    // Basic person/contact fields (used by web form + Step A)
    firstName: { type: DataTypes.STRING },
    lastName: { type: DataTypes.STRING },
    name: { type: DataTypes.STRING },
    dateOfBirth: { type: DataTypes.DATEONLY },

    // Address / demographics
    streetAddress: { type: DataTypes.STRING },
    address: { type: DataTypes.STRING },
    postal_address: { type: DataTypes.STRING },
    country: { type: DataTypes.STRING },
    age: DataTypes.INTEGER,
    gender: DataTypes.STRING,

    // Health / form specific fields
    heightFeet: { type: DataTypes.INTEGER },
    heightInches: { type: DataTypes.INTEGER },
    weightLbs: { type: DataTypes.FLOAT },
    // Calculated Body Mass Index (BMI). Calculated server-side when height/weight provided.
    bmi: { type: DataTypes.FLOAT },
    // Creation timestamps in multiple zones
    created_at_utc: { type: DataTypes.DATE },
    created_at_us: { type: DataTypes.STRING },
    // created_at_ist removed per new schema requirements
    interestedProcedure: { type: DataTypes.STRING },
    priorWeightLossSurgery: { type: DataTypes.BOOLEAN, defaultValue: false },
    wheelchairUsage: { type: DataTypes.BOOLEAN, defaultValue: false },
    hasSecondaryInsurance: { type: DataTypes.BOOLEAN, defaultValue: false },
    insuranceEmployerName: { type: DataTypes.STRING },

    // Store image metadata as JSON: [{ key, url, uploadedAt, size, contentType }]
    imageObjects: { type: DataTypes.JSON },
    // Generic answers storage for SMS flows and other Q&A
    answers: { type: DataTypes.JSON },

    // StepB token and nudge tracking
    stepBToken: { type: DataTypes.STRING },
    stepBTokenIssuedAt: { type: DataTypes.DATE },
    stepBCompleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    stepBCompletedAt: { type: DataTypes.DATE },
    stepBNudgeCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    stepBLastNudgeAt: { type: DataTypes.DATE },

    // SMS survey runtime state (replaces separate `User` table)
    current_step: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: { type: DataTypes.ENUM('STARTED', 'COMPLETED'), defaultValue: 'STARTED' },
    last_active: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    timestamps: true,
    hooks: {
      beforeCreate: (instance) => {
        try {
          instance.created_at_utc = new Date();
          // Store a human-friendly US-formatted timestamp (Eastern time)
          instance.created_at_us = new Date().toLocaleString('en-US', {
            timeZone: 'America/New_York',
          });
          // Ensure `name` contains full name when firstName/lastName provided
          if (!instance.name && (instance.firstName || instance.lastName)) {
            instance.name = (
              (instance.firstName || '') + (instance.lastName ? ' ' + instance.lastName : '')
            ).trim();
          }
        } catch (e) {
          logger.warn('FormSubmission.beforeCreate hook error: %s', e && e.message);
        }
      },
      beforeUpdate: (instance) => {
        try {
          // keep created_at_us in case upstream systems expect a human-friendly value
          if (!instance.created_at_us && instance.created_at_utc) {
            instance.created_at_us = new Date(instance.created_at_utc).toLocaleString('en-US', {
              timeZone: 'America/New_York',
            });
          }
          if (!instance.name && (instance.firstName || instance.lastName)) {
            instance.name = (
              (instance.firstName || '') + (instance.lastName ? ' ' + instance.lastName : '')
            ).trim();
          }
        } catch (e) {
          logger.warn('FormSubmission.beforeUpdate hook error: %s', e && e.message);
        }
      },
    },
  }
);

// Return a compact public representation of a submission, mapping legacy
// fields into the simplified shape requested by downstream systems/UI.
FormSubmission.prototype.toPublic = function toPublic() {
  const obj = typeof this.toJSON === 'function' ? this.toJSON() : this || {};

  const mobile = obj.mobile || obj.phone || null;
  const fullName =
    obj.fullName ||
    obj.name ||
    ((obj.firstName || '') + (obj.lastName ? ' ' + obj.lastName : '')).trim() ||
    null;
  const timezone = obj.timezone || obj.tz || null;

  // Normalize height to centimeters when possible
  let height = null;
  if (obj.height != null) height = Number(obj.height);
  else if (obj.height_cm != null) height = Number(obj.height_cm);
  else if (obj.heightFeet != null || obj.heightInches != null) {
    const hf = Number(obj.heightFeet || 0);
    const hi = Number(obj.heightInches || 0);
    const totalInches = hf * 12 + hi;
    if (totalInches > 0) height = Math.round(totalInches * 2.54);
  }

  // Normalize weight to kilograms when possible
  let weight = null;
  if (obj.weight != null) weight = Number(obj.weight);
  else if (obj.weightKg != null) weight = Number(obj.weightKg);
  else if (obj.weight_kg != null) weight = Number(obj.weight_kg);
  else if (obj.weightLbs != null) weight = Number(obj.weightLbs) / 2.2046226218;

  // BMI: prefer stored bmi, otherwise compute from height(cm) & weight(kg)
  let bmi = null;
  if (obj.bmi != null) bmi = Number(obj.bmi);
  else if (height && weight) {
    const h = Number(height) / 100; // m
    if (h > 0) bmi = Math.round((Number(weight) / (h * h)) * 10) / 10;
  }

  return {
    id: obj.id,
    fullName: fullName || null,
    email: obj.email || null,
    mobile,
    timezone,
    status: obj.status || null,
    current_step: obj.current_step || 0,
    last_active: obj.last_active || obj.updatedAt || null,
    answers: obj.answers || {},
    height: height != null ? Number(height) : null,
    weight: weight != null ? Math.round(Number(weight) * 10) / 10 : null,
    bmi: bmi != null ? Math.round(Number(bmi) * 10) / 10 : null,
    stepBToken: obj.stepBToken || null,
    stepBCompleted: !!obj.stepBCompleted,
    stepBNudgeCount: obj.stepBNudgeCount || 0,
    stepBLastNudgeAt: obj.stepBLastNudgeAt || null,
    imageObjects: obj.imageObjects || [],
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
  };
};

module.exports = FormSubmission;
