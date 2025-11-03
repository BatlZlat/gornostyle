const { pool } = require('../db/index');

/**
 * Проверяет и использует абонемент для клиента при записи на зимнюю групповую тренировку
 * @param {number} clientId - ID клиента
 * @param {number} trainingSessionId - ID тренировки
 * @returns {Promise<{useSubscription: boolean, subscription: object|null, subscriptionUsage: object|null}>}
 */
async function checkAndUseSubscription(clientId, trainingSessionId) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Получаем активные абонементы клиента
        const subscriptionsResult = await client.query(
            `SELECT 
                ns.*,
                st.name as subscription_name,
                st.price_per_session
             FROM natural_slope_subscriptions ns
             JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
             WHERE ns.client_id = $1
                AND ns.status = 'active'
                AND ns.remaining_sessions > 0
                AND ns.expires_at >= CURRENT_DATE
             ORDER BY ns.expires_at ASC, ns.purchased_at ASC
             LIMIT 1`,
            [clientId]
        );

        if (subscriptionsResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return { useSubscription: false, subscription: null, subscriptionUsage: null };
        }

        const subscription = subscriptionsResult.rows[0];

        // Получаем информацию о тренировке
        const trainingResult = await client.query(
            `SELECT 
                ts.*,
                g.name as group_name
             FROM training_sessions ts
             LEFT JOIN groups g ON ts.group_id = g.id
             WHERE ts.id = $1`,
            [trainingSessionId]
        );

        if (trainingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            throw new Error('Тренировка не найдена');
        }

        const training = trainingResult.rows[0];

        // Проверяем, что это групповая зимняя тренировка
        if (training.slope_type !== 'natural_slope' || training.winter_training_type !== 'group') {
            await client.query('ROLLBACK');
            return { useSubscription: false, subscription: null, subscriptionUsage: null };
        }

        // Списываем одно занятие из абонемента
        await client.query(
            `UPDATE natural_slope_subscriptions 
             SET remaining_sessions = remaining_sessions - 1,
                 status = CASE 
                    WHEN remaining_sessions - 1 = 0 THEN 'used'
                    ELSE 'active'
                 END
             WHERE id = $1`,
            [subscription.id]
        );

        // Записываем использование абонемента
        const usageResult = await client.query(
            `INSERT INTO natural_slope_subscription_usage (
                subscription_id, training_session_id, original_price, 
                subscription_price, savings, used_at
            )
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            RETURNING *`,
            [
                subscription.id,
                trainingSessionId,
                training.price,
                subscription.price_per_session,
                training.price - subscription.price_per_session
            ]
        );

        await client.query('COMMIT');

        return {
            useSubscription: true,
            subscription: {
                ...subscription,
                remaining_sessions: subscription.remaining_sessions - 1
            },
            subscriptionUsage: usageResult.rows[0]
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Возвращает занятие в абонемент при отмене тренировки
 * @param {number} trainingSessionId - ID тренировки
 * @returns {Promise<boolean>}
 */
async function returnSubscriptionSession(trainingSessionId) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Находим запись использования абонемента
        const usageResult = await client.query(
            `SELECT * FROM natural_slope_subscription_usage 
             WHERE training_session_id = $1`,
            [trainingSessionId]
        );

        if (usageResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return false; // Абонемент не использовался
        }

        const usage = usageResult.rows[0];

        // Возвращаем занятие в абонемент
        await client.query(
            `UPDATE natural_slope_subscriptions 
             SET remaining_sessions = remaining_sessions + 1,
                 status = CASE 
                    WHEN expires_at >= CURRENT_DATE THEN 'active'
                    ELSE status
                 END
             WHERE id = $1`,
            [usage.subscription_id]
        );

        // Удаляем запись использования
        await client.query(
            `DELETE FROM natural_slope_subscription_usage 
             WHERE id = $1`,
            [usage.id]
        );

        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Проверяет, используется ли абонемент для данной тренировки
 * @param {number} trainingSessionId - ID тренировки
 * @returns {Promise<{usedSubscription: boolean, subscriptionInfo: object|null}>}
 */
async function checkTrainingSubscriptionUsage(trainingSessionId) {
    try {
        const result = await pool.query(
            `SELECT 
                nsu.*,
                ns.remaining_sessions + 1 as original_remaining,
                ns.client_id,
                st.name as subscription_name
             FROM natural_slope_subscription_usage nsu
             JOIN natural_slope_subscriptions ns ON nsu.subscription_id = ns.id
             JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
             WHERE nsu.training_session_id = $1`,
            [trainingSessionId]
        );

        if (result.rows.length === 0) {
            return { usedSubscription: false, subscriptionInfo: null };
        }

        return {
            usedSubscription: true,
            subscriptionInfo: result.rows[0]
        };
    } catch (error) {
        console.error('Ошибка при проверке использования абонемента:', error);
        return { usedSubscription: false, subscriptionInfo: null };
    }
}

module.exports = {
    checkAndUseSubscription,
    returnSubscriptionSession,
    checkTrainingSubscriptionUsage
};

