#!/usr/bin/env node

/**
 * Скрипт для запуска миграции 032_create_kuliga_instructor_payouts.sql
 * Создает таблицу выплат инструкторам Кулиги
 */

const { pool } = require('../src/db/index');
const fs = require('fs');
const path = require('path');

const MIGRATION_NAME = '032_create_kuliga_instructor_payouts.sql';

async function runMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Запуск миграции выплат инструкторам Кулиги...');
        
        // Создаем таблицу migrations если её нет
        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
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
            throw new Error(`Файл миграции не найден: ${migrationPath}`);
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
        console.log('✨ Таблица kuliga_instructor_payouts создана.');
        console.log('   Теперь можно использовать систему выплат инструкторам.');
        
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

