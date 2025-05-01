const Simulator = require('../models/Simulator');

const simulatorController = {
    async createSimulator(req, res) {
        try {
            const simulator = await Simulator.create(req.body);
            res.status(201).json(simulator);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при создании тренажера' });
        }
    },

    async getSimulator(req, res) {
        try {
            const simulator = await Simulator.findById(req.params.id);
            if (!simulator) {
                return res.status(404).json({ error: 'Тренажер не найден' });
            }
            res.json(simulator);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении тренажера' });
        }
    },

    async updateSimulator(req, res) {
        try {
            const simulator = await Simulator.update(req.params.id, req.body);
            if (!simulator) {
                return res.status(404).json({ error: 'Тренажер не найден' });
            }
            res.json(simulator);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при обновлении тренажера' });
        }
    },

    async deleteSimulator(req, res) {
        try {
            const simulator = await Simulator.delete(req.params.id);
            if (!simulator) {
                return res.status(404).json({ error: 'Тренажер не найден' });
            }
            res.json({ message: 'Тренажер успешно удален' });
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при удалении тренажера' });
        }
    },

    async getAllSimulators(req, res) {
        try {
            const simulators = await Simulator.findAll();
            res.json(simulators);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении списка тренажеров' });
        }
    },

    async getSimulatorsByStatus(req, res) {
        try {
            const simulators = await Simulator.findByStatus(req.params.status);
            res.json(simulators);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении тренажеров по статусу' });
        }
    },

    async updateSimulatorStatus(req, res) {
        try {
            const { status } = req.body;
            const simulator = await Simulator.updateStatus(req.params.id, status);
            if (!simulator) {
                return res.status(404).json({ error: 'Тренажер не найден' });
            }
            res.json(simulator);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при обновлении статуса тренажера' });
        }
    },

    async getSimulatorSchedule(req, res) {
        try {
            const schedule = await Simulator.getSchedule(req.params.id);
            res.json(schedule);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении расписания тренажера' });
        }
    }
};

module.exports = simulatorController; 