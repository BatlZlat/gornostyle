const express = require('express');
const router = express.Router();
const { verifyCredentials, generateToken, verifyToken } = require('../middleware/auth');

// Маршрут для входа
router.post('/login', async (req, res) => {
    const { login, password } = req.body;

    if (!login || !password) {
        return res.status(400).json({ error: 'Необходимо указать логин и пароль' });
    }

    try {
        const isValid = await verifyCredentials(login, password);
        
        if (isValid) {
            const token = generateToken();
            res.json({ token });
        } else {
            res.status(401).json({ error: 'invalid_credentials' });
        }
    } catch (error) {
        console.error('Ошибка при входе:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Маршрут для проверки токена
router.get('/verify', verifyToken, (req, res) => {
    res.json({ valid: true });
});

// Маршрут для выхода
router.post('/logout', (req, res) => {
    // На клиенте мы просто удаляем токен из localStorage
    res.json({ success: true });
});

module.exports = router; 