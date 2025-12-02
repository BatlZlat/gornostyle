const express = require('express');
const { pool } = require('../db');
const { verifyToken } = require('../middleware/auth');
const moment = require('moment-timezone');

const router = express.Router();
const TIMEZONE = 'Europe/Moscow';

// Все маршруты требуют авторизации
router.use(verifyToken);

/**
 * GET /api/analytics/attendance
 * График посещаемости клиентов
 * Query params: period (current_month, last_month, last_3_months, last_6_months, year, all_time), from, to
 */
router.get('/attendance', async (req, res) => {
    try {
        const { period, from, to } = req.query;
        
        let dateCondition = '';
        let queryParams = [];
        
        if (period === 'custom' && from && to) {
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [from, to];
        } else if (period === 'current_month') {
            const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
            const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfMonth, endOfMonth];
        } else if (period === 'last_month') {
            const startOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
            const endOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfLastMonth, endOfLastMonth];
        } else if (period === 'last_3_months') {
            const startDate = moment().tz(TIMEZONE).subtract(3, 'months').startOf('month').format('YYYY-MM-DD');
            const endDate = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startDate, endDate];
        } else if (period === 'last_6_months') {
            const startDate = moment().tz(TIMEZONE).subtract(6, 'months').startOf('month').format('YYYY-MM-DD');
            const endDate = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startDate, endDate];
        } else if (period === 'year') {
            const startOfYear = moment().tz(TIMEZONE).startOf('year').format('YYYY-MM-DD');
            const endOfYear = moment().tz(TIMEZONE).endOf('year').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfYear, endOfYear];
        }
        // all_time - без ограничения по дате

        // Посещаемость по дням (для графика)
        const dailyAttendanceQuery = `
            SELECT 
                DATE(session_date) as date,
                COUNT(DISTINCT CASE WHEN booking_type = 'group' THEN group_training_id ELSE id END) as trainings_count,
                COUNT(DISTINCT client_id) as unique_clients,
                COUNT(DISTINCT CASE WHEN child_id IS NOT NULL THEN child_id END) as children_count
            FROM (
                -- Участники тренировок на тренажере (индивидуальные и групповые)
                SELECT 
                    ts.session_date,
                    ts.id,
                    CASE WHEN ts.training_type THEN ts.id ELSE NULL END as group_training_id,
                    CASE WHEN ts.training_type THEN 'group' ELSE 'individual' END as booking_type,
                    tsp.client_id,
                    tsp.child_id
                FROM training_sessions ts
                JOIN training_session_participants tsp ON ts.id = tsp.training_session_id
                WHERE ts.status = 'completed'
                  AND (ts.slope_type = 'simulator' OR ts.slope_type IS NULL)
                ${dateCondition.replace('session_date', 'ts.session_date')}
                
                UNION ALL
                
                -- Индивидуальные зимние тренировки (Кулига)
                SELECT 
                    kb.date as session_date,
                    kb.id,
                    NULL as group_training_id,
                    'individual' as booking_type,
                    kb.client_id,
                    kb.child_id
                FROM kuliga_bookings kb
                WHERE kb.status = 'completed'
                ${dateCondition.replace('session_date', 'kb.date')}
                
                UNION ALL
                
                -- Групповые зимние тренировки (Кулига)
                SELECT 
                    kb.date as session_date,
                    NULL as id,
                    kb.group_training_id,
                    'group' as booking_type,
                    kb.client_id,
                    kb.child_id
                FROM kuliga_bookings kb
                WHERE kb.status = 'completed'
                  AND kb.group_training_id IS NOT NULL
                ${dateCondition.replace('session_date', 'kb.date')}
            ) all_trainings
            GROUP BY DATE(session_date)
            ORDER BY date ASC
        `;

        const dailyResult = await pool.query(dailyAttendanceQuery, queryParams);

        // Общая статистика
        const totalStatsQuery = `
            SELECT 
                COUNT(DISTINCT CASE WHEN booking_type = 'group' THEN group_training_id ELSE id END) as total_trainings,
                COUNT(DISTINCT client_id) as total_unique_clients,
                COUNT(DISTINCT CASE WHEN child_id IS NOT NULL THEN child_id END) as total_children
            FROM (
                SELECT 
                    ts.id,
                    CASE WHEN ts.training_type THEN ts.id ELSE NULL END as group_training_id,
                    CASE WHEN ts.training_type THEN 'group' ELSE 'individual' END as booking_type,
                    tsp.client_id,
                    tsp.child_id
                FROM training_sessions ts
                JOIN training_session_participants tsp ON ts.id = tsp.training_session_id
                WHERE ts.status = 'completed'
                  AND (ts.slope_type = 'simulator' OR ts.slope_type IS NULL)
                ${dateCondition.replace('session_date', 'ts.session_date')}
                
                UNION ALL
                
                SELECT 
                    kb.id,
                    NULL as group_training_id,
                    'individual' as booking_type,
                    kb.client_id,
                    kb.child_id
                FROM kuliga_bookings kb
                WHERE kb.status = 'completed'
                  AND kb.booking_type = 'individual'
                ${dateCondition.replace('session_date', 'kb.date')}
                
                UNION ALL
                
                SELECT 
                    kb.id,
                    kb.group_training_id,
                    'group' as booking_type,
                    kb.client_id,
                    kb.child_id
                FROM kuliga_bookings kb
                WHERE kb.status = 'completed'
                  AND kb.booking_type = 'group'
                  AND kb.group_training_id IS NOT NULL
                ${dateCondition.replace('session_date', 'kb.date')}
            ) all_trainings
        `;

        const totalStatsResult = await pool.query(totalStatsQuery, queryParams);

        res.json({
            success: true,
            daily: dailyResult.rows,
            totals: totalStatsResult.rows[0]
        });
    } catch (error) {
        console.error('Ошибка получения статистики посещаемости:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка получения статистики посещаемости' 
        });
    }
});

/**
 * GET /api/analytics/trainers
 * Статистика по тренерам
 * Query params: period (current_month, last_month, year, all_time), from, to
 */
router.get('/trainers', async (req, res) => {
    try {
        const { period, from, to } = req.query;
        
        let dateCondition = '';
        let queryParams = [];
        
        if (period === 'custom' && from && to) {
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [from, to];
        } else if (period === 'current_month') {
            const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
            const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfMonth, endOfMonth];
        } else if (period === 'last_month') {
            const startOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
            const endOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfLastMonth, endOfLastMonth];
        } else if (period === 'year') {
            const startOfYear = moment().tz(TIMEZONE).startOf('year').format('YYYY-MM-DD');
            const endOfYear = moment().tz(TIMEZONE).endOf('year').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfYear, endOfYear];
        }

        // Статистика по тренерам тренажера
        const simulatorTrainersQuery = `
            SELECT 
                t.id,
                t.full_name,
                COUNT(DISTINCT CASE WHEN ts.training_type = false OR ts.training_type IS NULL THEN ts.id END) as individual_trainings,
                COUNT(DISTINCT CASE WHEN ts.training_type = true THEN ts.id END) as group_trainings,
                COUNT(DISTINCT ts.id) as total_trainings,
                COUNT(DISTINCT tsp.client_id) as unique_clients
            FROM trainers t
            LEFT JOIN training_sessions ts ON t.id = ts.trainer_id 
                AND ts.status = 'completed'
                AND (ts.slope_type = 'simulator' OR ts.slope_type IS NULL)
                ${dateCondition.replace('session_date', 'ts.session_date')}
            LEFT JOIN training_session_participants tsp ON ts.id = tsp.training_session_id
            GROUP BY t.id, t.full_name
            HAVING COUNT(DISTINCT ts.id) > 0
            ORDER BY total_trainings DESC
        `;

        const simulatorResult = await pool.query(simulatorTrainersQuery, queryParams);

        // Статистика по инструкторам Кулиги
        const kuligaInstructorsQuery = `
            SELECT 
                ki.id,
                ki.full_name,
                ki.location,
                COUNT(DISTINCT CASE 
                    WHEN kb.booking_type = 'individual' THEN kb.id
                    WHEN kb.booking_type = 'group' THEN kb.group_training_id
                END) as total_trainings,
                COUNT(DISTINCT CASE WHEN kb.booking_type = 'individual' THEN kb.id END) as individual_trainings,
                COUNT(DISTINCT CASE WHEN kb.booking_type = 'group' THEN kb.group_training_id END) as group_trainings,
                COUNT(DISTINCT kb.client_id) as unique_clients,
                COALESCE(SUM(kb.price_total), 0) as total_revenue,
                COALESCE(SUM(kb.price_total * (1 - ki.admin_percentage / 100)), 0) as instructor_earnings
            FROM kuliga_instructors ki
            LEFT JOIN kuliga_bookings kb ON (
                (kb.booking_type = 'individual' AND kb.instructor_id = ki.id)
                OR (kb.booking_type = 'group' AND EXISTS (
                    SELECT 1 FROM kuliga_group_trainings kgt 
                    WHERE kgt.id = kb.group_training_id AND kgt.instructor_id = ki.id
                ))
            )
            AND kb.status = 'completed'
            ${dateCondition.replace('session_date', 'kb.date')}
            GROUP BY ki.id, ki.full_name, ki.location
            HAVING COUNT(DISTINCT CASE 
                WHEN kb.booking_type = 'individual' THEN kb.id
                WHEN kb.booking_type = 'group' THEN kb.group_training_id
            END) > 0
            ORDER BY total_trainings DESC
        `;

        const kuligaResult = await pool.query(kuligaInstructorsQuery, queryParams);

        res.json({
            success: true,
            simulator: simulatorResult.rows,
            kuliga: kuligaResult.rows
        });
    } catch (error) {
        console.error('Ошибка получения статистики по тренерам:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка получения статистики по тренерам' 
        });
    }
});

/**
 * GET /api/analytics/training-types
 * Отчеты по типам тренировок
 * Query params: period (current_month, last_month, year, all_time), from, to
 */
router.get('/training-types', async (req, res) => {
    try {
        const { period, from, to } = req.query;
        
        let dateCondition = '';
        let queryParams = [];
        
        if (period === 'custom' && from && to) {
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [from, to];
        } else if (period === 'current_month') {
            const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
            const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfMonth, endOfMonth];
        } else if (period === 'last_month') {
            const startOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
            const endOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfLastMonth, endOfLastMonth];
        } else if (period === 'year') {
            const startOfYear = moment().tz(TIMEZONE).startOf('year').format('YYYY-MM-DD');
            const endOfYear = moment().tz(TIMEZONE).endOf('year').format('YYYY-MM-DD');
            dateCondition = `AND session_date >= $1 AND session_date <= $2`;
            queryParams = [startOfYear, endOfYear];
        }

        // Статистика по типам тренировок
        const typesQuery = `
            SELECT 
                'Тренажер - Индивидуальные' as type,
                COUNT(DISTINCT ts.id) as trainings_count,
                COUNT(DISTINCT tsp.client_id) as unique_clients,
                0 as total_revenue
            FROM training_sessions ts
            JOIN training_session_participants tsp ON ts.id = tsp.training_session_id
            WHERE ts.status = 'completed' 
              AND (ts.training_type = false OR ts.training_type IS NULL)
              AND (ts.slope_type = 'simulator' OR ts.slope_type IS NULL)
            ${dateCondition.replace('session_date', 'ts.session_date')}
            
            UNION ALL
            
            SELECT 
                'Тренажер - Групповые' as type,
                COUNT(DISTINCT ts.id) as trainings_count,
                COUNT(DISTINCT tsp.client_id) as unique_clients,
                0 as total_revenue
            FROM training_sessions ts
            JOIN training_session_participants tsp ON ts.id = tsp.training_session_id
            WHERE ts.status = 'completed' 
              AND ts.training_type = true
              AND (ts.slope_type = 'simulator' OR ts.slope_type IS NULL)
            ${dateCondition.replace('session_date', 'ts.session_date')}
            
            UNION ALL
            
            SELECT 
                'Кулига - Индивидуальные' as type,
                COUNT(DISTINCT kb.id) as trainings_count,
                COUNT(DISTINCT kb.client_id) as unique_clients,
                COALESCE(SUM(kb.price_total), 0) as total_revenue
            FROM kuliga_bookings kb
            WHERE kb.status = 'completed' AND kb.booking_type = 'individual'
            ${dateCondition.replace('session_date', 'kb.date')}
            
            UNION ALL
            
            SELECT 
                'Кулига - Групповые' as type,
                COUNT(DISTINCT kb.group_training_id) as trainings_count,
                COUNT(DISTINCT kb.client_id) as unique_clients,
                COALESCE(SUM(DISTINCT kgt.price_per_person * kgt.max_participants), 0) as total_revenue
            FROM kuliga_bookings kb
            JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            WHERE kb.status = 'completed' AND kb.booking_type = 'group'
            ${dateCondition.replace('session_date', 'kb.date')}
            
            ORDER BY trainings_count DESC
        `;

        const typesResult = await pool.query(typesQuery, queryParams);

        res.json({
            success: true,
            types: typesResult.rows
        });
    } catch (error) {
        console.error('Ошибка получения статистики по типам тренировок:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка получения статистики по типам тренировок' 
        });
    }
});

/**
 * GET /api/analytics/referrals
 * Конверсия реферальной программы
 * Query params: period (current_month, last_month, year, all_time), from, to
 */
router.get('/referrals', async (req, res) => {
    try {
        const { period, from, to } = req.query;
        
        let dateCondition = '';
        let queryParams = [];
        
        if (period === 'custom' && from && to) {
            dateCondition = `AND created_at >= $1 AND created_at <= $2`;
            queryParams = [from, to];
        } else if (period === 'current_month') {
            const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
            const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND created_at >= $1 AND created_at <= $2`;
            queryParams = [startOfMonth, endOfMonth];
        } else if (period === 'last_month') {
            const startOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
            const endOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND created_at >= $1 AND created_at <= $2`;
            queryParams = [startOfLastMonth, endOfLastMonth];
        } else if (period === 'year') {
            const startOfYear = moment().tz(TIMEZONE).startOf('year').format('YYYY-MM-DD');
            const endOfYear = moment().tz(TIMEZONE).endOf('year').format('YYYY-MM-DD');
            dateCondition = `AND created_at >= $1 AND created_at <= $2`;
            queryParams = [startOfYear, endOfYear];
        }

        // Общая статистика реферальной программы
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT referrer_id) as total_referrers,
                COUNT(DISTINCT referee_id) as total_referred,
                COUNT(DISTINCT CASE WHEN status = 'registered' THEN referee_id END) as registered,
                COUNT(DISTINCT CASE WHEN status = 'deposited' THEN referee_id END) as deposited,
                COUNT(DISTINCT CASE WHEN status = 'trained' THEN referee_id END) as trained,
                COUNT(DISTINCT CASE WHEN status = 'completed' THEN referee_id END) as completed,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN referrer_bonus ELSE 0 END), 0) as total_bonuses_paid,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN referee_bonus ELSE 0 END), 0) as total_bonuses_received
            FROM referral_transactions
            WHERE 1=1 ${dateCondition}
        `;

        const statsResult = await pool.query(statsQuery, queryParams);

        // Конверсия по этапам
        const conversionQuery = `
            SELECT 
                'registered' as stage,
                COUNT(DISTINCT referee_id) as count,
                ROUND(COUNT(DISTINCT referee_id) * 100.0 / NULLIF((SELECT COUNT(DISTINCT referee_id) FROM referral_transactions WHERE 1=1 ${dateCondition}), 0), 2) as conversion_rate
            FROM referral_transactions
            WHERE status = 'registered' ${dateCondition.replace('created_at', 'created_at')}
            
            UNION ALL
            
            SELECT 
                'deposited' as stage,
                COUNT(DISTINCT referee_id) as count,
                ROUND(COUNT(DISTINCT referee_id) * 100.0 / NULLIF((SELECT COUNT(DISTINCT referee_id) FROM referral_transactions WHERE status = 'registered' ${dateCondition.replace('created_at', 'created_at')}), 0), 2) as conversion_rate
            FROM referral_transactions
            WHERE status = 'deposited' ${dateCondition.replace('created_at', 'created_at')}
            
            UNION ALL
            
            SELECT 
                'trained' as stage,
                COUNT(DISTINCT referee_id) as count,
                ROUND(COUNT(DISTINCT referee_id) * 100.0 / NULLIF((SELECT COUNT(DISTINCT referee_id) FROM referral_transactions WHERE status = 'deposited' ${dateCondition.replace('created_at', 'created_at')}), 0), 2) as conversion_rate
            FROM referral_transactions
            WHERE status = 'trained' ${dateCondition.replace('created_at', 'created_at')}
            
            UNION ALL
            
            SELECT 
                'completed' as stage,
                COUNT(DISTINCT referee_id) as count,
                ROUND(COUNT(DISTINCT referee_id) * 100.0 / NULLIF((SELECT COUNT(DISTINCT referee_id) FROM referral_transactions WHERE status = 'trained' ${dateCondition.replace('created_at', 'created_at')}), 0), 2) as conversion_rate
            FROM referral_transactions
            WHERE status = 'completed' ${dateCondition.replace('created_at', 'created_at')}
        `;

        const conversionResult = await pool.query(conversionQuery, queryParams);

        // ТОП рефереров
        const topReferrersQuery = `
            SELECT 
                c.id as referrer_id,
                c.full_name as referrer_name,
                COUNT(DISTINCT r.referee_id) as total_referred,
                COUNT(DISTINCT CASE WHEN r.status = 'completed' THEN r.referee_id END) as completed,
                COALESCE(SUM(CASE WHEN r.status = 'completed' THEN r.referrer_bonus ELSE 0 END), 0) as total_bonus_earned
            FROM referral_transactions r
            JOIN clients c ON r.referrer_id = c.id
            WHERE 1=1 ${dateCondition}
            GROUP BY c.id, c.full_name
            HAVING COUNT(DISTINCT r.referee_id) > 0
            ORDER BY total_referred DESC
            LIMIT 10
        `;

        const topReferrersResult = await pool.query(topReferrersQuery, queryParams);

        res.json({
            success: true,
            stats: statsResult.rows[0],
            conversion: conversionResult.rows,
            topReferrers: topReferrersResult.rows
        });
    } catch (error) {
        console.error('Ошибка получения статистики реферальной программы:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка получения статистики реферальной программы' 
        });
    }
});

module.exports = router;

