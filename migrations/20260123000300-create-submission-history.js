'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('SubmissionHistories', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      submissionId: { type: Sequelize.INTEGER, allowNull: false },
      changeType: { type: Sequelize.STRING, allowNull: false },
      data: { type: Sequelize.JSON },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('SubmissionHistories');
  },
};
