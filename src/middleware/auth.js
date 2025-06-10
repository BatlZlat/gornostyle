const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cookie = require('cookie');

// Middleware для проверки JWT токена
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Недействительный токен' });
    }
};

// Middleware для проверки аутентификации при доступе к HTML страницам
const verifyAuth = (req, res, next) => {
    // Пропускаем запросы к статическим файлам и странице входа
    if (req.path.startsWith('/css/') || 
        req.path.startsWith('/js/') || 
        req.path.startsWith('/images/') ||
        req.path === '/login.html' ||
        req.path === '/api/admin/login' ||
        req.path === '/api/admin/verify') {
        return next();
    }

    // Проверяем, является ли запрос к админ-странице
    if (req.path.startsWith('/admin') || 
        req.path.startsWith('/create-training') ||
        req.path.startsWith('/archive') ||
        req.path.startsWith('/groups')) {
        // Для HTML-страниц токен берём из cookie
        let token;
        if (req.headers.cookie) {
            const cookies = cookie.parse(req.headers.cookie);
            token = cookies.adminToken;
        }
        if (!token) {
            return res.redirect('/login.html');
        }
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            next();
        } catch (error) {
            return res.redirect('/login.html');
        }
    } else {
        next();
    }
};

// Функция для проверки логина и пароля
const verifyCredentials = async (login, password) => {
    const loginHash = process.env.ADMIN_LOGIN_HASH;
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;

    try {
        const loginMatch = await bcrypt.compare(login, loginHash);
        const passwordMatch = await bcrypt.compare(password, passwordHash);

        return loginMatch && passwordMatch;
    } catch (error) {
        console.error('Ошибка при проверке учетных данных:', error);
        return false;
    }
};

// Функция для генерации JWT токена
const generateToken = () => {
    return jwt.sign(
        { sub: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
};

module.exports = {
    verifyToken,
    verifyAuth,
    verifyCredentials,
    generateToken
}; 