/**
 * Скрипт для генерации реферальных кодов существующим клиентам
 * 
 * Этот скрипт:
 * 1. Находит всех клиентов без реферального кода
 * 2. Генерирует уникальные коды для каждого
 * 3. Обновляет записи в базе данных
 */

require('dotenv').config();
const { Pool } = require('pg');

// Подключение к БД
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: false
});

/**
 * Генерация уникального реферального кода
 * Формат: 6 символов (буквы верхнего регистра + цифры)
 */
function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Проверка уникальности кода
 */
async function isCodeUnique(code) {
    const result = await pool.query(
        'SELECT COUNT(*) FROM clients WHERE referral_code = $1',
        [code]
    );
    return parseInt(result.rows[0].count) === 0;
}

/**
 * Генерация уникального кода
 */
async function generateUniqueCode() {
    let code;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!isUnique && attempts < maxAttempts) {
        code = generateReferralCode();
        isUnique = await isCodeUnique(code);
        attempts++;
    }

    if (!isUnique) {
        throw new Error('Не удалось сгенерировать уникальный код после ' + maxAttempts + ' попыток');
    }

    return code;
}

/**
 * Основная функция
 */
async function generateReferralCodesForExistingClients() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Начинаем генерацию реферальных кодов для существующих клиентов...\n');

        // Получаем всех клиентов без реферального кода
        const { rows: clients } = await client.query(`
            SELECT id, full_name, telegram_id 
            FROM clients 
            WHERE referral_code IS NULL
            ORDER BY id
        `);

        console.log(`📊 Найдено клиентов без реферального кода: ${clients.length}\n`);

        if (clients.length === 0) {
            console.log('✅ Все клиенты уже имеют реферальные коды!');
            return;
        }

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Генерируем коды для каждого клиента
        for (const clientData of clients) {
            try {
                // Генерируем уникальный код
                const referralCode = await generateUniqueCode();

                // Обновляем клиента
                await client.query(
                    'UPDATE clients SET referral_code = $1 WHERE id = $2',
                    [referralCode, clientData.id]
                );

                successCount++;
                console.log(`✅ [${successCount}/${clients.length}] Клиент ID ${clientData.id} (${clientData.full_name}): код ${referralCode}`);
            } catch (error) {
                errorCount++;
                const errorMsg = `❌ [${successCount + errorCount}/${clients.length}] Ошибка для клиента ID ${clientData.id} (${clientData.full_name}): ${error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
            }
        }

        // Итоговая статистика
        console.log('\n' + '='.repeat(70));
        console.log('📊 ИТОГОВАЯ СТАТИСТИКА:');
        console.log('='.repeat(70));
        console.log(`✅ Успешно обработано: ${successCount}`);
        console.log(`❌ Ошибок: ${errorCount}`);
        console.log(`📈 Всего клиентов: ${clients.length}`);
        console.log('='.repeat(70));

        if (errors.length > 0) {
            console.log('\n❌ СПИСОК ОШИБОК:');
            errors.forEach(err => console.log(err));
        }

        // Проверяем результат
        const { rows: checkResult } = await client.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(referral_code) as with_code,
                COUNT(*) - COUNT(referral_code) as without_code
            FROM clients
        `);

        console.log('\n' + '='.repeat(70));
        console.log('✅ ПРОВЕРКА БАЗЫ ДАННЫХ:');
        console.log('='.repeat(70));
        console.log(`📊 Всего клиентов: ${checkResult[0].total}`);
        console.log(`✅ С реферальным кодом: ${checkResult[0].with_code}`);
        console.log(`❌ Без реферального кода: ${checkResult[0].without_code}`);
        console.log('='.repeat(70));

        if (checkResult[0].without_code === '0') {
            console.log('\n🎉 ВСЕ КЛИЕНТЫ ПОЛУЧИЛИ РЕФЕРАЛЬНЫЕ КОДЫ!');
        }

    } catch (error) {
        console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Функция для проверки текущего состояния
 */
async function checkCurrentState() {
    const client = await pool.connect();
    
    try {
        const { rows } = await client.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(referral_code) as with_code,
                COUNT(*) - COUNT(referral_code) as without_code
            FROM clients
        `);

        console.log('\n' + '='.repeat(70));
        console.log('📊 ТЕКУЩЕЕ СОСТОЯНИЕ БАЗЫ ДАННЫХ:');
        console.log('='.repeat(70));
        console.log(`📊 Всего клиентов: ${rows[0].total}`);
        console.log(`✅ С реферальным кодом: ${rows[0].with_code}`);
        console.log(`❌ Без реферального кода: ${rows[0].without_code}`);
        console.log('='.repeat(70) + '\n');

        return rows[0];
    } finally {
        client.release();
    }
}

/**
 * Запуск скрипта
 */
async function main() {
    try {
        console.log('═'.repeat(70));
        console.log('🔧 СКРИПТ ГЕНЕРАЦИИ РЕФЕРАЛЬНЫХ КОДОВ');
        console.log('═'.repeat(70) + '\n');

        // Проверяем текущее состояние
        await checkCurrentState();

        // Генерируем коды
        await generateReferralCodesForExistingClients();

        console.log('\n✅ СКРИПТ УСПЕШНО ЗАВЕРШЕН!\n');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ ОШИБКА ВЫПОЛНЕНИЯ СКРИПТА:', error);
        process.exit(1);
    }
}

// Запускаем скрипт
if (require.main === module) {
    main();
}

module.exports = {
    generateReferralCode,
    generateUniqueCode,
    generateReferralCodesForExistingClients,
    checkCurrentState
};
