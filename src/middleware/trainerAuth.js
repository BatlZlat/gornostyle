const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { pool } = require('../db/index');

/**
 * Middleware для проверки JWT токена тренера
 * Используется для защиты API endpoints
 */
const verifyTrainerToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Проверяем JWT токен
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Проверяем что это токен тренера
        if (decoded.type !== 'trainer') {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        // Проверяем что тренер все еще активен
        const trainerResult = await pool.query(
            'SELECT id, full_name, is_active FROM trainers WHERE id = $1',
            [decoded.trainerId]
        );
        
        if (trainerResult.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }
        
        const trainer = trainerResult.rows[0];
        
        if (!trainer.is_active) {
            return res.status(403).json({ error: 'Доступ запрещен. Аккаунт неактивен' });
        }
        
        // Сохраняем данные тренера в req для использования в роутах
        req.trainer = {
            id: trainer.id,
            fullName: trainer.full_name
        };
        
        next();
    } catch (error) {
        console.error('Ошибка при проверке токена тренера:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Недействительный токен' });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Токен истек' });
        }
        
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
};

/**
 * Middleware для проверки аутентификации при доступе к HTML страницам тренеров
 * Используется для защиты trainer.html
 */
const verifyTrainerAuth = async (req, res, next) => {
    // Пропускаем статические файлы и страницу входа
    if (req.path.startsWith('/css/') || 
        req.path.startsWith('/js/') || 
        req.path.startsWith('/images/') ||
        req.path === '/trainer-login.html' ||
        req.path === '/api/trainer/login' ||
        req.path === '/api/trainer/verify') {
        return next();
    }

    // Проверяем только страницы тренеров
    if (req.path.startsWith('/trainer.html') || req.path.startsWith('/trainer/')) {
        // Для HTML-страниц токен берём из cookie
        let token;
        if (req.headers.cookie) {
            const cookies = cookie.parse(req.headers.cookie);
            token = cookies.trainerToken;
        }
        
        if (!token) {
            return res.redirect('/trainer-login.html');
        }
        
        try {
            // Проверяем токен
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Проверяем что это токен тренера
            if (decoded.type !== 'trainer') {
                return res.redirect('/trainer-login.html');
            }
            
            // Проверяем что тренер все еще активен
            const trainerResult = await pool.query(
                'SELECT id, is_active FROM trainers WHERE id = $1',
                [decoded.trainerId]
            );
            
            if (trainerResult.rows.length === 0 || !trainerResult.rows[0].is_active) {
                return res.redirect('/trainer-login.html');
            }
            
            next();
        } catch (error) {
            console.error('Ошибка при проверке токена тренера:', error);
            return res.redirect('/trainer-login.html');
        }
    } else {
        next();
    }
};

/**
 * Функция для проверки учетных данных тренера
 * @param {string} username - Логин тренера
 * @param {string} password - Пароль тренера
 * @returns {Promise<Object|null>} Данные тренера или null если не найден
 */
const verifyTrainerCredentials = async (username, password) => {
    if (!username || !password) {
        return null;
    }

    try {
        // Ищем тренера по username и password (пароль не хешируется)
        const result = await pool.query(
            `SELECT id, full_name, username, is_active, sport_type, phone
             FROM trainers 
             WHERE username = $1 AND password = $2`,
            [username, password]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const trainer = result.rows[0];

        // Проверяем что тренер активен
        if (!trainer.is_active) {
            return null;
        }

        return {
            id: trainer.id,
            fullName: trainer.full_name,
            username: trainer.username,
            sportType: trainer.sport_type,
            phone: trainer.phone
        };
    } catch (error) {
        console.error('Ошибка при проверке учетных данных тренера:', error);
        return null;
    }
};

/**
 * Функция для генерации JWT токена для тренера
 * @param {number} trainerId - ID тренера
 * @returns {string} JWT токен
 */
const generateTrainerToken = (trainerId) => {
    return jwt.sign(
        { 
            trainerId,
            type: 'trainer'
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' } // Токен действителен 24 часа
    );
};

module.exports = {
    verifyTrainerToken,
    verifyTrainerAuth,
    verifyTrainerCredentials,
    generateTrainerToken
};

