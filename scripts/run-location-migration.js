#!/usr/bin/env node

/**
 * Скрипт для запуска миграции 038_add_location_to_kuliga_tables.sql
 * Добавляет поле location для поддержки Воронинских горок
 */

const { pool } = require('../src/db');
const fs = require('fs');
const path = require('path');

const MIGRATION_NAME = '038_add_location_to_kuliga_tables.sql';

async function runMigration() {
    const client = await pool.connect();

    try {
        console.log('🚀 Запуск миграции добавления поля location...');

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
        console.log('✨ Поле location добавлено во все таблицы kuliga_* для поддержки Воронинских горок.');
        
        // Показываем статистику
        const stats = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM kuliga_instructors) as instructors_count,
                (SELECT COUNT(*) FROM kuliga_schedule_slots) as slots_count,
                (SELECT COUNT(*) FROM kuliga_group_trainings) as group_trainings_count,
                (SELECT COUNT(*) FROM kuliga_bookings) as bookings_count
        `);
        
        console.log('');
        console.log('📊 Статистика:');
        console.log(`   Инструкторов: ${stats.rows[0].instructors_count}`);
        console.log(`   Слотов: ${stats.rows[0].slots_count}`);
        console.log(`   Групповых тренировок: ${stats.rows[0].group_trainings_count}`);
        console.log(`   Бронирований: ${stats.rows[0].bookings_count}`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при выполнении миграции:', error);
        process.exit(1);
    } finally {
        client.release();
    }
}

if (require.main === module) {
    runMigration()
        .then(() => {
            console.log('');
            console.log('✅ Миграция завершена успешно!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Критическая ошибка:', error);
            process.exit(1);
        });
}

module.exports = { runMigration };

