#!/usr/bin/env node

/**
 * Скрипт для запуска миграций 039 и 040
 * Добавляет поле location в kuliga_programs и создает таблицу kuliga_program_instructors
 */

const { pool } = require('../src/db');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = [
    '039_add_location_to_kuliga_programs.sql',
    '040_create_program_instructors_link.sql'
];

async function runMigrations() {
    const client = await pool.connect();

    try {
        console.log('🚀 Запуск миграций для программ Кулиги...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        for (const migrationName of MIGRATIONS) {
            const { rows } = await client.query(
                'SELECT executed_at FROM migrations WHERE name = $1',
                [migrationName]
            );

            if (rows.length) {
                console.log(`✅ Миграция ${migrationName} уже была выполнена`);
                console.log(`   Дата выполнения: ${rows[0].executed_at}`);
                continue;
            }

            const migrationPath = path.join(__dirname, '../src/db/migrations', migrationName);
            
            if (!fs.existsSync(migrationPath)) {
                console.error(`❌ Файл миграции не найден: ${migrationPath}`);
                continue;
            }

            const migrationSql = fs.readFileSync(migrationPath, 'utf8');

            console.log(`📄 Загрузка миграции: ${migrationName}`);
            console.log('🔄 Выполнение миграции...');

            await client.query('BEGIN');
            await client.query(migrationSql);
            await client.query('INSERT INTO migrations (name) VALUES ($1)', [migrationName]);
            await client.query('COMMIT');

            console.log(`✅ Миграция ${migrationName} успешно выполнена!`);
        }

        console.log('');
        console.log('✨ Все миграции для программ успешно применены!');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при выполнении миграций:', error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigrations();

