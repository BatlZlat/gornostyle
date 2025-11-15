#!/usr/bin/env node

const { pool } = require('../src/db');
const fs = require('fs');
const path = require('path');

const MIGRATION_NAME = '029_update_kuliga_bookings.sql';

async function runMigration() {
    const client = await pool.connect();

    try {
        console.log('🚀 Запуск миграции бронирований Кулиги...');

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

        if (rows.length) {
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
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [MIGRATION_NAME]);
        await client.query('COMMIT');

        console.log(`✅ Миграция ${MIGRATION_NAME} успешно выполнена!`);
        console.log('');
        console.log('✨ Таблица kuliga_bookings расширена дополнительными полями для нового функционала.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при выполнении миграции бронирований Кулиги:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));





