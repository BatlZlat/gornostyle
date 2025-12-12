#!/usr/bin/env node

const { pool } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
    const client = await pool.connect();
    
    try {
        console.log('📦 Применяю миграцию webhook_logs...');
        
        const migrationSQL = fs.readFileSync(
            path.join(__dirname, '../migrations/create_webhook_logs_table.sql'),
            'utf8'
        );
        
        await client.query(migrationSQL);
        
        console.log('✅ Миграция webhook_logs успешно применена');
        
        // Проверяем таблицу
        const result = await client.query(
            `SELECT COUNT(*) FROM information_schema.tables 
             WHERE table_schema = 'public' AND table_name = 'webhook_logs'`
        );
        
        if (result.rows[0].count === '1') {
            console.log('✅ Таблица webhook_logs создана');
        }
        
    } catch (error) {
        console.error('❌ Ошибка применения миграции:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

applyMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));


