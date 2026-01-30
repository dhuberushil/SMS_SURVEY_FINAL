const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SubmissionHistory = sequelize.define(
  'SubmissionHistory',
  {
    submissionId: { type: DataTypes.INTEGER, allowNull: false },
    changeType: { type: DataTypes.STRING, allowNull: false },
    data: { type: DataTypes.JSON },
  },
  {
    timestamps: true,
  }
);

module.exports = SubmissionHistory;
