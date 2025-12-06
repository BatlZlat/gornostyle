#!/usr/bin/env node

/**
 * Скрипт для проверки синхронизации schema.sql с реальной базой данных
 * Выводит различия между schema.sql и реальной структурой БД
 */

const { pool } = require('../src/db/index');
const fs = require('fs');
const path = require('path');

async function checkTableExists(tableName) {
    try {
        const result = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = $1
            );
        `, [tableName]);
        return result.rows[0].exists;
    } catch (error) {
        console.error(`Ошибка проверки таблицы ${tableName}:`, error.message);
        return false;
    }
}

async function getTableColumns(tableName) {
    try {
        const result = await pool.query(`
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' 
            AND table_name = $1
            ORDER BY ordinal_position;
        `, [tableName]);
        return result.rows;
    } catch (error) {
        console.error(`Ошибка получения колонок ${tableName}:`, error.message);
        return [];
    }
}

async function getTableIndexes(tableName) {
    try {
        const result = await pool.query(`
            SELECT 
                indexname,
                indexdef
            FROM pg_indexes
            WHERE schemaname = 'public' 
            AND tablename = $1;
        `, [tableName]);
        return result.rows;
    } catch (error) {
        console.error(`Ошибка получения индексов ${tableName}:`, error.message);
        return [];
    }
}

async function getTableConstraints(tableName) {
    try {
        const result = await pool.query(`
            SELECT 
                conname,
                contype,
                pg_get_constraintdef(oid) as definition
            FROM pg_constraint
            WHERE conrelid = $1::regclass;
        `, [`public.${tableName}`]);
        return result.rows;
    } catch (error) {
        console.error(`Ошибка получения ограничений ${tableName}:`, error.message);
        return [];
    }
}

async function checkKuligaPayoutsTable() {
    console.log('🔍 Проверка таблицы kuliga_instructor_payouts...\n');
    
    const tableName = 'kuliga_instructor_payouts';
    const exists = await checkTableExists(tableName);
    
    if (!exists) {
        console.log('❌ Таблица kuliga_instructor_payouts НЕ существует в БД!');
        console.log('   Необходимо применить миграцию 032_create_kuliga_instructor_payouts.sql\n');
        return false;
    }
    
    console.log('✅ Таблица kuliga_instructor_payouts существует\n');
    
    // Проверяем колонки
    console.log('📋 Колонки таблицы:');
    const columns = await getTableColumns(tableName);
    const expectedColumns = [
        'id', 'instructor_id', 'period_start', 'period_end',
        'trainings_count', 'total_revenue', 'instructor_earnings', 'admin_commission',
        'status', 'payment_method', 'payment_date', 'payment_comment',
        'created_at', 'updated_at', 'created_by', 'paid_by'
    ];
    
    const existingColumnNames = columns.map(c => c.column_name);
    const missingColumns = expectedColumns.filter(col => !existingColumnNames.includes(col));
    
    if (missingColumns.length > 0) {
        console.log('   ⚠️ Отсутствующие колонки:', missingColumns.join(', '));
    } else {
        console.log('   ✅ Все ожидаемые колонки присутствуют');
    }
    
    columns.forEach(col => {
        console.log(`   - ${col.column_name}: ${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}${col.column_default ? ` DEFAULT ${col.column_default}` : ''}`);
    });
    
    console.log('');
    
    // Проверяем индексы
    console.log('🔍 Индексы таблицы:');
    const indexes = await getTableIndexes(tableName);
    const expectedIndexes = [
        'idx_kuliga_payouts_instructor',
        'idx_kuliga_payouts_status',
        'idx_kuliga_payouts_period',
        'idx_kuliga_payouts_instructor_status'
    ];
    
    const existingIndexNames = indexes.map(idx => idx.indexname);
    const missingIndexes = expectedIndexes.filter(idx => !existingIndexNames.includes(idx));
    
    if (missingIndexes.length > 0) {
        console.log('   ⚠️ Отсутствующие индексы:', missingIndexes.join(', '));
    } else {
        console.log('   ✅ Все ожидаемые индексы присутствуют');
    }
    
    indexes.forEach(idx => {
        console.log(`   - ${idx.indexname}`);
    });
    
    console.log('');
    
    // Проверяем ограничения
    console.log('🔒 Ограничения таблицы:');
    const constraints = await getTableConstraints(tableName);
    
    const hasUniqueConstraint = constraints.some(c => 
        c.conname === 'unique_instructor_period' && c.contype === 'u'
    );
    
    if (!hasUniqueConstraint) {
        console.log('   ⚠️ Отсутствует ограничение unique_instructor_period');
    } else {
        console.log('   ✅ Ограничение unique_instructor_period присутствует');
    }
    
    constraints.forEach(con => {
        console.log(`   - ${con.conname} (${con.contype}): ${con.definition}`);
    });
    
    console.log('');
    
    return true;
}

async function main() {
    try {
        console.log('🚀 Проверка синхронизации schema.sql с базой данных\n');
        console.log('=' .repeat(60) + '\n');
        
        await checkKuligaPayoutsTable();
        
        console.log('=' .repeat(60));
        console.log('\n✅ Проверка завершена');
        
    } catch (error) {
        console.error('❌ Ошибка при проверке:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();

