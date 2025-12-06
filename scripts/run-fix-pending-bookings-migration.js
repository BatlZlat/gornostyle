#!/usr/bin/env node

/**
 * Скрипт для запуска миграции 037_fix_pending_kuliga_bookings_status.sql
 * Обновляет статус индивидуальных бронирований Кулиги с 'pending' на 'confirmed'
 * для тех, которые были оплачены из кошелька
 */

const { pool } = require('../src/db');
const fs = require('fs');
const path = require('path');

const MIGRATION_NAME = '037_fix_pending_kuliga_bookings_status.sql';

async function runMigration() {
    const client = await pool.connect();

    try {
        console.log('🚀 Запуск миграции обновления статусов бронирований Кулиги...');

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
        
        // Показываем статистику обновленных записей
        const { rows: stats } = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_bookings
            WHERE booking_type = 'individual'
              AND status = 'confirmed'
              AND updated_at >= NOW() - INTERVAL '1 minute'
        `);
        
        if (stats[0].count > 0) {
            console.log(`✨ Обновлено ${stats[0].count} бронирований со статусом 'pending' на 'confirmed'`);
        } else {
            console.log('ℹ️  Не найдено бронирований для обновления');
        }
        
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

