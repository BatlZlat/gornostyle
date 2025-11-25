const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { verifyKuligaInstructorToken } = require('../middleware/kuligaInstructorAuth');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';
const BOOKING_INSTRUCTOR_ID = 'COALESCE(kb.instructor_id, kgt.instructor_id)';
// Условие для определения прошедших тренировок (учитывает часовой пояс)
// Тренировка считается прошедшей, если:
// 1. Статус = 'completed' ИЛИ
// 2. Статус = 'confirmed'/'pending' И дата+время окончания уже прошли
const COMPLETION_CONDITION = `
      AND (
          kb.status = 'completed'
          OR (
              kb.status IN ('confirmed', 'pending')
              AND (kb.date::timestamp + kb.end_time::interval) <= (NOW() AT TIME ZONE '${TIMEZONE}')
          )
      )
`;
const logFinancesDebug = (...args) => console.log('[KuligaFinances]', ...args);

let dbTimezone = 'unknown';
pool.query('SHOW TIMEZONE')
    .then(result => {
        dbTimezone = result.rows?.[0]?.TimeZone || result.rows?.[0]?.timezone || 'unknown';
        logFinancesDebug('Database timezone:', dbTimezone);
    })
    .catch(err => {
        console.error('[KuligaFinances] Failed to determine DB timezone:', err.message);
    });

router.use((req, res, next) => {
    logFinancesDebug(`${req.method} ${req.originalUrl}`);
    next();
});

// Применяем middleware авторизации ко всем роутам
router.use(verifyKuligaInstructorToken);

/**
 * GET /api/kuliga/instructor/earnings
 * Получение статистики заработка инструктора
 * Query params: period (current_month, all_time) или from, to (даты в формате YYYY-MM-DD)
 */
router.get('/earnings', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { period, from, to } = req.query;

    try {
        let dateFilter = '';
        let params = [instructorId];

        if (period === 'current_month') {
            const currentMonth = moment().tz(TIMEZONE).format('YYYY-MM');
            dateFilter = `AND TO_CHAR(kb.date, 'YYYY-MM') = $2`;
            params.push(currentMonth);
        } else if (period === 'all_time') {
            dateFilter = '';
        } else if (from && to) {
            dateFilter = `AND kb.date >= $2::date AND kb.date <= $3::date`;
            params.push(from, to);
        } else {
            // По умолчанию текущий месяц
            const currentMonth = moment().tz(TIMEZONE).format('YYYY-MM');
            dateFilter = `AND TO_CHAR(kb.date, 'YYYY-MM') = $2`;
            params.push(currentMonth);
        }

        logFinancesDebug('GET /earnings params:', {
            instructorId,
            period: period || 'current_month',
            from,
            to,
            currentLocal: moment().tz(TIMEZONE).format()
        });

        // Получаем процент администратора
        const instructorResult = await pool.query(
            'SELECT admin_percentage FROM kuliga_instructors WHERE id = $1',
            [instructorId]
        );
        const adminPercentage = instructorResult.rows[0]?.admin_percentage || 20;

        // Статистика по типам тренировок
        // Включаем только прошедшие тренировки (completed или confirmed/pending, которые уже прошли по времени)
        const statsQuery = `
            SELECT 
                kb.booking_type,
                COUNT(*) as trainings_count,
                SUM(kb.price_total) as total_revenue,
                SUM(kb.price_total * (1 - ki.admin_percentage / 100)) as instructor_earnings,
                SUM(kb.price_total * (ki.admin_percentage / 100)) as admin_commission
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            JOIN kuliga_instructors ki ON ${BOOKING_INSTRUCTOR_ID} = ki.id
            WHERE ${BOOKING_INSTRUCTOR_ID} = $1
              ${dateFilter}
              ${COMPLETION_CONDITION}
            GROUP BY kb.booking_type
        `;

        const statsResult = await pool.query(statsQuery, params);

        let totalTrainings = 0;
        let totalRevenue = 0;
        let totalEarnings = 0;
        let totalAdminCommission = 0;
        let individualTrainings = 0;
        let groupTrainings = 0;

        statsResult.rows.forEach(row => {
            const count = parseInt(row.trainings_count || 0);
            const revenue = parseFloat(row.total_revenue || 0);
            const earnings = parseFloat(row.instructor_earnings || 0);
            const commission = parseFloat(row.admin_commission || 0);

            totalTrainings += count;
            totalRevenue += revenue;
            totalEarnings += earnings;
            totalAdminCommission += commission;

            if (row.booking_type === 'individual') {
                individualTrainings = count;
            } else if (row.booking_type === 'group') {
                groupTrainings = count;
            }
        });

        // Получаем сумму выплаченных средств
        let payoutsQuery = `
            SELECT COALESCE(SUM(instructor_earnings), 0) as total_paid
            FROM kuliga_instructor_payouts
            WHERE instructor_id = $1
              AND status = 'paid'
        `;
        let payoutsParams = [instructorId];

        if (period === 'current_month') {
            const currentMonth = moment().tz(TIMEZONE).format('YYYY-MM');
            payoutsQuery += ` AND TO_CHAR(period_start, 'YYYY-MM') = $2`;
            payoutsParams.push(currentMonth);
        } else if (from && to) {
            payoutsQuery += ` AND period_start >= $2::date AND period_end <= $3::date`;
            payoutsParams.push(from, to);
        } else if (period !== 'all_time') {
            const currentMonth = moment().tz(TIMEZONE).format('YYYY-MM');
            payoutsQuery += ` AND TO_CHAR(period_start, 'YYYY-MM') = $2`;
            payoutsParams.push(currentMonth);
        }

        let totalPaid = 0;
        try {
            const payoutsResult = await pool.query(payoutsQuery, payoutsParams);
            totalPaid = parseFloat(payoutsResult.rows[0]?.total_paid || 0);
        } catch (error) {
            console.error('Ошибка получения выплат (таблица может не существовать):', error);
            // Если таблица не существует, просто используем 0
            totalPaid = 0;
        }

        // Долг = заработок - выплачено
        const debt = totalEarnings - totalPaid;

        logFinancesDebug('GET /earnings result:', {
            totalTrainings,
            totalEarnings: totalEarnings.toFixed(2),
            totalPaid: totalPaid.toFixed(2),
            debt: debt.toFixed(2),
            statsRows: statsResult.rowCount
        });

        res.json({
            success: true,
            period: period || (from && to ? 'custom' : 'current_month'),
            period_start: from || moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD'),
            period_end: to || moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD'),
            statistics: {
                total_trainings: totalTrainings,
                individual_trainings: individualTrainings,
                group_trainings: groupTrainings,
                total_revenue: totalRevenue.toFixed(2),
                instructor_earnings: totalEarnings.toFixed(2),
                admin_commission: totalAdminCommission.toFixed(2),
                admin_percentage: adminPercentage,
                total_paid: totalPaid.toFixed(2),
                debt: debt.toFixed(2)
            }
        });
    } catch (error) {
        console.error('Ошибка получения статистики заработка:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить статистику' });
    }
});

/**
 * GET /api/kuliga/instructor/payouts
 * Получение истории выплат инструктора
 * Query params: status (опционально, pending, paid, cancelled)
 */
router.get('/payouts', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { status } = req.query;

    try {
        let query = `
            SELECT 
                id,
                period_start,
                period_end,
                trainings_count,
                total_revenue,
                instructor_earnings,
                admin_commission,
                status,
                payment_method,
                payment_date,
                payment_comment,
                created_at,
                updated_at
            FROM kuliga_instructor_payouts
            WHERE instructor_id = $1
        `;
        const params = [instructorId];

        if (status) {
            query += ` AND status = $2`;
            params.push(status);
        }

        query += ` ORDER BY period_start DESC, created_at DESC`;

        const result = await pool.query(query, params);

        res.json({
            success: true,
            payouts: result.rows.map(row => ({
                id: row.id,
                period_start: row.period_start,
                period_end: row.period_end,
                trainings_count: row.trainings_count,
                total_revenue: parseFloat(row.total_revenue || 0).toFixed(2),
                instructor_earnings: parseFloat(row.instructor_earnings || 0).toFixed(2),
                admin_commission: parseFloat(row.admin_commission || 0).toFixed(2),
                status: row.status,
                payment_method: row.payment_method,
                payment_date: row.payment_date,
                payment_comment: row.payment_comment,
                created_at: row.created_at,
                updated_at: row.updated_at
            }))
        });
    } catch (error) {
        console.error('Ошибка получения истории выплат:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить историю выплат' });
    }
});

/**
 * GET /api/kuliga/instructor/trainings
 * Получение детализации тренировок инструктора
 * Query params: status (опционально), from, to (даты в формате YYYY-MM-DD)
 */
router.get('/trainings', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { status, from, to } = req.query;

    try {
        logFinancesDebug('GET /trainings params:', {
            instructorId,
            status,
            from,
            to,
            currentLocal: moment().tz(TIMEZONE).format()
        });

        let query = `
            SELECT 
                kb.id,
                kb.booking_type,
                kb.date,
                kb.start_time,
                kb.end_time,
                kb.sport_type,
                kb.participants_count,
                kb.participants_names,
                kb.price_total,
                kb.status,
                c.full_name as client_name,
                c.phone as client_phone,
                ki.admin_percentage,
                (kb.price_total * (1 - ki.admin_percentage / 100)) as instructor_earnings
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            JOIN clients c ON kb.client_id = c.id
            JOIN kuliga_instructors ki ON ${BOOKING_INSTRUCTOR_ID} = ki.id
            WHERE ${BOOKING_INSTRUCTOR_ID} = $1
        `;
        const params = [instructorId];

        if (status) {
            query += ` AND kb.status = $${params.length + 1}`;
            params.push(status);
        }

        if (from) {
            query += ` AND kb.date >= $${params.length + 1}::date`;
            params.push(from);
        }

        if (to) {
            query += ` AND kb.date <= $${params.length + 1}::date`;
            params.push(to);
        }

        query += `
            ${COMPLETION_CONDITION}
            ORDER BY kb.date DESC, kb.start_time DESC
        `;

        const result = await pool.query(query, params);

        logFinancesDebug('GET /trainings result count:', result.rowCount);

        res.json({
            success: true,
            trainings: result.rows.map(row => ({
                id: row.id,
                booking_type: row.booking_type,
                date: row.date,
                start_time: row.start_time,
                end_time: row.end_time,
                sport_type: row.sport_type,
                participants_count: row.participants_count,
                participants_names: row.participants_names,
                price_total: parseFloat(row.price_total || 0).toFixed(2),
                status: row.status,
                client_name: row.client_name,
                client_phone: row.client_phone,
                instructor_earnings: parseFloat(row.instructor_earnings || 0).toFixed(2)
            }))
        });
    } catch (error) {
        console.error('Ошибка получения детализации тренировок:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить детализацию тренировок' });
    }
});

/**
 * GET /api/kuliga/instructor/earnings/monthly
 * Получение статистики заработка по месяцам (для графика)
 */
router.get('/earnings/monthly', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { months = 12 } = req.query; // По умолчанию последние 12 месяцев

    try {
        const monthsAgo = moment().tz(TIMEZONE).subtract(parseInt(months) - 1, 'months').startOf('month');

        logFinancesDebug('GET /earnings/monthly params:', { instructorId, months, since: monthsAgo.format('YYYY-MM-DD') });

        const query = `
            SELECT 
                TO_CHAR(kb.date, 'YYYY-MM') as month,
                COUNT(*) as trainings_count,
                SUM(kb.price_total) as total_revenue,
                SUM(kb.price_total * (1 - ki.admin_percentage / 100)) as instructor_earnings
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            JOIN kuliga_instructors ki ON ${BOOKING_INSTRUCTOR_ID} = ki.id
            WHERE ${BOOKING_INSTRUCTOR_ID} = $1
              ${COMPLETION_CONDITION}
              AND kb.date >= $2::date
            GROUP BY TO_CHAR(kb.date, 'YYYY-MM')
            ORDER BY month ASC
        `;

        const result = await pool.query(query, [instructorId, monthsAgo.format('YYYY-MM-DD')]);

        // Заполняем пропущенные месяцы нулями
        const monthlyData = [];
        const dataMap = {};
        result.rows.forEach(row => {
            dataMap[row.month] = {
                trainings_count: parseInt(row.trainings_count || 0),
                total_revenue: parseFloat(row.total_revenue || 0),
                instructor_earnings: parseFloat(row.instructor_earnings || 0)
            };
        });

        for (let i = 0; i < parseInt(months); i++) {
            const month = moment().tz(TIMEZONE).subtract(parseInt(months) - 1 - i, 'months').format('YYYY-MM');
            monthlyData.push({
                month,
                month_label: moment(month, 'YYYY-MM').tz(TIMEZONE).format('MMMM YYYY'),
                trainings_count: dataMap[month]?.trainings_count || 0,
                total_revenue: (dataMap[month]?.total_revenue || 0).toFixed(2),
                instructor_earnings: (dataMap[month]?.instructor_earnings || 0).toFixed(2)
            });
        }

        logFinancesDebug('GET /earnings/monthly result points:', monthlyData.length);

        res.json({
            success: true,
            monthly_data: monthlyData
        });
    } catch (error) {
        console.error('Ошибка получения месячной статистики:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить месячную статистику' });
    }
});

module.exports = router;

