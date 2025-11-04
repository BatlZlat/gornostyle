/**
 * Сервис для работы с реферальной системой
 * Отслеживание статусов и начисление бонусов
 */

const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || '90.156.210.24',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'skisimulator',
    user: process.env.DB_USER || 'batl-zlat',
    password: process.env.DB_PASSWORD || 'Nemezida2324%)',
    ssl: false
});

/**
 * Обновление статуса реферальной транзакции при пополнении баланса
 * @param {number} clientId - ID клиента, который пополнил баланс
 * @param {number} amount - Сумма пополнения
 */
async function updateReferralStatusOnDeposit(clientId, amount) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Проверяем, есть ли реферальная транзакция для этого клиента (он referee)
        const referralResult = await client.query(`
            SELECT rt.id, rt.referrer_id, rt.referee_id, rt.status, 
                   c1.full_name as referrer_name, c2.full_name as referee_name
            FROM referral_transactions rt
            JOIN clients c1 ON rt.referrer_id = c1.id
            JOIN clients c2 ON rt.referee_id = c2.id
            WHERE rt.referee_id = $1 
            AND rt.status = 'registered'
        `, [clientId]);
        
        if (referralResult.rows.length > 0) {
            const referral = referralResult.rows[0];
            
            // Обновляем статус на 'deposited'
            await client.query(`
                UPDATE referral_transactions 
                SET status = 'deposited' 
                WHERE id = $1
            `, [referral.id]);
            
            console.log(`✅ Реферальный статус обновлен на 'deposited' для клиента ${clientId} (${referral.referee_name})`);
            console.log(`   Пригласил: ${referral.referrer_name} (ID: ${referral.referrer_id})`);
            console.log(`   Сумма пополнения: ${amount}₽`);
        }
        
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении реферального статуса (deposit):', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Обновление статуса реферальной транзакции после первой тренировки
 * @param {number} clientId - ID клиента, который прошел тренировку
 */
async function updateReferralStatusOnTraining(clientId) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Проверяем, есть ли реферальная транзакция для этого клиента со статусом 'deposited'
        const referralResult = await client.query(`
            SELECT rt.id, rt.referrer_id, rt.referee_id, rt.status,
                   rt.referrer_bonus, rt.referee_bonus,
                   c1.full_name as referrer_name, c1.telegram_id as referrer_telegram_id,
                   c2.full_name as referee_name, c2.telegram_id as referee_telegram_id
            FROM referral_transactions rt
            JOIN clients c1 ON rt.referrer_id = c1.id
            JOIN clients c2 ON rt.referee_id = c2.id
            WHERE rt.referee_id = $1 
            AND rt.status = 'deposited'
        `, [clientId]);
        
        if (referralResult.rows.length > 0) {
            const referral = referralResult.rows[0];
            
            // Обновляем статус на 'trained'
            await client.query(`
                UPDATE referral_transactions 
                SET status = 'trained' 
                WHERE id = $1
            `, [referral.id]);
            
            console.log(`✅ Реферальный статус обновлен на 'trained' для клиента ${clientId} (${referral.referee_name})`);
            console.log(`   Готово к начислению бонусов!`);
            
            // Теперь начисляем бонусы обоим пользователям
            await awardReferralBonuses(referral, client);
        }
        
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении реферального статуса (training):', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Начисление реферального бонуса пригласившему после первой тренировки приглашенного
 * Приглашенный уже получил бонус при регистрации, поэтому здесь начисляем только пригласившему
 * @param {Object} referral - Объект реферальной транзакции
 * @param {Object} dbClient - Клиент подключения к БД (для транзакции)
 */
async function awardReferralBonuses(referral, dbClient) {
    try {
        console.log('💰 Начинаем начисление реферального бонуса пригласившему...');
        
        // Получаем кошелек пригласившего
        const referrerWalletResult = await dbClient.query(
            'SELECT id, balance FROM wallets WHERE client_id = $1',
            [referral.referrer_id]
        );
        
        if (referrerWalletResult.rows.length === 0) {
            throw new Error('Кошелек не найден для пригласившего');
        }
        
        const referrerWallet = referrerWalletResult.rows[0];
        
        // Получаем сумму бонуса из настроек или используем дефолтную
        const bonusSettingsResult = await dbClient.query(
            `SELECT bonus_amount FROM bonus_settings 
             WHERE bonus_type = 'referral' AND is_active = TRUE 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        const referrerBonus = bonusSettingsResult.rows.length > 0 
            ? bonusSettingsResult.rows[0].bonus_amount 
            : (referral.referrer_bonus || 500.00);
        
        // Начисляем бонус только пригласившему
        await dbClient.query(`
            UPDATE wallets 
            SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
            WHERE id = $2
        `, [referrerBonus, referrerWallet.id]);
        
        await dbClient.query(`
            INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ($1, $2, 'bonus', $3)
        `, [
            referrerWallet.id, 
            referrerBonus, 
            `Реферальный бонус за приглашение друга (${referral.referee_name})`
        ]);
        
        console.log(`   ✅ Начислено ${referrerBonus}₽ пригласившему: ${referral.referrer_name}`);
        console.log(`   ℹ️ Приглашенный уже получил бонус при регистрации`);
        
        // Обновляем статус транзакции на 'completed'
        // Проверяем наличие колонок в таблице для совместимости
        const columnsCheck = await dbClient.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'referral_transactions' 
            AND column_name IN ('referrer_bonus_paid', 'completed_at')
        `);
        
        const hasReferrerBonusPaid = columnsCheck.rows.some(r => r.column_name === 'referrer_bonus_paid');
        const hasCompletedAt = columnsCheck.rows.some(r => r.column_name === 'completed_at');
        
        let updateQuery;
        let updateParams;
        
        if (hasReferrerBonusPaid && hasCompletedAt) {
            // Новая структура с referrer_bonus_paid и completed_at
            updateQuery = `UPDATE referral_transactions 
                          SET status = 'completed',
                              referrer_bonus_paid = TRUE,
                              referrer_bonus = $1,
                              completed_at = CURRENT_TIMESTAMP
                          WHERE id = $2`;
            updateParams = [referrerBonus, referral.id];
        } else if (hasCompletedAt) {
            // Структура с completed_at, но без referrer_bonus_paid
            updateQuery = `UPDATE referral_transactions 
                          SET status = 'completed',
                              referrer_bonus = $1,
                              completed_at = CURRENT_TIMESTAMP
                          WHERE id = $2`;
            updateParams = [referrerBonus, referral.id];
        } else {
            // Старая структура без referrer_bonus_paid и completed_at
            updateQuery = `UPDATE referral_transactions 
                          SET status = 'completed',
                              referrer_bonus = $1
                          WHERE id = $2`;
            updateParams = [referrerBonus, referral.id];
        }
        
        await dbClient.query(updateQuery, updateParams);
        
        console.log(`   ✅ Реферальная транзакция завершена успешно!`);
        
        // Отправляем уведомление пригласившему о начислении бонуса
        try {
            if (referral.referrer_telegram_id) {
                const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
                if (TELEGRAM_BOT_TOKEN) {
                    const bonusAmount = Math.round(referrerBonus);
                    const message = `🎉 *Отличные новости!*\n\nВаш реферал *${referral.referee_name}* прошел первую тренировку!\n\n✅ Вам начислено *${bonusAmount}₽* на баланс.\n\nСпасибо за приглашение! Приглашайте больше друзей и получайте больше бонусов. 🎁`;
                    
                    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: referral.referrer_telegram_id,
                            text: message,
                            parse_mode: 'Markdown'
                        })
                    });
                    console.log(`   ✅ Отправлено уведомление пригласившему (ID: ${referral.referrer_id}) о начислении бонуса`);
                }
            }
        } catch (notificationError) {
            console.error('   ⚠️ Ошибка при отправке уведомления пригласившему о бонусе:', notificationError);
            // Не прерываем процесс, если уведомление не отправилось
        }
        
        // Создаем запись в bonus_transactions для отслеживания
        const bonusSettingResult = await dbClient.query(
            `SELECT id FROM bonus_settings WHERE bonus_type = 'referral' AND is_active = TRUE LIMIT 1`
        );
        
        if (bonusSettingResult.rows.length > 0) {
            const bonusSettingId = bonusSettingResult.rows[0].id;
            
            // Запись только для пригласившего (приглашенный уже получил бонус при регистрации)
            await dbClient.query(`
                INSERT INTO bonus_transactions (client_id, bonus_setting_id, amount, description, status, approved_at)
                VALUES ($1, $2, $3, $4, 'approved', CURRENT_TIMESTAMP)
            `, [
                referral.referrer_id,
                bonusSettingId,
                referrerBonus,
                `Реферальный бонус за приглашение ${referral.referee_name}`
            ]);
        }
        
        return {
            success: true,
            referrer: {
                id: referral.referrer_id,
                name: referral.referrer_name,
                telegram_id: referral.referrer_telegram_id,
                bonus: referrerBonus
            },
            referee: {
                id: referral.referee_id,
                name: referral.referee_name,
                telegram_id: referral.referee_telegram_id,
                bonus: 0 // Приглашенный уже получил бонус при регистрации
            }
        };
    } catch (error) {
        console.error('❌ Ошибка при начислении реферального бонуса пригласившему:', error);
        throw error;
    }
}

/**
 * Проверка, была ли это первая тренировка клиента
 * @param {number} clientId - ID клиента
 * @returns {boolean} - true если это первая тренировка
 */
async function isFirstTraining(clientId) {
    try {
        // Проверяем групповые тренировки
        const groupTrainingsResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM session_participants 
            WHERE client_id = $1 
            AND status IN ('confirmed', 'completed')
        `, [clientId]);
        
        // Проверяем индивидуальные тренировки
        const individualTrainingsResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM individual_training_sessions 
            WHERE client_id = $1
        `, [clientId]);
        
        const totalTrainings = 
            parseInt(groupTrainingsResult.rows[0].count) + 
            parseInt(individualTrainingsResult.rows[0].count);
        
        return totalTrainings === 1; // Первая тренировка
    } catch (error) {
        console.error('Ошибка при проверке первой тренировки:', error);
        return false;
    }
}

/**
 * Получение статистики реферальной программы
 * @returns {Object} - Статистика
 */
async function getReferralStats() {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_referrals,
                COUNT(*) FILTER (WHERE status = 'registered') as registered,
                COUNT(*) FILTER (WHERE status = 'deposited') as deposited,
                COUNT(*) FILTER (WHERE status = 'trained') as trained,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                SUM(CASE WHEN status = 'completed' THEN referrer_bonus + referee_bonus ELSE 0 END) as total_bonuses_paid
            FROM referral_transactions
        `);
        
        return stats.rows[0];
    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        throw error;
    }
}

module.exports = {
    updateReferralStatusOnDeposit,
    updateReferralStatusOnTraining,
    isFirstTraining,
    getReferralStats,
    awardReferralBonuses
};
