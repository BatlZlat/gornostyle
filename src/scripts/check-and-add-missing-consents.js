/**
 * Скрипт для проверки и добавления согласий клиентам, у которых их нет
 * 
 * Использование:
 * node src/scripts/check-and-add-missing-consents.js
 * 
 * Этот скрипт можно запускать периодически (например, через cron)
 * для проверки новых клиентов, зарегистрированных до деплоя новой версии
 */

const { Pool } = require('pg');

// Подключение к БД
const pool = new Pool({
    host: '90.156.210.24',
    port: 5432,
    database: 'skisimulator',
    user: 'batl-zlat',
    password: 'Nemezida2324%)',
    ssl: false
});

/**
 * Проверяет и добавляет согласия для клиентов без согласия
 */
async function checkAndAddMissingConsents() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Получаем активную политику
        const policyResult = await client.query(
            `SELECT id, version FROM privacy_policies 
             WHERE is_active = true 
             ORDER BY effective_date DESC 
             LIMIT 1`
        );
        
        if (policyResult.rows.length === 0) {
            console.error('❌ Ошибка: Не найдена активная политика конфиденциальности');
            await client.query('ROLLBACK');
            return { added: 0, error: 'No active policy found' };
        }
        
        const policy = policyResult.rows[0];
        
        // Находим клиентов без согласия
        const clientsResult = await client.query(
            `SELECT c.id, c.telegram_id, c.created_at
             FROM clients c
             WHERE NOT EXISTS (
                 SELECT 1 FROM privacy_consents pc
                 WHERE pc.client_id = c.id
                 AND pc.consent_type = 'registration'
                 AND pc.policy_id = $1
             )
             ORDER BY c.created_at DESC`,
            [policy.id]
        );
        
        const clients = clientsResult.rows;
        
        if (clients.length === 0) {
            console.log('✅ Все клиенты имеют согласие на обработку ПД');
            await client.query('COMMIT');
            return { added: 0, total: 0 };
        }
        
        console.log(`\n📊 Найдено клиентов без согласия: ${clients.length}`);
        
        let added = 0;
        let errors = [];
        
        // Добавляем согласие для каждого клиента
        for (const clientData of clients) {
            try {
                await client.query(
                    `INSERT INTO privacy_consents (client_id, policy_id, consent_type, telegram_id, consented_at, is_legacy)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (client_id, consent_type, policy_id) DO NOTHING`,
                    [
                        clientData.id,
                        policy.id,
                        'registration',
                        clientData.telegram_id,
                        clientData.created_at || new Date(),
                        true // Помечаем как legacy (добавлено после регистрации)
                    ]
                );
                added++;
                console.log(`  ✅ Добавлено согласие для клиента ID ${clientData.id} (${clientData.telegram_id})`);
            } catch (error) {
                errors.push({ clientId: clientData.id, error: error.message });
                console.error(`  ❌ Ошибка для клиента ID ${clientData.id}:`, error.message);
            }
        }
        
        await client.query('COMMIT');
        
        console.log(`\n✅ Результат:`);
        console.log(`   Добавлено согласий: ${added}`);
        if (errors.length > 0) {
            console.log(`   Ошибок: ${errors.length}`);
        }
        
        return { added, total: clients.length, errors };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при проверке согласий:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Показывает статистику
 */
async function showStatistics() {
    const client = await pool.connect();
    try {
        const stats = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM clients) as total_clients,
                (SELECT COUNT(DISTINCT client_id) FROM privacy_consents WHERE consent_type = 'registration') as clients_with_consent,
                (SELECT COUNT(*) FROM privacy_policies WHERE is_active = true) as active_policies
        `);
        
        const total = parseInt(stats.rows[0].total_clients);
        const withConsent = parseInt(stats.rows[0].clients_with_consent);
        const withoutConsent = total - withConsent;
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 СТАТИСТИКА:');
        console.log('='.repeat(70));
        console.log(`👥 Всего клиентов: ${total}`);
        console.log(`✅ С согласием: ${withConsent}`);
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
        console.log('🔍 Проверка согласий на обработку ПД...\n');
        
        // Показываем текущую статистику
        await showStatistics();
        
        // Проверяем и добавляем согласия
        const result = await checkAndAddMissingConsents();
        
        // Показываем финальную статистику
        if (result.added > 0) {
            await showStatistics();
        }
        
        console.log('✅ Проверка завершена!');
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

module.exports = { checkAndAddMissingConsents, showStatistics };

