const { pool } = require('./index');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Читаем и выполняем SQL-файлы
        const sqlFiles = [
            'init-simulators.sql',
            'init-schedule.sql'
        ];

        for (const file of sqlFiles) {
            const filePath = path.join(__dirname, file);
            const sql = fs.readFileSync(filePath, 'utf8');
            await client.query(sql);
            console.log(`Выполнен файл ${file}`);
        }

        await client.query('COMMIT');
        console.log('База данных успешно инициализирована');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при инициализации базы данных:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Запускаем инициализацию
initDatabase().catch(console.error); 