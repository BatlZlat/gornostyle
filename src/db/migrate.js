const { pool } = require('./index');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Создаем таблицу для отслеживания миграций, если её нет
        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Получаем список выполненных миграций
        const { rows: executedMigrations } = await client.query(
            'SELECT name FROM migrations'
        );
        const executedMigrationNames = executedMigrations.map(m => m.name);

        // Получаем список файлов миграций
        const migrationFiles = fs.readdirSync(path.join(__dirname, 'migrations'))
            .filter(file => file.endsWith('.sql'))
            .sort();

        // Выполняем новые миграции
        for (const file of migrationFiles) {
            if (!executedMigrationNames.includes(file)) {
                console.log(`Выполняется миграция: ${file}`);
                const migration = fs.readFileSync(
                    path.join(__dirname, 'migrations', file),
                    'utf8'
                );
                await client.query(migration);
                await client.query(
                    'INSERT INTO migrations (name) VALUES ($1)',
                    [file]
                );
                console.log(`Миграция ${file} успешно выполнена`);
            }
        }

        await client.query('COMMIT');
        console.log('Все миграции успешно выполнены');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при выполнении миграций:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Запускаем миграции
runMigrations().catch(console.error); 