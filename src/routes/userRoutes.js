const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Создание нового пользователя
router.post('/', userController.createUser);

// Получение всех пользователей
router.get('/', userController.getAllUsers);

// Получение пользователей по роли
router.get('/role/:role', userController.getUsersByRole);

// Получение конкретного пользователя
router.get('/:id', userController.getUser);

// Обновление пользователя
router.put('/:id', userController.updateUser);

// Удаление пользователя
router.delete('/:id', userController.deleteUser);

module.exports = router; 