require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Генерируем секретный ключ для JWT
const jwtSecret = crypto.randomBytes(64).toString('hex');

// Функция для хеширования пароля
async function hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
}

// Функция для хеширования логина (используем тот же подход, что и для пароля)
async function hashLogin(login) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(login, salt);
}

async function generateCredentials() {
    const login = process.argv[2];
    const password = process.argv[3];

    if (!login || !password) {
        console.error('Использование: node generateAdminCredentials.js <логин> <пароль>');
        process.exit(1);
    }

    try {
        const hashedLogin = await hashLogin(login);
        const hashedPassword = await hashPassword(password);

        console.log('\nДобавьте следующие строки в ваш .env файл:\n');
        console.log(`ADMIN_LOGIN_HASH=${hashedLogin}`);
        console.log(`ADMIN_PASSWORD_HASH=${hashedPassword}`);
        console.log(`JWT_SECRET=${jwtSecret}\n`);
        
        console.log('Важно: Сохраните эти значения в надежном месте!');
    } catch (error) {
        console.error('Ошибка при генерации учетных данных:', error);
        process.exit(1);
    }
}

generateCredentials(); 