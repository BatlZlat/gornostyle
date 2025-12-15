/**
 * API для мониторинга "зависших" платежей
 * Транзакции без бронирования, которые могли быть оплачены, но webhook не пришёл
 */

const express = require('express');
const { pool } = require('../db');
const moment = require('moment-timezone');

const router = express.Router();
const TIMEZONE = 'Asia/Yekaterinburg';

/**
 * GET /api/kuliga/stuck-payments
 * Возвращает список "зависших" платежей
 * Query params:
 *   - period: 'today' | '2days' | '3days' | 'week' | 'custom'
 *   - from: дата начала (для period=custom)
 *   - to: дата конца (для period=custom)
 */
router.get('/', async (req, res) => {
    try {
        const { period = 'today', from, to } = req.query;
        
        let startDate, endDate;
        const now = moment.tz(TIMEZONE);
        
        switch (period) {
            case 'today':
                startDate = now.clone().startOf('day');
                endDate = now.clone().endOf('day');
                break;
            case '2days':
                startDate = now.clone().subtract(2, 'days').startOf('day');
                endDate = now.clone().endOf('day');
                break;
            case '3days':
                startDate = now.clone().subtract(3, 'days').startOf('day');
                endDate = now.clone().endOf('day');
                break;
            case 'week':
                startDate = now.clone().subtract(7, 'days').startOf('day');
                endDate = now.clone().endOf('day');
                break;
            case 'custom':
                if (!from || !to) {
                    return res.status(400).json({ error: 'Для period=custom необходимы параметры from и to' });
                }
                startDate = moment.tz(from, TIMEZONE).startOf('day');
                endDate = moment.tz(to, TIMEZONE).endOf('day');
                if (!startDate.isValid() || !endDate.isValid()) {
                    return res.status(400).json({ error: 'Неверный формат даты' });
                }
                break;
            default:
                return res.status(400).json({ error: 'Неверный параметр period' });
        }
        
        // Ищем транзакции:
        // - booking_id IS NULL (бронирование не создано)
        // - status IN ('pending') (ожидает обработки)
        // - created_at в диапазоне дат
        const result = await pool.query(
            `SELECT 
                t.id,
                t.amount,
                t.description,
                t.provider_payment_id,
                t.provider_order_id,
                t.status,
                t.provider_status,
                t.created_at,
                t.provider_raw_data,
                EXTRACT(EPOCH FROM (NOW() - t.created_at))/60 AS minutes_ago,
                c.full_name AS client_name,
                c.phone AS client_phone
             FROM kuliga_transactions t
             LEFT JOIN clients c ON t.client_id = c.id
             WHERE t.booking_id IS NULL
               AND t.status IN ('pending')
               AND t.created_at BETWEEN $1 AND $2
             ORDER BY t.created_at DESC`,
            [startDate.toDate(), endDate.toDate()]
        );
        
        const stuckPayments = result.rows.map(row => {
            // provider_raw_data хранится как JSON строка, нужно распарсить
            let rawData = null;
            try {
                rawData = typeof row.provider_raw_data === 'string' 
                    ? JSON.parse(row.provider_raw_data) 
                    : row.provider_raw_data;
            } catch (e) {
                console.warn(`Ошибка парсинга provider_raw_data для транзакции #${row.id}:`, e.message);
            }
            
            return {
                id: row.id,
                amount: parseFloat(row.amount),
                description: row.description,
                providerPaymentId: row.provider_payment_id,
                providerOrderId: row.provider_order_id,
                status: row.status,
                providerStatus: row.provider_status,
                createdAt: row.created_at,
                minutesAgo: Math.round(parseFloat(row.minutes_ago)),
                clientName: row.client_name,
                clientPhone: row.client_phone,
                hasBookingData: !!(rawData && rawData.bookingData)
            };
        });
        
        res.json({
            success: true,
            period,
            startDate: startDate.format('YYYY-MM-DD'),
            endDate: endDate.format('YYYY-MM-DD'),
            count: stuckPayments.length,
            payments: stuckPayments
        });
        
    } catch (error) {
        console.error('Ошибка получения зависших платежей:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

/**
 * POST /api/kuliga/stuck-payments/:id/create-booking
 * Создаёт бронирование из транзакции вручную
 */
router.post('/:id/create-booking', async (req, res) => {
    const transactionId = Number(req.params.id);
    
    if (!transactionId) {
        return res.status(400).json({ error: 'Неверный ID транзакции' });
    }
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Загружаем транзакцию
        const txResult = await client.query(
            `SELECT id, booking_id, client_id, amount, status, provider_raw_data
             FROM kuliga_transactions
             WHERE id = $1
             FOR UPDATE`,
            [transactionId]
        );
        
        if (!txResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: `Транзакция #${transactionId} не найдена` });
        }
        
        const transaction = txResult.rows[0];
        
        if (transaction.booking_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Бронирование уже создано',
                bookingId: transaction.booking_id 
            });
        }
        
        // Извлекаем данные бронирования
        // provider_raw_data хранится как JSON строка, нужно распарсить
        let rawData = {};
        try {
            rawData = typeof transaction.provider_raw_data === 'string'
                ? JSON.parse(transaction.provider_raw_data)
                : (transaction.provider_raw_data || {});
        } catch (e) {
            console.error(`Ошибка парсинга provider_raw_data для транзакции #${transactionId}:`, e.message);
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Ошибка чтения данных транзакции' });
        }
        
        const bookingData = rawData.bookingData;
        
        if (!bookingData) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Данные бронирования не найдены в транзакции' });
        }
        
        // Нормализуем дату: может быть Date объектом, ISO строкой или уже в формате YYYY-MM-DD
        let normalizedDate = bookingData.date;
        if (normalizedDate instanceof Date) {
            normalizedDate = moment.tz(normalizedDate, TIMEZONE).format('YYYY-MM-DD');
        } else if (typeof normalizedDate === 'string') {
            if (normalizedDate.includes('T') || normalizedDate.includes(' ')) {
                // ISO строка или строка с временем - парсим и нормализуем
                normalizedDate = moment.tz(normalizedDate, TIMEZONE).format('YYYY-MM-DD');
            } else if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
                // Неправильный формат - пытаемся распарсить
                normalizedDate = moment.tz(normalizedDate, TIMEZONE).format('YYYY-MM-DD');
            }
            // Если уже в формате YYYY-MM-DD, оставляем как есть
        }
        
        console.log(`📅 Нормализация даты для транзакции #${transactionId}: ${bookingData.date} → ${normalizedDate}`);
        
        // Проверяем слот
        const slotCheck = await client.query(
            `SELECT status FROM kuliga_schedule_slots WHERE id = $1 FOR UPDATE`,
            [bookingData.slot_id]
        );
        
        if (!slotCheck.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Слот #${bookingData.slot_id} не найден` });
        }
        
        if (slotCheck.rows[0].status !== 'available' && slotCheck.rows[0].status !== 'hold') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: `Слот #${bookingData.slot_id} уже занят (статус: ${slotCheck.rows[0].status})`,
                slotId: bookingData.slot_id,
                slotStatus: slotCheck.rows[0].status
            });
        }
        
        // Резервируем слот
        await client.query(
            `UPDATE kuliga_schedule_slots
             SET status = 'booked', 
                 hold_until = NULL,
                 hold_transaction_id = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [bookingData.slot_id]
        );
        
        // Создаём бронирование
        const bookingResult = await client.query(
            `INSERT INTO kuliga_bookings (
                client_id,
                booking_type,
                instructor_id,
                slot_id,
                date,
                start_time,
                end_time,
                sport_type,
                participants_count,
                participants_names,
                participants_birth_years,
                price_total,
                price_per_person,
                price_id,
                notification_method,
                payer_rides,
                location,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'confirmed')
            RETURNING id`,
            [
                bookingData.client_id,
                bookingData.booking_type,
                bookingData.instructor_id,
                bookingData.slot_id,
                normalizedDate, // Используем нормализованную дату
                bookingData.start_time,
                bookingData.end_time,
                bookingData.sport_type,
                bookingData.participants_count,
                bookingData.participants_names,
                bookingData.participants_birth_years,
                bookingData.price_total,
                bookingData.price_per_person,
                bookingData.price_id,
                bookingData.notification_method,
                bookingData.payer_rides,
                bookingData.location
            ]
        );
        
        const bookingId = bookingResult.rows[0].id;
        
        // Обновляем транзакцию
        await client.query(
            `UPDATE kuliga_transactions
             SET booking_id = $1,
                 status = 'completed',
                 provider_status = 'SUCCESS',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [bookingId, transactionId]
        );
        
        await client.query('COMMIT');
        
        // Отправляем уведомления (асинхронно)
        setImmediate(async () => {
            try {
                const { notifyAdminNaturalSlopeTrainingBooking } = require('../bot/notifications/kuliga-notifications');
                const { notifyInstructorKuligaTrainingBooking } = require('../bot/notifications/instructor-notifications');
                const emailService = require('../services/emailService');
                
                // Получаем данные инструктора
                const instructorResult = await pool.query(
                    'SELECT full_name, telegram_id, admin_percentage FROM kuliga_instructors WHERE id = $1',
                    [bookingData.instructor_id]
                );
                
                // Получаем email клиента
                const clientResult = await pool.query(
                    'SELECT email FROM clients WHERE id = $1',
                    [bookingData.client_id]
                );
                const clientEmail = bookingData.client_email || (clientResult.rows[0]?.email);
                
                // Форматируем дату и время для уведомлений
                const dateFormatted = moment.tz(normalizedDate, 'YYYY-MM-DD', TIMEZONE).format('DD.MM.YYYY');
                const timeFormatted = bookingData.start_time ? bookingData.start_time.substring(0, 5) : '';
                const locationText = bookingData.location === 'vorona' ? 'Воронинские горки' : 'Кулига Клаб';
                const sportText = bookingData.sport_type === 'ski' ? 'лыжи' : 'сноуборд';
                
                // Уведомление администратору
                await notifyAdminNaturalSlopeTrainingBooking({
                    client_name: bookingData.client_name,
                    client_phone: bookingData.client_phone,
                    participant_name: bookingData.participants_names[0] || bookingData.client_name,
                    date: normalizedDate,
                    time: bookingData.start_time,
                    sport_type: bookingData.sport_type,
                    instructor_name: bookingData.instructor_name,
                    price: bookingData.price_total,
                    booking_source: 'website',
                    location: bookingData.location
                });
                
                // Уведомление инструктору
                if (instructorResult.rows.length > 0) {
                    const instructor = instructorResult.rows[0];
                    await notifyInstructorKuligaTrainingBooking({
                        booking_type: 'individual',
                        client_name: bookingData.client_name,
                        participant_name: bookingData.participants_names[0] || bookingData.client_name,
                        client_phone: bookingData.client_phone,
                        instructor_name: instructor.full_name,
                        instructor_telegram_id: instructor.telegram_id,
                        admin_percentage: instructor.admin_percentage,
                        date: normalizedDate,
                        time: bookingData.start_time,
                        price: bookingData.price_total,
                        location: bookingData.location
                    });
                }
                
                // Уведомление клиенту по email
                if (clientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
                    try {
                        const emailSubject = `Подтверждение записи на тренировку - ${dateFormatted} ${timeFormatted}`;
                        const emailHtml = `
                            <h2>Ваша запись подтверждена!</h2>
                            <p>Здравствуйте, ${bookingData.client_name}!</p>
                            <p>Ваша запись на тренировку подтверждена:</p>
                            <ul>
                                <li><strong>Дата:</strong> ${dateFormatted}</li>
                                <li><strong>Время:</strong> ${timeFormatted}</li>
                                <li><strong>Инструктор:</strong> ${bookingData.instructor_name}</li>
                                <li><strong>Вид спорта:</strong> ${sportText}</li>
                                <li><strong>Место:</strong> ${locationText}</li>
                                <li><strong>Стоимость:</strong> ${bookingData.price_total} ₽</li>
                            </ul>
                            <p>Ждём вас на тренировке!</p>
                            <p>С уважением,<br>Команда Горностайл72</p>
                        `;
                        
                        await emailService.sendEmail(clientEmail, emailSubject, emailHtml);
                        console.log(`✅ Email уведомление отправлено клиенту ${bookingData.client_name} на ${clientEmail}`);
                    } catch (emailError) {
                        console.error('Ошибка отправки email клиенту:', emailError);
                    }
                } else {
                    console.log(`⚠️ Email клиента не указан или невалиден для транзакции #${transactionId}`);
                }
            } catch (notifyError) {
                console.error('Ошибка при отправке уведомлений после ручного создания бронирования:', notifyError);
            }
        });
        
        res.json({
            success: true,
            message: 'Бронирование успешно создано',
            bookingId,
            transactionId
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Ошибка создания бронирования из транзакции #${transactionId}:`, error);
        res.status(500).json({ error: 'Ошибка сервера при создании бронирования' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/kuliga/stuck-payments/:id/cancel
 * Отменяет транзакцию (если слот занят или по другой причине)
 */
router.post('/:id/cancel', async (req, res) => {
    const transactionId = Number(req.params.id);
    const { reason = 'Отменено администратором' } = req.body;
    
    if (!transactionId) {
        return res.status(400).json({ error: 'Неверный ID транзакции' });
    }
    
    try {
        const result = await pool.query(
            `UPDATE kuliga_transactions
             SET status = 'failed',
                 provider_status = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND booking_id IS NULL
             RETURNING id`,
            [transactionId, reason]
        );
        
        if (!result.rows.length) {
            return res.status(404).json({ error: 'Транзакция не найдена или уже обработана' });
        }
        
        res.json({
            success: true,
            message: 'Транзакция отменена',
            transactionId
        });
        
    } catch (error) {
        console.error(`Ошибка отмены транзакции #${transactionId}:`, error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;

