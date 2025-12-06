#!/usr/bin/env node

/**
 * Скрипт для проверки зависимостей сертификата
 * Помогает найти все таблицы, которые ссылаются на сертификат
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function checkCertificateDependencies(certificateIdOrNumber) {
    try {
        console.log('\n🔍 Проверка зависимостей сертификата...\n');
        
        // Определяем ID сертификата
        let certificateId;
        let certificateNumber;
        
        // Если передан номер (6 цифр), ищем по номеру
        if (/^\d{6}$/.test(certificateIdOrNumber)) {
            certificateNumber = certificateIdOrNumber;
            const certResult = await pool.query(
                'SELECT id, certificate_number FROM certificates WHERE certificate_number = $1',
                [certificateNumber]
            );
            
            if (certResult.rows.length === 0) {
                console.log(`❌ Сертификат с номером ${certificateNumber} не найден`);
                return;
            }
            
            certificateId = certResult.rows[0].id;
            certificateNumber = certResult.rows[0].certificate_number;
            console.log(`📋 Сертификат найден: ID=${certificateId}, Номер=${certificateNumber}\n`);
        } else {
            // Иначе используем как ID
            certificateId = parseInt(certificateIdOrNumber);
            const certResult = await pool.query(
                'SELECT id, certificate_number FROM certificates WHERE id = $1',
                [certificateId]
            );
            
            if (certResult.rows.length === 0) {
                console.log(`❌ Сертификат с ID ${certificateId} не найден`);
                return;
            }
            
            certificateNumber = certResult.rows[0].certificate_number;
            console.log(`📋 Сертификат найден: ID=${certificateId}, Номер=${certificateNumber}\n`);
        }

        // 1. Проверяем email_queue
        console.log('1️⃣  Проверка таблицы email_queue...');
        const emailQueueResult = await pool.query(
            'SELECT id, recipient_email, status, attempts, created_at FROM email_queue WHERE certificate_id = $1',
            [certificateId]
        );
        
        if (emailQueueResult.rows.length > 0) {
            console.log(`   ⚠️  Найдено записей в email_queue: ${emailQueueResult.rows.length}`);
            emailQueueResult.rows.forEach(row => {
                console.log(`      - ID: ${row.id}, Email: ${row.recipient_email}, Статус: ${row.status}, Попыток: ${row.attempts}`);
            });
        } else {
            console.log('   ✅ Записей в email_queue нет');
        }

        // 2. Проверяем transactions (по описанию)
        console.log('\n2️⃣  Проверка таблицы transactions...');
        const transactionsResult = await pool.query(
            `SELECT id, wallet_id, amount, type, description, created_at 
             FROM transactions 
             WHERE description LIKE '%${certificateNumber}%' 
                OR description LIKE '%сертификат%${certificateNumber}%'`,
            []
        );
        
        if (transactionsResult.rows.length > 0) {
            console.log(`   ⚠️  Найдено транзакций: ${transactionsResult.rows.length}`);
            transactionsResult.rows.forEach(row => {
                console.log(`      - ID: ${row.id}, Сумма: ${row.amount}, Описание: ${row.description}`);
            });
        } else {
            console.log('   ✅ Транзакций не найдено');
        }

        // 3. Проверяем внешние ключи из других таблиц
        console.log('\n3️⃣  Проверка внешних ключей...');
        const foreignKeysResult = await pool.query(`
            SELECT 
                conname AS constraint_name,
                conrelid::regclass AS table_name,
                a.attname AS column_name
            FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
            WHERE confrelid = 'certificates'::regclass 
                AND contype = 'f'
        `);
        
        if (foreignKeysResult.rows.length > 0) {
            console.log('   ⚠️  Найдены внешние ключи:');
            for (const fk of foreignKeysResult.rows) {
                console.log(`      - Таблица: ${fk.table_name}, Колонка: ${fk.column_name}, Ограничение: ${fk.constraint_name}`);
                
                // Проверяем, есть ли записи в этой таблице
                const checkQuery = `SELECT COUNT(*) as count FROM ${fk.table_name} WHERE ${fk.column_name} = $1`;
                const checkResult = await pool.query(checkQuery, [certificateId]);
                const count = parseInt(checkResult.rows[0].count);
                
                if (count > 0) {
                    console.log(`        ⚠️  Найдено записей: ${count}`);
                } else {
                    console.log(`        ✅ Записей нет`);
                }
            }
        } else {
            console.log('   ✅ Внешних ключей не найдено');
        }

        // 4. Итоговая информация
        console.log('\n📊 ИТОГОВАЯ ИНФОРМАЦИЯ:\n');
        
        const hasDependencies = 
            emailQueueResult.rows.length > 0 || 
            transactionsResult.rows.length > 0 ||
            foreignKeysResult.rows.some(fk => {
                // Проверяем записи для каждого внешнего ключа
                return true; // Проверяли выше
            });
        
        if (hasDependencies) {
            console.log('⚠️  Сертификат имеет зависимости. Для удаления выполните:\n');
            
            if (emailQueueResult.rows.length > 0) {
                console.log('   DELETE FROM email_queue WHERE certificate_id = ' + certificateId + ';');
            }
            
            if (transactionsResult.rows.length > 0) {
                console.log('   -- Транзакции можно оставить, они содержат только текст в описании');
            }
            
            // Для других внешних ключей
            for (const fk of foreignKeysResult.rows) {
                const checkQuery = `SELECT COUNT(*) as count FROM ${fk.table_name} WHERE ${fk.column_name} = $1`;
                const checkResult = await pool.query(checkQuery, [certificateId]);
                const count = parseInt(checkResult.rows[0].count);
                
                if (count > 0) {
                    console.log(`   DELETE FROM ${fk.table_name} WHERE ${fk.column_name} = ${certificateId};`);
                }
            }
            
            console.log(`\n   DELETE FROM certificates WHERE id = ${certificateId};`);
        } else {
            console.log('✅ Сертификат не имеет зависимостей, можно удалять напрямую:\n');
            console.log(`   DELETE FROM certificates WHERE id = ${certificateId};`);
        }

    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

// Запуск
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log('Использование: node scripts/check-certificate-dependencies.js <certificate_id или certificate_number>');
    console.log('Пример: node scripts/check-certificate-dependencies.js 123456');
    console.log('Пример: node scripts/check-certificate-dependencies.js 5');
    process.exit(1);
}

checkCertificateDependencies(args[0]).then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Фатальная ошибка:', error);
    process.exit(1);
});

