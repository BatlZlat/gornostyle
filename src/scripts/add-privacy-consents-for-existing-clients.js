/**
 * Скрипт для массового добавления согласий на обработку ПД для существующих клиентов
 * 
 * Использование:
 * node src/scripts/add-privacy-consents-for-existing-clients.js
 * 
 * Подключение к БД через переменные окружения из .env
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
 * Получает или создает активную политику конфиденциальности
 */
async function getOrCreateActivePolicy() {
    const client = await pool.connect();
    try {
        // Проверяем, есть ли активная политика
        const result = await client.query(
            `SELECT id, version FROM privacy_policies 
             WHERE is_active = true 
             ORDER BY effective_date DESC 
             LIMIT 1`
        );
        
        if (result.rows.length > 0) {
            console.log(`✅ Найдена активная политика: версия ${result.rows[0].version}, ID: ${result.rows[0].id}`);
            return result.rows[0];
        }
        
        // Если нет активной политики, создаем начальную версию
        console.log('⚠️ Активная политика не найдена. Создаем начальную версию...');
        
        const insertResult = await client.query(
            `INSERT INTO privacy_policies (version, title, content, is_active, effective_date)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, version`,
            [
                '1.0',
                'Политика конфиденциальности',
                'Политика конфиденциальности и обработки персональных данных. Подробная информация доступна на странице /privacy-policy',
                true,
                new Date()
            ]
        );
        
        console.log(`✅ Создана начальная политика: версия ${insertResult.rows[0].version}, ID: ${insertResult.rows[0].id}`);
        return insertResult.rows[0];
    } finally {
        client.release();
    }
}

/**
 * Добавляет согласия для всех существующих клиентов
 */
async function addConsentsForExistingClients() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Получаем активную политику
        const policy = await getOrCreateActivePolicy();
        
        // Получаем всех клиентов, у которых еще нет согласия
        const clientsResult = await client.query(
            `SELECT c.id, c.telegram_id, c.created_at
             FROM clients c
             WHERE NOT EXISTS (
                 SELECT 1 FROM privacy_consents pc
                 WHERE pc.client_id = c.id
                 AND pc.consent_type = 'registration'
                 AND pc.policy_id = $1
             )
             ORDER BY c.id`,
            [policy.id]
        );
        
        const clients = clientsResult.rows;
        console.log(`\n📊 Найдено клиентов без согласия: ${clients.length}`);
        
        if (clients.length === 0) {
            console.log('✅ Все клиенты уже имеют согласие на обработку ПД');
            await client.query('COMMIT');
            return { added: 0, skipped: 0 };
        }
        
        let added = 0;
        let skipped = 0;
        
        // Добавляем согласие для каждого клиента
        for (const clientData of clients) {
            try {
                await client.query(
                    `INSERT INTO privacy_consents (client_id, policy_id, consent_type, telegram_id, consented_at, is_legacy)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        clientData.id,
                        policy.id,
                        'registration',
                        clientData.telegram_id,
                        clientData.created_at || new Date(), // Используем дату регистрации клиента
                        true // Помечаем как legacy (старое согласие)
                    ]
                );
                added++;
            } catch (error) {
                if (error.code === '23505') { // Unique violation
                    console.log(`⚠️ Согласие для клиента ID ${clientData.id} уже существует, пропускаем`);
                    skipped++;
                } else {
                    console.error(`❌ Ошибка при добавлении согласия для клиента ID ${clientData.id}:`, error.message);
                    throw error;
                }
            }
        }
        
        await client.query('COMMIT');
        
        console.log(`\n✅ Результат:`);
        console.log(`   Добавлено согласий: ${added}`);
        console.log(`   Пропущено (уже есть): ${skipped}`);
        
        return { added, skipped };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Проверяет текущее состояние
 */
async function checkCurrentState() {
    const client = await pool.connect();
    try {
        const stats = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM clients) as total_clients,
                (SELECT COUNT(*) FROM privacy_consents WHERE consent_type = 'registration') as clients_with_consent,
                (SELECT COUNT(*) FROM privacy_policies WHERE is_active = true) as active_policies
        `);
        
        const total = parseInt(stats.rows[0].total_clients);
        const withConsent = parseInt(stats.rows[0].clients_with_consent);
        const withoutConsent = total - withConsent;
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 ТЕКУЩЕЕ СОСТОЯНИЕ:');
        console.log('='.repeat(70));
        console.log(`👥 Всего клиентов: ${total}`);
        console.log(`✅ С согласием на обработку ПД: ${withConsent}`);
        console.log(`❌ Без согласия: ${withoutConsent}`);
        console.log(`📋 Активных политик: ${stats.rows[0].active_policies}`);
        console.log('='.repeat(70) + '\n');
        
        return { total, withConsent, withoutConsent };
    } finally {
        client.release();
    }
}

/**
 * Главная функция
 */
async function main() {
    try {
        console.log('🚀 Запуск скрипта добавления согласий для существующих клиентов...\n');
        
        // Проверяем текущее состояние
        await checkCurrentState();
        
        // Добавляем согласия
        const result = await addConsentsForExistingClients();
        
        // Проверяем результат
        await checkCurrentState();
        
        console.log('✅ Скрипт успешно завершен!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка при выполнении скрипта:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Запуск скрипта
if (require.main === module) {
    main();
}

module.exports = {
    addConsentsForExistingClients,
    getOrCreateActivePolicy,
    checkCurrentState
};

