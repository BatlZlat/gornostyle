const express = require('express');
const router = express.Router();
const { 
    verifyTrainerCredentials, 
    generateTrainerToken 
} = require('../middleware/trainerAuth');
const jwt = require('jsonwebtoken');

/**
 * POST /api/trainer/login
 * Вход тренера в систему
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
        const trainer = await verifyTrainerCredentials(username, password);
        
        if (!trainer) {
            return res.status(401).json({ 
                error: 'invalid_credentials',
                message: 'Неверный логин или пароль, либо аккаунт неактивен'
            });
        }
        
        // Генерируем токен
        const token = generateTrainerToken(trainer.id);
        
        console.log(`✓ Тренер ${trainer.fullName} (ID: ${trainer.id}) успешно вошел в систему`);
        
        // Возвращаем токен и данные тренера
        res.json({ 
            token,
            trainer: {
                id: trainer.id,
                fullName: trainer.fullName,
                username: trainer.username,
                sportType: trainer.sportType,
                phone: trainer.phone
            }
        });
    } catch (error) {
        console.error('Ошибка при входе тренера:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера' 
        });
    }
});

/**
 * GET /api/trainer/verify
 * Проверка валидности токена тренера
 */
router.get('/verify', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1] || 
                  req.query.token;

    if (!token) {
        return res.status(401).json({ 
            valid: false, 
            error: 'Токен не предоставлен' 
        });
    }

    try {
        // Проверяем токен
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Проверяем что это токен тренера
        if (decoded.type !== 'trainer') {
            return res.status(403).json({ 
                valid: false, 
                error: 'Недействительный тип токена' 
            });
        }
        
        // Проверяем что тренер существует и активен
        const { pool } = require('../db/index');
        const result = await pool.query(
            `SELECT id, full_name, username, is_active, sport_type, phone
             FROM trainers 
             WHERE id = $1`,
            [decoded.trainerId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                valid: false, 
                error: 'Тренер не найден' 
            });
        }
        
        const trainer = result.rows[0];
        
        if (!trainer.is_active) {
            return res.status(403).json({ 
                valid: false, 
                error: 'Аккаунт неактивен' 
            });
        }
        
        // Токен валиден
        res.json({ 
            valid: true,
            trainer: {
                id: trainer.id,
                fullName: trainer.full_name,
                username: trainer.username,
                sportType: trainer.sport_type,
                phone: trainer.phone
            }
        });
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                valid: false, 
                error: 'Недействительный токен' 
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                valid: false, 
                error: 'Токен истек' 
            });
        }
        
        console.error('Ошибка при проверке токена тренера:', error);
        res.status(500).json({ 
            valid: false, 
            error: 'Внутренняя ошибка сервера' 
        });
    }
});

/**
 * POST /api/trainer/logout
 * Выход тренера из системы (на клиенте удаляется токен)
 */
router.post('/logout', (req, res) => {
    // Логирование выхода
    const authHeader = req.headers.authorization;
    if (authHeader) {
        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log(`✓ Тренер (ID: ${decoded.trainerId}) вышел из системы`);
        } catch (error) {
            // Игнорируем ошибки при логировании
        }
    }
    
    res.json({ 
        success: true, 
        message: 'Выход выполнен успешно' 
    });
});

module.exports = router;

