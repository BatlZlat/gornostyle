const { pool } = require('../db');
const fs = require('fs').promises;
const path = require('path');

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Создаем таблицу для отслеживания миграций, если её нет
        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Получаем список уже примененных миграций
        const appliedMigrations = await client.query('SELECT name FROM migrations');
        const appliedNames = new Set(appliedMigrations.rows.map(row => row.name));

        // Получаем список файлов миграций
        const migrationsDir = path.join(__dirname, '..', 'models', 'migrations');
        const files = await fs.readdir(migrationsDir);
        const migrationFiles = files
            .filter(f => f.endsWith('.sql'))
            .sort();

        // Применяем каждую миграцию
        for (const file of migrationFiles) {
            if (!appliedNames.has(file)) {
                console.log(`Применяем миграцию: ${file}`);
                const migrationPath = path.join(migrationsDir, file);
                const migrationSQL = await fs.readFile(migrationPath, 'utf8');
                
                await client.query(migrationSQL);
                await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
                
                console.log(`Миграция ${file} успешно применена`);
            }
        }

        await client.query('COMMIT');
        console.log('Все миграции успешно применены');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при применении миграций:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Запускаем миграции
runMigrations().catch(console.error); 