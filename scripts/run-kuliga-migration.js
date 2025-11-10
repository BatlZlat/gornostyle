#!/usr/bin/env node

/**
 * Скрипт для запуска миграции 027_create_kuliga_system.sql
 * Обходит проблемы со старыми миграциями
 */

const { pool } = require('../src/db/index');
const fs = require('fs');
const path = require('path');

async function runKuligaMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Запуск миграции системы Кулиги...');
        
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
            ['027_create_kuliga_system.sql']
        );
        
        if (rows.length > 0) {
            console.log('✅ Миграция 027_create_kuliga_system.sql уже была выполнена');
            console.log(`   Дата выполнения: ${rows[0].executed_at}`);
            return;
        }
        
        // Читаем файл миграции
        const migrationPath = path.join(__dirname, '../src/db/migrations/027_create_kuliga_system.sql');
        const migration = fs.readFileSync(migrationPath, 'utf8');
        
        console.log('📄 Файл миграции загружен');
        console.log('🔄 Выполнение миграции...');
        
        // Выполняем миграцию
        await client.query('BEGIN');
        await client.query(migration);
        await client.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            ['027_create_kuliga_system.sql']
        );
        await client.query('COMMIT');
        
        console.log('✅ Миграция 027_create_kuliga_system.sql успешно выполнена!');
        console.log('');
        console.log('📊 Созданные таблицы:');
        console.log('   - kuliga_clients');
        console.log('   - kuliga_instructors');
        console.log('   - kuliga_schedule_slots');
        console.log('   - kuliga_group_trainings');
        console.log('   - kuliga_bookings');
        console.log('   - kuliga_transactions');
        console.log('   - kuliga_admin_settings');
        console.log('');
        console.log('✨ База данных готова для системы Кулиги!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при выполнении миграции:', error.message);
        console.error('');
        console.error('Детали ошибки:');
        console.error(error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Запускаем миграцию
runKuligaMigration()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error('Миграция завершилась с ошибкой');
        process.exit(1);
    });

