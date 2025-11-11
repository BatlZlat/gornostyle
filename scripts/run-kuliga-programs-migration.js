#!/usr/bin/env node

/**
 * Скрипт для запуска миграции 028_create_kuliga_programs.sql
 * Использует существующий pool и таблицу migrations
 */

const { pool } = require('../src/db');
const fs = require('fs');
const path = require('path');

const MIGRATION_NAME = '028_create_kuliga_programs.sql';

async function runKuligaProgramsMigration() {
    const client = await pool.connect();

    try {
        console.log('🚀 Запуск миграции регулярных программ Кулиги...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        const { rows } = await client.query(
            'SELECT executed_at FROM migrations WHERE name = $1',
            [MIGRATION_NAME]
        );

        if (rows.length > 0) {
            console.log(`✅ Миграция ${MIGRATION_NAME} уже была выполнена`);
            console.log(`   Дата выполнения: ${rows[0].executed_at}`);
            return;
        }

        const migrationPath = path.join(__dirname, '../src/db/migrations', MIGRATION_NAME);
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        console.log('📄 Файл миграции загружен');
        console.log('🔄 Выполнение миграции...');

        await client.query('BEGIN');
        await client.query(migrationSql);
        await client.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            [MIGRATION_NAME]
        );
        await client.query('COMMIT');

        console.log(`✅ Миграция ${MIGRATION_NAME} успешно выполнена!`);
        console.log('');
        console.log('📊 Созданные объекты:');
        console.log('   - kuliga_programs');
        console.log('   - kuliga_program_bookings');
        console.log('   - индексы и триггеры для регулярных программ');
        console.log('');
        console.log('✨ Система регулярных программ готова к использованию!');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при выполнении миграции регулярных программ:', error.message);
        console.error('');
        console.error('Детали ошибки:');
        console.error(error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

runKuligaProgramsMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));


