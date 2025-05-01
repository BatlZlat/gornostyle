const express = require('express');
const router = express.Router();
const simulatorController = require('../controllers/simulatorController');

// Создание нового тренажера
router.post('/', simulatorController.createSimulator);

// Получение всех тренажеров
router.get('/', simulatorController.getAllSimulators);

// Получение тренажеров по статусу
router.get('/status/:status', simulatorController.getSimulatorsByStatus);

// Получение расписания конкретного тренажера
router.get('/:id/schedule', simulatorController.getSimulatorSchedule);

// Получение конкретного тренажера
router.get('/:id', simulatorController.getSimulator);

// Обновление тренажера
router.put('/:id', simulatorController.updateSimulator);

// Обновление статуса тренажера
router.patch('/:id/status', simulatorController.updateSimulatorStatus);

// Удаление тренажера
router.delete('/:id', simulatorController.deleteSimulator);

module.exports = router; 