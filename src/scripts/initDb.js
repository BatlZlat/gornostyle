const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function initializeDatabase() {
    try {
        // Чтение SQL-файла
        const schemaPath = path.join(__dirname, '../models/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // Выполнение SQL-запросов
        await pool.query(schema);
        console.log('База данных успешно инициализирована');

        // Создание тестовых данных
        await createTestData();
        console.log('Тестовые данные успешно добавлены');

        process.exit(0);
    } catch (error) {
        console.error('Ошибка при инициализации базы данных:', error);
        process.exit(1);
    }
}

async function createTestData() {
    // Создание тестовых пользователей
    const users = [
        ['Иван Петров', '1990-01-01', '+7(999)123-45-67', 3, false, null, null, null, '123456', '123456789', '@ivan', 'ivan_p', 'admin'],
        ['Мария Сидорова', '1985-05-15', '+7(999)234-56-78', 5, true, 'Алексей Сидоров', '2010-06-20', 2, '234567', '234567890', '@maria', 'maria_s', 'trainer'],
        ['Алексей Иванов', '1995-03-10', '+7(999)345-67-89', 1, false, null, null, null, '345678', '345678901', '@alex', 'alex_i', 'client']
    ];

    for (const [full_name, birth_date, phone, skill_level, has_child, child_name, child_birth_date, child_skill_level, account_number, telegram_id, telegram_username, nickname, role] of users) {
        await pool.query(
            `INSERT INTO users (full_name, birth_date, phone, skill_level, has_child, child_name, 
            child_birth_date, child_skill_level, account_number, telegram_id, telegram_username, 
            nickname, role) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [full_name, birth_date, phone, skill_level, has_child, child_name, child_birth_date, 
            child_skill_level, account_number, telegram_id, telegram_username, nickname, role]
        );
    }

    // Создание тестовых тренажеров
    const simulators = [
        ['Тренажер 1', 'available'],
        ['Тренажер 2', 'available']
    ];

    for (const [name, status] of simulators) {
        await pool.query(
            'INSERT INTO simulators (name, status) VALUES ($1, $2)',
            [name, status]
        );
    }

    // Создание тестовых групп
    const groups = [
        ['Горнолыжники дети', 'Группа для детей, занимающихся горными лыжами'],
        ['Горнолыжники взрослые', 'Группа для взрослых, занимающихся горными лыжами'],
        ['Сноубордисты', 'Группа для сноубордистов']
    ];

    for (const [name, description] of groups) {
        await pool.query(
            'INSERT INTO groups (name, description) VALUES ($1, $2)',
            [name, description]
        );
    }

    // Создание тестовых кошельков
    const userIds = await pool.query('SELECT id FROM users');
    for (const { id } of userIds.rows) {
        await pool.query(
            'INSERT INTO wallets (user_id, balance) VALUES ($1, $2)',
            [id, 0]
        );
    }
}

initializeDatabase(); 