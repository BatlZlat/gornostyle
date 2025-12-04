#!/usr/bin/env node

const { pool } = require('../src/db');
const fs = require('fs');
const path = require('path');

const MIGRATION_NAME = '043_update_kuliga_programs_training_duration.sql';

async function runMigration() {
    const client = await pool.connect();

    try {
        console.log('🚀 Запуск миграции обновления ограничения training_duration...');

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
        console.log('✨ Ограничение training_duration обновлено: теперь поддерживаются 60, 75, 90, 105, 120 минут');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при выполнении миграции:', error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();

