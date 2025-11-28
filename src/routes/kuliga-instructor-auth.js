const express = require('express');
const router = express.Router();
const { 
    verifyKuligaInstructorCredentials, 
    generateKuligaInstructorToken 
} = require('../middleware/kuligaInstructorAuth');
const jwt = require('jsonwebtoken');

/**
 * POST /api/kuliga/instructor/login
 * Вход инструктора Кулиги в систему
 */
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ 
            error: 'Необходимо указать логин и пароль' 
        });
    }

    try {
        // Проверяем учетные данные
        const instructor = await verifyKuligaInstructorCredentials(username, password);
        
        if (!instructor) {
            return res.status(401).json({ 
                error: 'invalid_credentials',
                message: 'Неверный логин или пароль, либо аккаунт неактивен'
            });
        }
        
        // Генерируем токен
        const token = generateKuligaInstructorToken(instructor.id);
        
        console.log(`✓ Инструктор Кулиги ${instructor.fullName} (ID: ${instructor.id}) успешно вошел в систему`);
        
        // Возвращаем токен и данные инструктора
        res.json({ 
            token,
            instructor: {
                id: instructor.id,
                fullName: instructor.fullName,
                username: instructor.username,
                sportType: instructor.sportType,
                phone: instructor.phone,
                email: instructor.email,
                location: instructor.location
            }
        });
    } catch (error) {
        console.error('Ошибка при входе инструктора Кулиги:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера' 
        });
    }
});

/**
 * GET /api/kuliga/instructor/verify
 * Проверка валидности токена инструктора Кулиги
 */
router.get('/verify', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            valid: false,
            error: 'Токен не предоставлен' 
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.type !== 'kuliga_instructor') {
            return res.status(403).json({ 
                valid: false,
                error: 'Неверный тип токена' 
            });
        }
        
        res.json({ 
            valid: true,
            instructorId: decoded.instructorId
        });
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                valid: false,
                error: 'Токен истек' 
            });
        }
        
        res.status(401).json({ 
            valid: false,
            error: 'Недействительный токен' 
        });
    }
});

module.exports = router;

