/**
 * Скрипт для тестирования реферальной системы
 */

const { Pool } = require('pg');

const pool = new Pool({
    host: '90.156.210.24',
    port: 5432,
    database: 'skisimulator',
    user: 'batl-zlat',
    password: 'Nemezida2324%)',
    ssl: false
});

async function testReferralSystem() {
    try {
        console.log('🔍 Тестирование реферальной системы...\n');

        // 1. Проверяем клиентов с реферальными кодами
        console.log('1️⃣ Клиенты с реферальными кодами:');
        const clientsResult = await pool.query(`
            SELECT id, full_name, referral_code, telegram_id 
            FROM clients 
            WHERE referral_code IS NOT NULL 
            ORDER BY id 
            LIMIT 5
        `);
        
        if (clientsResult.rows.length > 0) {
            clientsResult.rows.forEach(client => {
                console.log(`   👤 ${client.full_name} (ID: ${client.id})`);
                console.log(`      📱 Telegram: ${client.telegram_id}`);
                console.log(`      🔗 Код: ${client.referral_code}`);
                console.log(`      🔗 Ссылка: https://t.me/Ski_Instruktor72_bot?start=${client.referral_code}`);
                console.log('');
            });
        } else {
            console.log('   ❌ Нет клиентов с реферальными кодами');
        }

        // 2. Проверяем настройки бонусов
        console.log('2️⃣ Настройки реферальных бонусов:');
        const bonusResult = await pool.query(`
            SELECT bonus_type, bonus_amount, is_active, description 
            FROM bonus_settings 
            WHERE bonus_type = 'referral'
        `);
        
        if (bonusResult.rows.length > 0) {
            bonusResult.rows.forEach(bonus => {
                console.log(`   💰 Тип: ${bonus.bonus_type}`);
                console.log(`   💵 Сумма: ${bonus.bonus_amount}₽`);
                console.log(`   ✅ Активен: ${bonus.is_active ? 'Да' : 'Нет'}`);
                console.log(`   📝 Описание: ${bonus.description}`);
                console.log('');
            });
        } else {
            console.log('   ❌ Настройки реферальных бонусов не найдены');
        }

        // 3. Проверяем реферальные транзакции
        console.log('3️⃣ Реферальные транзакции:');
        const referralsResult = await pool.query(`
            SELECT rt.id, rt.status, rt.referrer_bonus, rt.referee_bonus,
                   c1.full_name as referrer_name, c2.full_name as referee_name
            FROM referral_transactions rt
            JOIN clients c1 ON rt.referrer_id = c1.id
            JOIN clients c2 ON rt.referee_id = c2.id
            ORDER BY rt.created_at DESC
            LIMIT 5
        `);
        
        if (referralsResult.rows.length > 0) {
            referralsResult.rows.forEach(ref => {
                console.log(`   🔗 ID: ${ref.id}`);
                console.log(`   👤 Пригласил: ${ref.referrer_name}`);
                console.log(`   👤 Приглашен: ${ref.referee_name}`);
                console.log(`   📊 Статус: ${ref.status}`);
                console.log(`   💰 Бонус пригласившему: ${ref.referrer_bonus}₽`);
                console.log(`   💰 Бонус приглашенному: ${ref.referee_bonus}₽`);
                console.log('');
            });
        } else {
            console.log('   ❌ Реферальные транзакции не найдены');
        }

        // 4. Проверяем таблицы
        console.log('4️⃣ Проверка таблиц:');
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('referral_transactions', 'bonus_settings', 'bonus_transactions')
            ORDER BY table_name
        `);
        
        console.log('   📋 Найденные таблицы:');
        tablesResult.rows.forEach(table => {
            console.log(`      ✅ ${table.table_name}`);
        });

        console.log('\n✅ Тестирование завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await pool.end();
    }
}

testReferralSystem();
