/**
 * Скрипт для проверки и обновления реферальных статусов после тренировок
 * Этот скрипт можно запускать периодически (например, раз в день)
 * для проверки завершенных тренировок и начисления бонусов
 */

const { Pool } = require('pg');
const { updateReferralStatusOnTraining } = require('../services/referral-service');

const pool = new Pool({
    host: process.env.DB_HOST || '90.156.210.24',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'skisimulator',
    user: process.env.DB_USER || 'batl-zlat',
    password: process.env.DB_PASSWORD || 'Nemezida2324%)',
    ssl: false
});

/**
 * Проверка реферальных транзакций со статусом 'deposited'
 * и обновление их после первой тренировки
 */
async function processReferralTrainings() {
    try {
        console.log('🔍 Начинаем проверку реферальных транзакций...\n');

        // Получаем все реферальные транзакции со статусом 'deposited'
        const referralsResult = await pool.query(`
            SELECT rt.id, rt.referee_id, c.full_name
            FROM referral_transactions rt
            JOIN clients c ON rt.referee_id = c.id
            WHERE rt.status = 'deposited'
        `);

        if (referralsResult.rows.length === 0) {
            console.log('✅ Нет реферальных транзакций ожидающих первой тренировки');
            return;
        }

        console.log(`📊 Найдено ${referralsResult.rows.length} реферальных транзакций со статусом 'deposited'\n`);

        let processedCount = 0;
        let skippedCount = 0;

        for (const referral of referralsResult.rows) {
            console.log(`\n👤 Проверяем клиента: ${referral.full_name} (ID: ${referral.referee_id})`);

            // Проверяем, были ли у клиента тренировки
            const groupTrainingsResult = await pool.query(`
                SELECT COUNT(*) as count 
                FROM session_participants 
                WHERE client_id = $1 
                AND status IN ('confirmed', 'completed')
            `, [referral.referee_id]);

            const individualTrainingsResult = await pool.query(`
                SELECT COUNT(*) as count 
                FROM individual_training_sessions 
                WHERE client_id = $1
            `, [referral.referee_id]);

            const totalTrainings = 
                parseInt(groupTrainingsResult.rows[0].count) + 
                parseInt(individualTrainingsResult.rows[0].count);

            console.log(`   📝 Всего тренировок: ${totalTrainings}`);
            console.log(`      - Групповых: ${groupTrainingsResult.rows[0].count}`);
            console.log(`      - Индивидуальных: ${individualTrainingsResult.rows[0].count}`);

            if (totalTrainings > 0) {
                console.log(`   ✅ Клиент прошел тренировку! Обновляем статус и начисляем бонусы...`);
                
                try {
                    await updateReferralStatusOnTraining(referral.referee_id);
                    processedCount++;
                    console.log(`   💰 Бонусы успешно начислены!`);
                } catch (error) {
                    console.error(`   ❌ Ошибка при обработке: ${error.message}`);
                }
            } else {
                console.log(`   ⏳ Клиент еще не прошел тренировку, пропускаем`);
                skippedCount++;
            }
        }

        console.log('\n' + '='.repeat(70));
        console.log('📊 ИТОГОВАЯ СТАТИСТИКА:');
        console.log('='.repeat(70));
        console.log(`✅ Обработано: ${processedCount}`);
        console.log(`⏳ Пропущено: ${skippedCount}`);
        console.log(`📈 Всего проверено: ${referralsResult.rows.length}`);
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Ошибка при обработке реферальных транзакций:', error);
        throw error;
    }
}

/**
 * Главная функция
 */
async function main() {
    try {
        console.log('═'.repeat(70));
        console.log('🎁 ПРОВЕРКА РЕФЕРАЛЬНЫХ БОНУСОВ');
        console.log('═'.repeat(70) + '\n');

        await processReferralTrainings();

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
    processReferralTrainings
};
