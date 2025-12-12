#!/usr/bin/env node

/**
 * Скрипт для применения миграции добавления полей платежных провайдеров
 * в таблицу kuliga_transactions
 */

const { pool } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
    const client = await pool.connect();
    
    try {
        console.log('📦 Применяю миграцию payment_provider_fields...');
        
        const migrationSQL = fs.readFileSync(
            path.join(__dirname, '../migrations/add_payment_provider_fields_to_kuliga_transactions.sql'),
            'utf8'
        );
        
        await client.query(migrationSQL);
        
        console.log('✅ Миграция успешно применена');
        
        // Проверяем, что колонки добавлены
        const result = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'kuliga_transactions' 
            AND column_name IN (
                'payment_provider', 
                'provider_payment_id', 
                'provider_order_id', 
                'provider_status', 
                'payment_method', 
                'provider_raw_data'
            )
            ORDER BY column_name
        `);
        
        console.log('');
        console.log('✅ Добавленные колонки:');
        result.rows.forEach(row => {
            console.log(`   - ${row.column_name}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка применения миграции:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

applyMigration()
    .then(() => {
        console.log('');
        console.log('🎉 Готово!');
        process.exit(0);
    })
    .catch(() => {
        process.exit(1);
    });


