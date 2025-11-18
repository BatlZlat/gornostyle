const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cookie = require('cookie');
const { pool } = require('../db/index');

/**
 * Middleware для проверки JWT токена инструктора Кулиги
 * Используется для защиты API endpoints
 */
const verifyKuligaInstructorToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Проверяем JWT токен
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Проверяем что это токен инструктора Кулиги
        if (decoded.type !== 'kuliga_instructor') {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        // Проверяем что инструктор все еще активен
        const instructorResult = await pool.query(
            'SELECT id, full_name, is_active FROM kuliga_instructors WHERE id = $1',
            [decoded.instructorId]
        );
        
        if (instructorResult.rows.length === 0) {
            return res.status(404).json({ error: 'Инструктор не найден' });
        }
        
        const instructor = instructorResult.rows[0];
        
        if (!instructor.is_active) {
            return res.status(403).json({ error: 'Доступ запрещен. Аккаунт неактивен' });
        }
        
        // Сохраняем данные инструктора в req для использования в роутах
        req.kuligaInstructor = {
            id: instructor.id,
            fullName: instructor.full_name
        };
        
        next();
    } catch (error) {
        console.error('Ошибка при проверке токена инструктора Кулиги:', error);
        
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
 * Middleware для проверки аутентификации при доступе к HTML страницам инструкторов Кулиги
 * Используется для защиты trainer_kuliga.html
 */
const verifyKuligaInstructorAuth = async (req, res, next) => {
    // Пропускаем статические файлы и страницу входа
    if (req.path.startsWith('/css/') || 
        req.path.startsWith('/js/') || 
        req.path.startsWith('/images/') ||
        req.path === '/kuliga-instructor-login.html' ||
        req.path === '/api/kuliga/instructor/login' ||
        req.path === '/api/kuliga/instructor/verify') {
        return next();
    }

    // Проверяем только страницы инструкторов Кулиги
    if (req.path.startsWith('/trainer_kuliga.html') || req.path.startsWith('/kuliga/instructor/')) {
        // Для HTML-страниц токен берём из cookie
        let token;
        if (req.headers.cookie) {
            const cookies = cookie.parse(req.headers.cookie);
            token = cookies.kuligaInstructorToken;
        }
        
        if (!token) {
            return res.redirect('/kuliga-instructor-login.html');
        }
        
        try {
            // Проверяем токен
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Проверяем что это токен инструктора Кулиги
            if (decoded.type !== 'kuliga_instructor') {
                return res.redirect('/kuliga-instructor-login.html');
            }
            
            // Проверяем что инструктор все еще активен
            const instructorResult = await pool.query(
                'SELECT id, is_active FROM kuliga_instructors WHERE id = $1',
                [decoded.instructorId]
            );
            
            if (instructorResult.rows.length === 0 || !instructorResult.rows[0].is_active) {
                return res.redirect('/kuliga-instructor-login.html');
            }
            
            next();
        } catch (error) {
            console.error('Ошибка при проверке токена инструктора Кулиги:', error);
            return res.redirect('/kuliga-instructor-login.html');
        }
    } else {
        next();
    }
};

/**
 * Функция для проверки учетных данных инструктора Кулиги
 * @param {string} username - Логин инструктора
 * @param {string} password - Пароль инструктора
 * @returns {Promise<Object|null>} Данные инструктора или null если не найден
 */
const verifyKuligaInstructorCredentials = async (username, password) => {
    if (!username || !password) {
        return null;
    }

    try {
        // Ищем инструктора по username
        const result = await pool.query(
            `SELECT id, full_name, username, password_hash, is_active, sport_type, phone, email
             FROM kuliga_instructors 
             WHERE username = $1`,
            [username]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const instructor = result.rows[0];

        // Проверяем что инструктор активен
        if (!instructor.is_active) {
            return null;
        }

        // Проверяем что пароль установлен
        if (!instructor.password_hash) {
            return null;
        }

        // Проверяем пароль с помощью bcrypt
        const passwordMatch = await bcrypt.compare(password, instructor.password_hash);
        
        if (!passwordMatch) {
            return null;
        }

        return {
            id: instructor.id,
            fullName: instructor.full_name,
            username: instructor.username,
            sportType: instructor.sport_type,
            phone: instructor.phone,
            email: instructor.email
        };
    } catch (error) {
        console.error('Ошибка при проверке учетных данных инструктора Кулиги:', error);
        return null;
    }
};

/**
 * Функция для генерации JWT токена для инструктора Кулиги
 * @param {number} instructorId - ID инструктора
 * @returns {string} JWT токен
 */
const generateKuligaInstructorToken = (instructorId) => {
    return jwt.sign(
        { 
            instructorId,
            type: 'kuliga_instructor'
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' } // Токен действителен 24 часа
    );
};

module.exports = {
    verifyKuligaInstructorToken,
    verifyKuligaInstructorAuth,
    verifyKuligaInstructorCredentials,
    generateKuligaInstructorToken
};

