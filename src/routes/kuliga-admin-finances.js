const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { verifyToken } = require('../middleware/auth');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';
const BOOKING_INSTRUCTOR_ID = 'COALESCE(kb.instructor_id, kgt.instructor_id)';
// Условие для определения прошедших тренировок
const COMPLETION_CONDITION = `
      AND (
          kb.status = 'completed'
          OR (
              kb.status IN ('confirmed', 'pending')
              AND (kb.date::timestamp + kb.end_time::interval) <= (NOW() AT TIME ZONE '${TIMEZONE}')
          )
      )
`;

// Все маршруты защищены авторизацией админа
router.use(verifyToken);

/**
 * GET /api/kuliga/admin/finances/stats
 * Получение общей статистики финансов
 * Query params: period (current_month, last_month, all_time) или from, to
 */
router.get('/finances/stats', async (req, res) => {
    try {
        const { period, from, to } = req.query;
        
        let dateCondition = '';
        if (period === 'custom' && from && to) {
            dateCondition = `AND kb.date >= '${from}' AND kb.date <= '${to}'`;
        } else if (period === 'current_month') {
            const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
            const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND kb.date >= '${startOfMonth}' AND kb.date <= '${endOfMonth}'`;
        } else if (period === 'last_month') {
            const startOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
            const endOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND kb.date >= '${startOfLastMonth}' AND kb.date <= '${endOfLastMonth}'`;
        }
        // all_time - без ограничения по дате

        // Общая статистика
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT ${BOOKING_INSTRUCTOR_ID}) as instructors_count,
                COUNT(DISTINCT kb.id) as trainings_count,
                COALESCE(SUM(kb.price_total), 0) as total_revenue,
                COALESCE(SUM(kb.price_total * COALESCE(ki.admin_percentage, 20) / 100), 0) as admin_commission,
                COALESCE(SUM(kb.price_total * (1 - COALESCE(ki.admin_percentage, 20) / 100)), 0) as total_earnings
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            LEFT JOIN kuliga_instructors ki ON ${BOOKING_INSTRUCTOR_ID} = ki.id
            WHERE ${BOOKING_INSTRUCTOR_ID} IS NOT NULL
              ${COMPLETION_CONDITION}
              ${dateCondition}
        `;

        const statsResult = await pool.query(statsQuery);
        const stats = statsResult.rows[0];

        // Количество инструкторов с неоплаченным заработком
        const unpaidQuery = `
            SELECT COUNT(DISTINCT ${BOOKING_INSTRUCTOR_ID}) as count
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            LEFT JOIN kuliga_instructor_payouts kip ON (
                ${BOOKING_INSTRUCTOR_ID} = kip.instructor_id
                AND kb.date >= kip.period_start
                AND kb.date <= kip.period_end
                AND kip.status = 'paid'
            )
            WHERE ${BOOKING_INSTRUCTOR_ID} IS NOT NULL
              ${COMPLETION_CONDITION}
              ${dateCondition}
              AND kip.id IS NULL
        `;

        const unpaidResult = await pool.query(unpaidQuery);
        const instructorsWithDebt = parseInt(unpaidResult.rows[0]?.count || 0);

        res.json({
            success: true,
            stats: {
                total_revenue: parseFloat(stats.total_revenue || 0),
                admin_commission: parseFloat(stats.admin_commission || 0),
                total_earnings: parseFloat(stats.total_earnings || 0),
                instructors_with_debt: instructorsWithDebt
            }
        });
    } catch (error) {
        console.error('Ошибка получения статистики финансов:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить статистику' });
    }
});

/**
 * GET /api/kuliga/admin/instructors/earnings
 * Получение списка инструкторов с неоплаченным заработком
 * Query params: period (current_month, last_month, all_time) или from, to
 */
router.get('/instructors/earnings', async (req, res) => {
    try {
        const { period, from, to } = req.query;
        
        let dateCondition = '';
        if (period === 'custom' && from && to) {
            dateCondition = `AND kb.date >= '${from}' AND kb.date <= '${to}'`;
        } else if (period === 'current_month') {
            const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
            const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND kb.date >= '${startOfMonth}' AND kb.date <= '${endOfMonth}'`;
        } else if (period === 'last_month') {
            const startOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
            const endOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
            dateCondition = `AND kb.date >= '${startOfLastMonth}' AND kb.date <= '${endOfLastMonth}'`;
        }

        // Запрос для получения инструкторов с неоплаченным заработком
        // Учитывает как индивидуальные, так и групповые тренировки
        const query = `
            SELECT 
                ki.id,
                ki.full_name,
                ki.phone,
                ki.email,
                ki.admin_percentage,
                ki.telegram_id,
                ki.telegram_registered,
                COUNT(DISTINCT kb.id) as trainings_count,
                COALESCE(SUM(kb.price_total), 0) as total_revenue,
                COALESCE(SUM(kb.price_total * (COALESCE(ki.admin_percentage, 20) / 100)), 0) as admin_commission,
                COALESCE(SUM(kb.price_total * (1 - COALESCE(ki.admin_percentage, 20) / 100)), 0) as unpaid_earnings
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            INNER JOIN kuliga_instructors ki ON ${BOOKING_INSTRUCTOR_ID} = ki.id
            LEFT JOIN kuliga_instructor_payouts kip ON (
                ki.id = kip.instructor_id
                AND kb.date >= kip.period_start
                AND kb.date <= kip.period_end
                AND kip.status = 'paid'
            )
            WHERE ${BOOKING_INSTRUCTOR_ID} IS NOT NULL
              ${COMPLETION_CONDITION}
              ${dateCondition}
              AND kip.id IS NULL
            GROUP BY ki.id, ki.full_name, ki.phone, ki.email, ki.admin_percentage, ki.telegram_id, ki.telegram_registered
            HAVING COALESCE(SUM(kb.price_total * (1 - COALESCE(ki.admin_percentage, 20) / 100)), 0) > 0
            ORDER BY unpaid_earnings DESC
        `;

        const result = await pool.query(query);
        
        res.json({
            success: true,
            instructors: result.rows.map(row => ({
                id: row.id,
                full_name: row.full_name,
                phone: row.phone,
                email: row.email,
                admin_percentage: parseFloat(row.admin_percentage || 20),
                telegram_id: row.telegram_id,
                telegram_registered: row.telegram_registered,
                trainings_count: parseInt(row.trainings_count || 0),
                total_revenue: parseFloat(row.total_revenue || 0),
                admin_commission: parseFloat(row.admin_commission || 0),
                unpaid_earnings: parseFloat(row.unpaid_earnings || 0)
            }))
        });
    } catch (error) {
        console.error('Ошибка получения списка инструкторов:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список инструкторов' });
    }
});

/**
 * GET /api/kuliga/admin/payouts
 * Получение списка всех выплат с фильтрами
 * Query params: instructor_id, status, from, to
 */
router.get('/payouts', async (req, res) => {
    try {
        const { instructor_id, status, from, to } = req.query;
        
        let whereConditions = [];
        let params = [];
        let paramIndex = 1;

        if (instructor_id) {
            whereConditions.push(`kip.instructor_id = $${paramIndex}`);
            params.push(instructor_id);
            paramIndex++;
        }

        if (status) {
            whereConditions.push(`kip.status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
        }

        if (from) {
            whereConditions.push(`kip.period_end >= $${paramIndex}`);
            params.push(from);
            paramIndex++;
        }

        if (to) {
            whereConditions.push(`kip.period_start <= $${paramIndex}`);
            params.push(to);
            paramIndex++;
        }

        const whereClause = whereConditions.length > 0 
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';

        const query = `
            SELECT 
                kip.*,
                ki.full_name as instructor_name,
                ki.phone as instructor_phone,
                ki.email as instructor_email
            FROM kuliga_instructor_payouts kip
            LEFT JOIN kuliga_instructors ki ON kip.instructor_id = ki.id
            ${whereClause}
            ORDER BY kip.period_start DESC, kip.created_at DESC
        `;

        const result = await pool.query(query, params);

        // Получаем список всех инструкторов для фильтра
        const instructorsResult = await pool.query(`
            SELECT DISTINCT ki.id, ki.full_name
            FROM kuliga_instructors ki
            INNER JOIN kuliga_instructor_payouts kip ON ki.id = kip.instructor_id
            ORDER BY ki.full_name
        `);

        res.json({
            success: true,
            payouts: result.rows.map(row => ({
                id: row.id,
                instructor_id: row.instructor_id,
                instructor_name: row.instructor_name,
                instructor_phone: row.instructor_phone,
                instructor_email: row.instructor_email,
                period_start: row.period_start,
                period_end: row.period_end,
                trainings_count: row.trainings_count,
                total_revenue: parseFloat(row.total_revenue || 0),
                instructor_earnings: parseFloat(row.instructor_earnings || 0),
                admin_commission: parseFloat(row.admin_commission || 0),
                status: row.status,
                payment_method: row.payment_method,
                payment_date: row.payment_date,
                payment_comment: row.payment_comment,
                created_at: row.created_at,
                updated_at: row.updated_at
            })),
            instructors: instructorsResult.rows.map(row => ({
                id: row.id,
                full_name: row.full_name
            }))
        });
    } catch (error) {
        console.error('Ошибка получения истории выплат:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить историю выплат' });
    }
});

/**
 * POST /api/kuliga/admin/payouts
 * Создание новой выплаты
 * Body: { instructor_id, period_start, period_end, send_telegram, send_email }
 */
router.post('/payouts', async (req, res) => {
    try {
        const { instructor_id, period_start, period_end, send_telegram = true, send_email = false } = req.body;

        if (!instructor_id || !period_start || !period_end) {
            return res.status(400).json({ success: false, error: 'Необходимо указать instructor_id, period_start и period_end' });
        }

        // Проверяем, не существует ли уже выплата за этот период
        const existingCheck = await pool.query(
            `SELECT id FROM kuliga_instructor_payouts 
             WHERE instructor_id = $1 AND period_start = $2 AND period_end = $3`,
            [instructor_id, period_start, period_end]
        );

        if (existingCheck.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Выплата за этот период уже существует' });
        }

        // Собираем тренировки за период
        const trainingsQuery = `
            SELECT 
                kb.id,
                kb.date,
                kb.start_time,
                kb.end_time,
                kb.booking_type,
                kb.price_total,
                ki.admin_percentage
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            LEFT JOIN kuliga_instructors ki ON ${BOOKING_INSTRUCTOR_ID} = ki.id
            WHERE ${BOOKING_INSTRUCTOR_ID} = $1
              AND kb.date >= $2
              AND kb.date <= $3
              ${COMPLETION_CONDITION}
            ORDER BY kb.date, kb.start_time
        `;

        const trainingsResult = await pool.query(trainingsQuery, [instructor_id, period_start, period_end]);
        const trainings = trainingsResult.rows;

        if (trainings.length === 0) {
            return res.status(400).json({ success: false, error: 'Нет завершенных тренировок за указанный период' });
        }

        // Рассчитываем суммы
        const totalRevenue = trainings.reduce((sum, t) => sum + parseFloat(t.price_total || 0), 0);
        const adminPercentage = parseFloat(trainings[0]?.admin_percentage || 20);
        const adminCommission = totalRevenue * (adminPercentage / 100);
        const instructorEarnings = totalRevenue - adminCommission;

        // Создаем выплату
        const adminId = req.admin?.id || null; // TODO: получить ID администратора из токена
        const insertResult = await pool.query(
            `INSERT INTO kuliga_instructor_payouts 
             (instructor_id, period_start, period_end, trainings_count, total_revenue, 
              instructor_earnings, admin_commission, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
             RETURNING *`,
            [instructor_id, period_start, period_end, trainings.length, totalRevenue, 
             instructorEarnings, adminCommission, adminId]
        );

        const payout = insertResult.rows[0];

        // TODO: Генерация PDF и отправка в Telegram/Email
        // Это будет реализовано в следующих этапах

        res.json({
            success: true,
            payout: {
                id: payout.id,
                instructor_id: payout.instructor_id,
                period_start: payout.period_start,
                period_end: payout.period_end,
                trainings_count: payout.trainings_count,
                total_revenue: parseFloat(payout.total_revenue),
                instructor_earnings: parseFloat(payout.instructor_earnings),
                admin_commission: parseFloat(payout.admin_commission),
                status: payout.status
            }
        });
    } catch (error) {
        console.error('Ошибка создания выплаты:', error);
        res.status(500).json({ success: false, error: 'Не удалось создать выплату' });
    }
});

/**
 * PUT /api/kuliga/admin/payouts/:id
 * Обновление статуса выплаты
 * Body: { status, payment_method, payment_date, payment_comment }
 */
router.put('/payouts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, payment_method, payment_date, payment_comment } = req.body;

        const updateFields = [];
        const params = [];
        let paramIndex = 1;

        if (status) {
            updateFields.push(`status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
        }

        if (payment_method !== undefined) {
            updateFields.push(`payment_method = $${paramIndex}`);
            params.push(payment_method);
            paramIndex++;
        }

        if (payment_date !== undefined) {
            updateFields.push(`payment_date = $${paramIndex}`);
            params.push(payment_date);
            paramIndex++;
        }

        if (payment_comment !== undefined) {
            updateFields.push(`payment_comment = $${paramIndex}`);
            params.push(payment_comment);
            paramIndex++;
        }

        if (status === 'paid') {
            const adminId = req.admin?.id || null; // TODO: получить ID администратора из токена
            updateFields.push(`paid_by = $${paramIndex}`);
            params.push(adminId);
            paramIndex++;
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ success: false, error: 'Нет полей для обновления' });
        }

        params.push(id);
        const query = `
            UPDATE kuliga_instructor_payouts 
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Выплата не найдена' });
        }

        res.json({
            success: true,
            payout: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка обновления выплаты:', error);
        res.status(500).json({ success: false, error: 'Не удалось обновить выплату' });
    }
});

/**
 * GET /api/kuliga/admin/payouts/:id/trainings
 * Получение детализации тренировок по выплате
 */
router.get('/payouts/:id/trainings', async (req, res) => {
    try {
        const { id } = req.params;

        const payoutResult = await pool.query(
            `SELECT * FROM kuliga_instructor_payouts WHERE id = $1`,
            [id]
        );

        if (payoutResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Выплата не найдена' });
        }

        const payout = payoutResult.rows[0];

        const trainingsQuery = `
            SELECT 
                kb.id,
                kb.date,
                kb.start_time,
                kb.end_time,
                kb.booking_type,
                kb.price_total,
                kb.participants_names,
                c.full_name as client_name,
                c.phone as client_phone,
                ki.admin_percentage,
                (kb.price_total * (1 - COALESCE(ki.admin_percentage, 20) / 100)) as instructor_earnings
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            LEFT JOIN kuliga_instructors ki ON ${BOOKING_INSTRUCTOR_ID} = ki.id
            LEFT JOIN clients c ON kb.client_id = c.id
            WHERE ${BOOKING_INSTRUCTOR_ID} = $1
              AND kb.date >= $2
              AND kb.date <= $3
              ${COMPLETION_CONDITION}
            ORDER BY kb.date, kb.start_time
        `;

        const trainingsResult = await pool.query(trainingsQuery, [
            payout.instructor_id,
            payout.period_start,
            payout.period_end
        ]);

        res.json({
            success: true,
            payout: {
                id: payout.id,
                period_start: payout.period_start,
                period_end: payout.period_end
            },
            trainings: trainingsResult.rows.map(row => ({
                id: row.id,
                date: row.date,
                start_time: row.start_time,
                end_time: row.end_time,
                booking_type: row.booking_type,
                client_name: row.client_name,
                client_phone: row.client_phone,
                participants_names: row.participants_names,
                price_total: parseFloat(row.price_total || 0),
                instructor_earnings: parseFloat(row.instructor_earnings || 0)
            }))
        });
    } catch (error) {
        console.error('Ошибка получения детализации тренировок:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить детализацию' });
    }
});

module.exports = router;

