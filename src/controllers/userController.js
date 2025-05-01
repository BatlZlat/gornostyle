const User = require('../models/User');

const userController = {
    async createUser(req, res) {
        try {
            const user = await User.create(req.body);
            res.status(201).json(user);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при создании пользователя' });
        }
    },

    async getUser(req, res) {
        try {
            const user = await User.findById(req.params.id);
            if (!user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json(user);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении пользователя' });
        }
    },

    async updateUser(req, res) {
        try {
            const user = await User.update(req.params.id, req.body);
            if (!user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json(user);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при обновлении пользователя' });
        }
    },

    async deleteUser(req, res) {
        try {
            const user = await User.delete(req.params.id);
            if (!user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json({ message: 'Пользователь успешно удален' });
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при удалении пользователя' });
        }
    },

    async getAllUsers(req, res) {
        try {
            const users = await User.findAll();
            res.json(users);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении списка пользователей' });
        }
    },

    async getUsersByRole(req, res) {
        try {
            const users = await User.findByRole(req.params.role);
            res.json(users);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении пользователей по роли' });
        }
    }
};

module.exports = userController; 