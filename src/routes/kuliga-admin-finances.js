const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { verifyToken } = require('../middleware/auth');
const moment = require('moment-timezone');
const path = require('path');

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
        // Для групповых тренировок считаем уникальные group_training_id, для индивидуальных - уникальные kb.id
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT ${BOOKING_INSTRUCTOR_ID}) as instructors_count,
                COUNT(DISTINCT CASE 
                    WHEN kb.booking_type = 'group' THEN kb.group_training_id
                    ELSE kb.id
                END) as trainings_count,
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

        // Общее количество инструкторов (активных)
        const totalInstructorsResult = await pool.query(
            `SELECT COUNT(*) as count FROM kuliga_instructors WHERE is_active = TRUE`
        );
        const totalInstructors = parseInt(totalInstructorsResult.rows[0]?.count || 0);

        res.json({
            success: true,
            stats: {
                total_revenue: parseFloat(stats.total_revenue || 0),
                admin_commission: parseFloat(stats.admin_commission || 0),
                total_earnings: parseFloat(stats.total_earnings || 0),
                instructors_with_debt: instructorsWithDebt,
                total_instructors: totalInstructors,
                instructors_count: parseInt(stats.instructors_count || 0) // Инструкторы с тренировками за период
            }
        });
    } catch (error) {
        console.error('Ошибка получения статистики финансов:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить статистику' });
    }
});

/**
 * GET /api/kuliga/admin/finances/instructors
 * Получение списка инструкторов с неоплаченным заработком
 * Query params: period (current_month, last_month, all_time) или from, to
 */
router.get('/finances/instructors', async (req, res) => {
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
        // Для групповых тренировок считаем уникальные group_training_id, для индивидуальных - уникальные kb.id
        const query = `
            SELECT 
                ki.id,
                ki.full_name,
                ki.phone,
                ki.email,
                ki.admin_percentage,
                ki.telegram_id,
                ki.telegram_registered,
                COUNT(DISTINCT CASE 
                    WHEN kb.booking_type = 'group' THEN kb.group_training_id
                    ELSE kb.id
                END) as trainings_count,
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
                kb.group_training_id,
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

        // Подсчитываем количество уникальных тренировок
        // Для групповых тренировок считаем уникальные group_training_id, для индивидуальных - уникальные id
        const uniqueTrainings = new Set();
        trainings.forEach(t => {
            if (t.booking_type === 'group' && t.group_training_id) {
                uniqueTrainings.add(`group_${t.group_training_id}`);
            } else {
                uniqueTrainings.add(`individual_${t.id}`);
            }
        });
        const trainingsCount = uniqueTrainings.size;

        // Создаем выплату
        const adminId = req.admin?.id || null; // TODO: получить ID администратора из токена
        const insertResult = await pool.query(
            `INSERT INTO kuliga_instructor_payouts 
             (instructor_id, period_start, period_end, trainings_count, total_revenue, 
              instructor_earnings, admin_commission, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
             RETURNING *`,
            [instructor_id, period_start, period_end, trainingsCount, totalRevenue, 
             instructorEarnings, adminCommission, adminId]
        );

        const payout = insertResult.rows[0];

        // Получаем данные инструктора для генерации платежки
        // Используем тот же запрос, что и для подсчета тренировок выше
        const instructorResult = await pool.query(
            `SELECT ki.*
             FROM kuliga_instructors ki
             WHERE ki.id = $1`,
            [instructor_id]
        );
        
        // Подсчитываем тренировки отдельным запросом (используем уже готовые данные из trainings)
        const individualTrainings = trainings.filter(t => t.booking_type === 'individual').length;
        const groupTrainingsSet = new Set();
        trainings.filter(t => t.booking_type === 'group' && t.group_training_id).forEach(t => {
            groupTrainingsSet.add(t.group_training_id);
        });
        const groupTrainings = groupTrainingsSet.size;

        const instructor = instructorResult.rows[0];
        if (!instructor) {
            console.error('Инструктор не найден:', instructor_id);
            return res.status(404).json({ success: false, error: 'Инструктор не найден' });
        }

        // Подготавливаем данные для генерации платежки
        const payoutData = {
            payout_id: payout.id,
            instructor_name: instructor.full_name,
            period_start: payout.period_start,
            period_end: payout.period_end,
            trainings_count: payout.trainings_count,
            individual_trainings: individualTrainings,
            group_trainings: groupTrainings,
            total_revenue: parseFloat(payout.total_revenue),
            admin_commission: parseFloat(payout.admin_commission),
            instructor_earnings: parseFloat(payout.instructor_earnings),
            admin_percentage: instructor.admin_percentage || 20,
            created_at: payout.created_at
        };

        // Генерируем и отправляем платежку
        const sendResults = {
            telegram: { success: false, error: null },
            email: { success: false, error: null }
        };

        try {
            let jpgPath = null;
            let fullPath = null;
            
            try {
                const payoutJpgGenerator = require('../services/payoutJpgGenerator');
                jpgPath = await payoutJpgGenerator.generatePayoutJpg(payoutData);
                fullPath = path.join(__dirname, '../../public', jpgPath);
                console.log(`✅ JPG платежка сгенерирована: ${jpgPath}`);
            } catch (jpgError) {
                console.error('⚠️ Ошибка генерации JPG платежки (продолжаем без JPG):', jpgError.message);
                // Продолжаем без JPG - отправляем только текстовые уведомления
            }

            // Отправка в Telegram
            if (send_telegram) {
                try {
                    const adminNotify = require('../bot/admin-notify');
                    const instructorBot = adminNotify.instructorBot || adminNotify.bot;
                    
                    console.log('🔍 Проверка отправки в Telegram:', {
                        hasInstructorBot: !!instructorBot,
                        instructorTelegramId: instructor.telegram_id,
                        instructorName: instructor.full_name
                    });
                    
                    if (instructorBot && instructor.telegram_id) {
                        const message = `💰 *Платежка №${payout.id}*\n\n` +
                            `Период: ${moment(payout.period_start).format('DD.MM.YYYY')} - ${moment(payout.period_end).format('DD.MM.YYYY')}\n` +
                            `К выплате: ${parseFloat(payout.instructor_earnings).toFixed(2)} ₽\n\n` +
                            `Статус: ⏳ Ожидает выплаты`;
                        
                        if (fullPath) {
                            try {
                                const fs = require('fs');
                                const photo = fs.readFileSync(fullPath);
                                await instructorBot.sendPhoto(instructor.telegram_id, photo, {
                                    caption: message,
                                    parse_mode: 'Markdown'
                                });
                            } catch (photoError) {
                                console.error('Ошибка отправки фото, отправляем текстовое сообщение:', photoError.message);
                                await instructorBot.sendMessage(instructor.telegram_id, message, { parse_mode: 'Markdown' });
                            }
                        } else {
                            await instructorBot.sendMessage(instructor.telegram_id, message, { parse_mode: 'Markdown' });
                        }
                        sendResults.telegram.success = true;
                        console.log(`✅ Платежка отправлена в Telegram инструктору ${instructor.full_name}`);
                    } else {
                        const errorMsg = !instructorBot 
                            ? 'Бот инструкторов не настроен (KULIGA_INSTRUKTOR_BOT)' 
                            : !instructor.telegram_id 
                                ? `Инструктор ${instructor.full_name} не зарегистрирован в Telegram (telegram_id отсутствует)`
                                : 'Неизвестная ошибка';
                        sendResults.telegram.error = errorMsg;
                        console.error('❌ Не удалось отправить в Telegram:', errorMsg);
                    }
                } catch (telegramError) {
                    console.error('Ошибка отправки платежки в Telegram:', telegramError);
                    sendResults.telegram.error = telegramError.message;
                }
            }

            // Отправка на Email
            if (send_email && instructor.email) {
                try {
                    const EmailService = require('../services/emailService');
                    const emailService = new EmailService();
                    
                    const emailSubject = `Платежка №${payout.id} - Служба инструкторов Горностайл72`;
                    const emailHtml = `
                        <h2>Платежка №${payout.id}</h2>
                        <p>Уважаемый(ая) ${instructor.full_name}!</p>
                        <p>Ваша платежка за период ${moment(payout.period_start).format('DD.MM.YYYY')} - ${moment(payout.period_end).format('DD.MM.YYYY')} готова.</p>
                        <p><strong>К выплате: ${parseFloat(payout.instructor_earnings).toFixed(2)} ₽</strong></p>
                        ${fullPath ? '<p>Платежка прикреплена к письму.</p>' : '<p>Платежка будет доступна в личном кабинете.</p>'}
                        <p>С уважением,<br>Служба инструкторов Горностайл72</p>
                    `;
                    
                    const attachments = [];
                    if (fullPath) {
                        try {
                            attachments.push({
                                filename: `Платежка_${payout.id}.jpg`,
                                path: fullPath,
                                contentType: 'image/jpeg'
                            });
                        } catch (attachError) {
                            console.error('Ошибка добавления вложения:', attachError.message);
                        }
                    }
                    
                    const emailResult = await emailService.sendEmail(
                        instructor.email,
                        emailSubject,
                        emailHtml,
                        attachments
                    );
                    
                    if (!emailResult.success) {
                        throw new Error(emailResult.error || 'Ошибка отправки email');
                    }
                    sendResults.email.success = true;
                    console.log(`✅ Платежка отправлена на Email инструктору ${instructor.full_name}`);
                } catch (emailError) {
                    console.error('Ошибка отправки платежки на Email:', emailError);
                    sendResults.email.error = emailError.message;
                }
            } else if (send_email && !instructor.email) {
                sendResults.email.error = 'Email инструктора не указан';
            }

            // Уведомление администратора
            try {
                const adminNotify = require('../bot/admin-notify');
                const adminBot = adminNotify.bot;
                const adminIds = process.env.ADMIN_TELEGRAM_ID?.split(',').map(id => id.trim()) || [];
                
                console.log('🔍 Проверка отправки администратору:', {
                    hasAdminBot: !!adminBot,
                    adminIds: adminIds
                });
                
                if (!adminBot) {
                    console.error('❌ Бот администратора не найден в admin-notify');
                    throw new Error('Бот администратора не настроен');
                }
                
                let adminMessage = `💰 *Платежка создана*\n\n`;
                adminMessage += `Инструктор: ${instructor.full_name}\n`;
                adminMessage += `Период: ${moment(payout.period_start).format('DD.MM.YYYY')} - ${moment(payout.period_end).format('DD.MM.YYYY')}\n`;
                adminMessage += `Сумма: ${parseFloat(payout.instructor_earnings).toFixed(2)} ₽\n\n`;
                
                if (send_telegram) {
                    adminMessage += sendResults.telegram.success 
                        ? `✅ Telegram: отправлено\n` 
                        : `❌ Telegram: ${sendResults.telegram.error || 'ошибка'}\n`;
                }
                
                if (send_email) {
                    adminMessage += sendResults.email.success 
                        ? `✅ Email: отправлено\n` 
                        : `❌ Email: ${sendResults.email.error || 'ошибка'}\n`;
                }
                
                for (const adminId of adminIds) {
                    try {
                        await adminBot.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' });
                        console.log(`✅ Уведомление отправлено администратору ${adminId}`);
                    } catch (err) {
                        console.error(`Ошибка отправки уведомления администратору ${adminId}:`, err);
                    }
                }
            } catch (adminNotifyError) {
                console.error('Ошибка уведомления администратора:', adminNotifyError);
                console.error('Стек ошибки:', adminNotifyError.stack);
            }

        } catch (generateError) {
            console.error('Ошибка генерации платежки:', generateError);
            console.error('Стек ошибки:', generateError.stack);
            // Не прерываем создание выплаты, просто логируем ошибку
        }

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
        console.error('Стек ошибки:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: 'Не удалось создать выплату',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/kuliga/admin/payouts/:id
 * Получение данных одной выплаты
 */
router.get('/payouts/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `SELECT 
                kip.*,
                ki.full_name as instructor_name,
                ki.phone as instructor_phone,
                ki.email as instructor_email
            FROM kuliga_instructor_payouts kip
            LEFT JOIN kuliga_instructors ki ON kip.instructor_id = ki.id
            WHERE kip.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Выплата не найдена' });
        }

        const payout = result.rows[0];
        res.json({
            success: true,
            payout: {
                id: payout.id,
                instructor_id: payout.instructor_id,
                instructor_name: payout.instructor_name,
                instructor_phone: payout.instructor_phone,
                instructor_email: payout.instructor_email,
                period_start: payout.period_start,
                period_end: payout.period_end,
                trainings_count: payout.trainings_count,
                total_revenue: parseFloat(payout.total_revenue || 0),
                instructor_earnings: parseFloat(payout.instructor_earnings || 0),
                admin_commission: parseFloat(payout.admin_commission || 0),
                status: payout.status,
                payment_method: payout.payment_method,
                payment_date: payout.payment_date,
                payment_comment: payout.payment_comment,
                created_at: payout.created_at,
                updated_at: payout.updated_at
            }
        });
    } catch (error) {
        console.error('Ошибка получения выплаты:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить данные выплаты' });
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

        // Получаем старый статус для проверки изменений
        const oldPayoutResult = await pool.query(
            `SELECT kip.*, ki.full_name as instructor_name, ki.telegram_id, ki.email
             FROM kuliga_instructor_payouts kip
             LEFT JOIN kuliga_instructors ki ON kip.instructor_id = ki.id
             WHERE kip.id = $1`,
            [id]
        );

        if (oldPayoutResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Выплата не найдена' });
        }

        const oldPayout = oldPayoutResult.rows[0];
        const oldStatus = oldPayout.status;

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

        const payout = result.rows[0];
        const newStatus = payout.status;

        // Отправляем уведомления, если статус изменился
        if (oldStatus !== newStatus) {
            try {
                const adminNotify = require('../bot/admin-notify');
                const instructorBot = adminNotify.instructorBot || adminNotify.bot;
                const adminBot = adminNotify.bot;

                // Уведомление инструктору
                if (instructorBot && oldPayout.telegram_id) {
                    try {
                        let instructorMessage = '';
                        
                        if (newStatus === 'paid') {
                            instructorMessage = `✅ *Выплата получена!*\n\n` +
                                `💰 Платежка №${payout.id}\n` +
                                `Период: ${moment(payout.period_start).format('DD.MM.YYYY')} - ${moment(payout.period_end).format('DD.MM.YYYY')}\n` +
                                `Сумма: ${parseFloat(payout.instructor_earnings).toFixed(2)} ₽\n`;
                            
                            if (payout.payment_method) {
                                instructorMessage += `Способ выплаты: ${payout.payment_method}\n`;
                            }
                            
                            if (payout.payment_date) {
                                instructorMessage += `Дата выплаты: ${moment(payout.payment_date).format('DD.MM.YYYY')}\n`;
                            }
                            
                            if (payout.payment_comment) {
                                instructorMessage += `\nКомментарий: ${payout.payment_comment}`;
                            }
                        } else if (newStatus === 'cancelled') {
                            instructorMessage = `❌ *Выплата отменена*\n\n` +
                                `💰 Платежка №${payout.id}\n` +
                                `Период: ${moment(payout.period_start).format('DD.MM.YYYY')} - ${moment(payout.period_end).format('DD.MM.YYYY')}\n` +
                                `Сумма: ${parseFloat(payout.instructor_earnings).toFixed(2)} ₽\n`;
                            
                            if (payout.payment_comment) {
                                instructorMessage += `\nПричина: ${payout.payment_comment}`;
                            }
                        } else if (newStatus === 'pending') {
                            instructorMessage = `⏳ *Статус выплаты изменен*\n\n` +
                                `💰 Платежка №${payout.id}\n` +
                                `Период: ${moment(payout.period_start).format('DD.MM.YYYY')} - ${moment(payout.period_end).format('DD.MM.YYYY')}\n` +
                                `Сумма: ${parseFloat(payout.instructor_earnings).toFixed(2)} ₽\n` +
                                `Статус: Ожидает выплаты`;
                        }

                        if (instructorMessage) {
                            await instructorBot.sendMessage(oldPayout.telegram_id, instructorMessage, { parse_mode: 'Markdown' });
                            console.log(`✅ Уведомление о смене статуса отправлено инструктору ${oldPayout.instructor_name}`);
                        }
                    } catch (instructorError) {
                        console.error('Ошибка отправки уведомления инструктору:', instructorError);
                    }
                }

                // Уведомление администратору
                if (adminBot) {
                    try {
                        const adminIds = process.env.ADMIN_TELEGRAM_ID?.split(',').map(id => id.trim()) || [];
                        
                        const statusLabels = {
                            'pending': '⏳ В ожидании',
                            'paid': '✅ Выплачено',
                            'cancelled': '❌ Отменено'
                        };

                        let adminMessage = `📝 *Статус выплаты изменен*\n\n`;
                        adminMessage += `Инструктор: ${oldPayout.instructor_name}\n`;
                        adminMessage += `Платежка №${payout.id}\n`;
                        adminMessage += `Период: ${moment(payout.period_start).format('DD.MM.YYYY')} - ${moment(payout.period_end).format('DD.MM.YYYY')}\n`;
                        adminMessage += `Сумма: ${parseFloat(payout.instructor_earnings).toFixed(2)} ₽\n\n`;
                        adminMessage += `Статус: ${statusLabels[oldStatus] || oldStatus} → ${statusLabels[newStatus] || newStatus}\n`;
                        
                        if (payout.payment_method) {
                            adminMessage += `Способ выплаты: ${payout.payment_method}\n`;
                        }
                        
                        if (payout.payment_date) {
                            adminMessage += `Дата выплаты: ${moment(payout.payment_date).format('DD.MM.YYYY')}\n`;
                        }
                        
                        if (payout.payment_comment) {
                            adminMessage += `\nКомментарий: ${payout.payment_comment}`;
                        }

                        for (const adminId of adminIds) {
                            try {
                                await adminBot.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' });
                                console.log(`✅ Уведомление о смене статуса отправлено администратору ${adminId}`);
                            } catch (err) {
                                console.error(`Ошибка отправки уведомления администратору ${adminId}:`, err);
                            }
                        }
                    } catch (adminError) {
                        console.error('Ошибка отправки уведомления администратору:', adminError);
                    }
                }
            } catch (notifyError) {
                console.error('Ошибка при отправке уведомлений о смене статуса:', notifyError);
                // Не прерываем обновление выплаты из-за ошибки уведомлений
            }
        }

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
                status: payout.status,
                payment_method: payout.payment_method,
                payment_date: payout.payment_date,
                payment_comment: payout.payment_comment,
                updated_at: payout.updated_at
            }
        });
    } catch (error) {
        console.error('Ошибка обновления выплаты:', error);
        console.error('Стек ошибки:', error.stack);
        res.status(500).json({ success: false, error: 'Не удалось обновить выплату' });
    }
});

/**
 * GET /api/kuliga/admin/finances/instructors/:id/trainings
 * Получение детализации тренировок инструктора (для админа)
 * Query params: period (current_month, last_month, all_time) или from, to
 */
router.get('/finances/instructors/:id/trainings', async (req, res) => {
    try {
        const instructorId = parseInt(req.params.id);
        const { period, from, to } = req.query;

        if (!instructorId || isNaN(instructorId)) {
            return res.status(400).json({ success: false, error: 'Неверный ID инструктора' });
        }

        let dateFilter = '';
        const params = [instructorId];

        if (period === 'custom' && from && to) {
            dateFilter = `AND kb.date >= $${params.length + 1}::date AND kb.date <= $${params.length + 2}::date`;
            params.push(from, to);
        } else if (period === 'current_month') {
            const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
            const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
            dateFilter = `AND kb.date >= $${params.length + 1}::date AND kb.date <= $${params.length + 2}::date`;
            params.push(startOfMonth, endOfMonth);
        } else if (period === 'last_month') {
            const startOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
            const endOfLastMonth = moment().tz(TIMEZONE).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
            dateFilter = `AND kb.date >= $${params.length + 1}::date AND kb.date <= $${params.length + 2}::date`;
            params.push(startOfLastMonth, endOfLastMonth);
        }
        // all_time - без ограничения по дате

        let query = `
            SELECT 
                kb.id,
                kb.booking_type,
                kb.group_training_id,
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
              ${dateFilter}
              ${COMPLETION_CONDITION}
            ORDER BY kb.date DESC, kb.start_time DESC
        `;

        const result = await pool.query(query, params);

        // Группируем групповые тренировки по group_training_id
        const trainingsMap = new Map();
        const individualTrainings = [];

        result.rows.forEach(row => {
            if (row.booking_type === 'group' && row.group_training_id) {
                const key = `${row.group_training_id}_${row.date}_${row.start_time}`;
                if (!trainingsMap.has(key)) {
                    trainingsMap.set(key, {
                        id: row.group_training_id,
                        booking_type: 'group',
                        date: row.date,
                        start_time: row.start_time,
                        end_time: row.end_time,
                        sport_type: row.sport_type,
                        participants_count: 0,
                        participants_names: [],
                        price_total: 0,
                        instructor_earnings: 0,
                        bookings: []
                    });
                }
                const training = trainingsMap.get(key);
                training.participants_count += row.participants_count || 1;
                if (row.participants_names && Array.isArray(row.participants_names)) {
                    training.participants_names.push(...row.participants_names);
                }
                training.price_total += parseFloat(row.price_total || 0);
                training.instructor_earnings += parseFloat(row.instructor_earnings || 0);
                training.bookings.push({
                    id: row.id,
                    client_name: row.client_name,
                    client_phone: row.client_phone,
                    participants_names: row.participants_names,
                    participants_count: row.participants_count,
                    price_total: parseFloat(row.price_total || 0),
                    instructor_earnings: parseFloat(row.instructor_earnings || 0)
                });
            } else {
                individualTrainings.push({
                    id: row.id,
                    booking_type: 'individual',
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
                });
            }
        });

        // Преобразуем Map в массив и объединяем с индивидуальными
        const groupedTrainings = Array.from(trainingsMap.values()).map(training => ({
            ...training,
            price_total: training.price_total.toFixed(2),
            instructor_earnings: training.instructor_earnings.toFixed(2)
        }));

        const allTrainings = [...groupedTrainings, ...individualTrainings].sort((a, b) => {
            const dateA = new Date(`${a.date}T${a.start_time}`);
            const dateB = new Date(`${b.date}T${b.start_time}`);
            return dateB - dateA;
        });

        res.json({
            success: true,
            trainings: allTrainings
        });
    } catch (error) {
        console.error('Ошибка получения детализации тренировок инструктора:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить детализацию' });
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
                kb.group_training_id,
                kb.price_total,
                kb.participants_count,
                kb.participants_names,
                c.full_name as client_name,
                c.phone as client_phone,
                ki.admin_percentage,
                kgt.max_participants,
                kgt.price_per_person,
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

        // Группируем групповые тренировки по group_training_id для подсчета общего количества участников
        const groupTrainingsMap = new Map();
        const individualTrainings = [];
        
        trainingsResult.rows.forEach(row => {
            if (row.booking_type === 'group' && row.group_training_id) {
                const key = row.group_training_id;
                if (!groupTrainingsMap.has(key)) {
                    groupTrainingsMap.set(key, {
                        group_training_id: row.group_training_id,
                        date: row.date,
                        start_time: row.start_time,
                        end_time: row.end_time,
                        max_participants: row.max_participants,
                        price_per_person: parseFloat(row.price_per_person || 0),
                        total_participants: 0,
                        total_price: 0,
                        total_earnings: 0,
                        bookings: []
                    });
                }
                const groupTraining = groupTrainingsMap.get(key);
                groupTraining.total_participants += row.participants_count || 1;
                groupTraining.total_price += parseFloat(row.price_total || 0);
                groupTraining.total_earnings += parseFloat(row.instructor_earnings || 0);
                groupTraining.bookings.push({
                    id: row.id,
                    client_name: row.client_name,
                    client_phone: row.client_phone,
                    participants_count: row.participants_count || 1,
                    participants_names: row.participants_names,
                    price_total: parseFloat(row.price_total || 0),
                    instructor_earnings: parseFloat(row.instructor_earnings || 0)
                });
            } else if (row.booking_type === 'individual') {
                individualTrainings.push({
                    id: row.id,
                    date: row.date,
                    start_time: row.start_time,
                    end_time: row.end_time,
                    booking_type: row.booking_type,
                    client_name: row.client_name,
                    client_phone: row.client_phone,
                    participants_count: row.participants_count || 1,
                    participants_names: row.participants_names,
                    price_per_person: parseFloat(row.price_total || 0),
                    price_total: parseFloat(row.price_total || 0),
                    instructor_earnings: parseFloat(row.instructor_earnings || 0)
                });
            }
        });
        
        // Преобразуем групповые тренировки в формат для ответа
        const groupTrainings = Array.from(groupTrainingsMap.values()).map(gt => ({
            id: gt.group_training_id,
            date: gt.date,
            start_time: gt.start_time,
            end_time: gt.end_time,
            booking_type: 'group',
            group_training_id: gt.group_training_id,
            client_name: gt.bookings.map(b => b.client_name).join(', '),
            participants_count: gt.total_participants,
            max_participants: gt.max_participants,
            price_per_person: gt.price_per_person,
            price_total: gt.total_price,
            instructor_earnings: gt.total_earnings,
            bookings: gt.bookings
        }));
        
        // Подсчитываем статистику
        const individualCount = individualTrainings.length;
        const groupCount = groupTrainings.length;
        
        // Объединяем все тренировки (сначала групповые, потом индивидуальные)
        const allTrainings = [...groupTrainings, ...individualTrainings].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA.getTime() - dateB.getTime();
            }
            return String(a.start_time).localeCompare(String(b.start_time));
        });

        res.json({
            success: true,
            payout: {
                id: payout.id,
                period_start: payout.period_start,
                period_end: payout.period_end
            },
            statistics: {
                total_trainings: individualCount + groupCount,
                individual_trainings: individualCount,
                group_trainings: groupCount
            },
            trainings: allTrainings
        });
    } catch (error) {
        console.error('Ошибка получения детализации тренировок:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить детализацию' });
    }
});

/**
 * DELETE /api/kuliga/admin/payouts/:id
 * Удаление выплаты
 */
router.delete('/payouts/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Проверяем существование выплаты
        const payoutResult = await pool.query(
            `SELECT id, status FROM kuliga_instructor_payouts WHERE id = $1`,
            [id]
        );

        if (payoutResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Выплата не найдена' });
        }

        const payout = payoutResult.rows[0];

        // Можно удалять только выплаты со статусом pending
        if (payout.status !== 'pending') {
            return res.status(400).json({ 
                success: false, 
                error: 'Можно удалять только выплаты со статусом "В ожидании"' 
            });
        }

        // Удаляем выплату
        await pool.query(
            `DELETE FROM kuliga_instructor_payouts WHERE id = $1`,
            [id]
        );

        res.json({
            success: true,
            message: 'Выплата успешно удалена'
        });
    } catch (error) {
        console.error('Ошибка удаления выплаты:', error);
        res.status(500).json({ success: false, error: 'Не удалось удалить выплату' });
    }
});

module.exports = router;

