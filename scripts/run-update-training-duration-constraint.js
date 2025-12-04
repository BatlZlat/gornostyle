#!/usr/bin/env node

/**
 * Скрипт для запуска миграции 043_update_kuliga_programs_training_duration.sql
 * Обновляет CHECK constraint для training_duration, добавляя значения 75 и 105 минут
 */

const { pool } = require('../src/db/index');
const fs = require('fs');
const path = require('path');

const MIGRATION_NAME = '043_update_kuliga_programs_training_duration.sql';

async function runMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Запуск миграции обновления ограничения training_duration...');
        
        // Создаем таблицу migrations если её нет
        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Проверяем, была ли миграция уже выполнена
        const { rows } = await client.query(
            'SELECT * FROM migrations WHERE name = $1',
            [MIGRATION_NAME]
        );
        
        if (rows.length > 0) {
            console.log(`✅ Миграция ${MIGRATION_NAME} уже была выполнена`);
            console.log(`   Дата выполнения: ${rows[0].executed_at}`);
            return;
        }
        
        // Читаем файл миграции
        const migrationPath = path.join(__dirname, '../src/db/migrations', MIGRATION_NAME);
        if (!fs.existsSync(migrationPath)) {
            console.error(`❌ Файл миграции не найден: ${migrationPath}`);
            process.exit(1);
        }
        
        const migration = fs.readFileSync(migrationPath, 'utf8');
        
        console.log('📄 Файл миграции загружен');
        console.log('🔄 Выполнение миграции...');
        
        // Выполняем миграцию
        await client.query('BEGIN');
        await client.query(migration);
        await client.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            [MIGRATION_NAME]
        );
        await client.query('COMMIT');
        
        console.log(`✅ Миграция ${MIGRATION_NAME} успешно выполнена!`);
        console.log('');
        console.log('✨ Теперь можно использовать значения: 60, 75, 90, 105, 120 минут');
        
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

