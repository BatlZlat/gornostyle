const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { verifyTrainerToken } = require('../middleware/trainerAuth');

// Все роуты защищены middleware аутентификации
router.use(verifyTrainerToken);

/**
 * GET /api/trainer/schedule
 * Получить расписание на 2 месяца вперед
 */
router.get('/schedule', async (req, res) => {
    try {
        const { simulator_id } = req.query;
        
        // Рассчитываем даты: сегодня и +2 месяца
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const twoMonthsLater = new Date(today);
        twoMonthsLater.setMonth(twoMonthsLater.getMonth() + 2);
        
        // Получаем все слоты из schedule
        let scheduleQuery = `
            SELECT 
                s.id,
                s.simulator_id,
                s.date,
                s.start_time,
                s.end_time,
                s.is_booked,
                s.is_holiday,
                sim.name as simulator_name,
                sim.is_working as simulator_is_working,
                sim.working_hours_start,
                sim.working_hours_end
            FROM schedule s
            LEFT JOIN simulators sim ON s.simulator_id = sim.id
            WHERE s.date >= $1 AND s.date <= $2
        `;
        
        const params = [today.toISOString().split('T')[0], twoMonthsLater.toISOString().split('T')[0]];
        
        if (simulator_id) {
            scheduleQuery += ` AND s.simulator_id = $3`;
            params.push(simulator_id);
        }
        
        scheduleQuery += ' ORDER BY s.date, s.simulator_id, s.start_time';
        
        const scheduleResult = await pool.query(scheduleQuery, params);
        
        // Получаем все активные блокировки (админские и тренерские)
        const blocksResult = await pool.query(`
            SELECT sb.*, 
                   t.full_name as trainer_name,
                   a.full_name as admin_name
            FROM schedule_blocks sb
            LEFT JOIN trainers t ON sb.trainer_id = t.id
            LEFT JOIN administrators a ON sb.created_by = a.id
            WHERE sb.is_active = TRUE
            AND (sb.simulator_id = $1 OR sb.simulator_id IS NULL OR $1 IS NULL)
        `, [simulator_id || null]);
        
        // Получаем исключения из блокировок
        const exceptionsResult = await pool.query(`
            SELECT * FROM schedule_block_exceptions
            WHERE date >= $1 AND date <= $2
            AND (simulator_id = $3 OR simulator_id IS NULL OR $3 IS NULL)
        `, [
            today.toISOString().split('T')[0], 
            twoMonthsLater.toISOString().split('T')[0],
            simulator_id || null
        ]);
        
        // Получаем все тренировки
        const trainingsResult = await pool.query(`
            SELECT 
                ts.id,
                ts.simulator_id,
                ts.session_date,
                ts.start_time,
                ts.end_time,
                ts.training_type,
                g.name as group_name,
                t.full_name as trainer_name
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            WHERE ts.session_date >= $1 AND ts.session_date <= $2
            AND ts.status = 'scheduled'
        `, [today.toISOString().split('T')[0], twoMonthsLater.toISOString().split('T')[0]]);
        
        // Обогащаем слоты информацией о блокировках, исключениях и тренировках
        const enrichedSlots = scheduleResult.rows.map(slot => {
            const dateObj = new Date(slot.date);
            const dayOfWeek = dateObj.getDay();
            
            // Проверяем блокировки
            const applicableBlocks = blocksResult.rows.filter(block => {
                if (block.block_type === 'specific') {
                    const slotDate = slot.date.toISOString().split('T')[0];
                    const blockStartDate = block.start_date.toISOString().split('T')[0];
                    const blockEndDate = block.end_date.toISOString().split('T')[0];
                    
                    return slotDate >= blockStartDate && slotDate <= blockEndDate
                        && slot.start_time >= block.start_time && slot.start_time <= block.end_time
                        && (block.simulator_id === slot.simulator_id || block.simulator_id === null);
                } else if (block.block_type === 'recurring') {
                    return block.day_of_week === dayOfWeek
                        && slot.start_time >= block.start_time && slot.start_time <= block.end_time
                        && (block.simulator_id === slot.simulator_id || block.simulator_id === null);
                }
                return false;
            });
            
            // Проверяем исключения
            const hasException = exceptionsResult.rows.some(exception => {
                return exception.date.toISOString().split('T')[0] === slot.date.toISOString().split('T')[0]
                    && exception.start_time === slot.start_time
                    && (exception.simulator_id === slot.simulator_id || exception.simulator_id === null)
                    && applicableBlocks.some(block => block.id === exception.schedule_block_id);
            });
            
            // Проверяем тренировки
            const training = trainingsResult.rows.find(t => {
                return t.simulator_id === slot.simulator_id
                    && t.session_date.toISOString().split('T')[0] === slot.date.toISOString().split('T')[0]
                    && slot.start_time >= t.start_time 
                    && slot.start_time < t.end_time;
            });
            
            // Определяем причину блокировки
            let blockReason = null;
            let blockedByTrainer = false;
            let blockedByAdmin = false;
            let blockId = null;
            
            if (applicableBlocks.length > 0 && !hasException) {
                const block = applicableBlocks[0];
                blockId = block.id;
                
                if (block.trainer_id) {
                    blockReason = block.trainer_name || 'Тренер';
                    blockedByTrainer = true;
                } else if (block.blocked_by_type === 'admin' || block.created_by) {
                    blockReason = block.reason || 'Блокировка администратора';
                    blockedByAdmin = true;
                }
            }
            
            return {
                ...slot,
                date: slot.date.toISOString().split('T')[0],
                is_blocked: (applicableBlocks.length > 0 && !hasException) || training !== undefined,
                block_reason: training ? 'Занят 📅' : blockReason,
                block_id: blockId,
                blocked_by_trainer: blockedByTrainer,
                blocked_by_admin: blockedByAdmin,
                has_training: training !== undefined,
                training_info: training ? {
                    id: training.id,
                    type: training.training_type ? 'Групповая' : 'Индивидуальная',
                    groupName: training.group_name,
                    trainerName: training.trainer_name
                } : null
            };
        });
        
        res.json(enrichedSlots);
    } catch (error) {
        console.error('Ошибка при получении расписания для тренера:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * GET /api/trainer/my-bookings
 * Получить свои бронирования
 */
router.get('/my-bookings', async (req, res) => {
    try {
        const trainerId = req.trainer.id;
        
        const result = await pool.query(`
            SELECT sb.*,
                   s.name as simulator_name
            FROM schedule_blocks sb
            LEFT JOIN simulators s ON sb.simulator_id = s.id
            WHERE sb.trainer_id = $1
            AND sb.is_active = TRUE
            ORDER BY 
                CASE 
                    WHEN sb.block_type = 'specific' THEN sb.start_date
                    ELSE CURRENT_DATE
                END,
                sb.start_time
        `, [trainerId]);
        
        res.json(result.rows.map(row => ({
            ...row,
            start_date: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
            end_date: row.end_date ? row.end_date.toISOString().split('T')[0] : null
        })));
    } catch (error) {
        console.error('Ошибка при получении бронирований тренера:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * POST /api/trainer/bookings
 * Создать бронирование
 */
router.post('/bookings', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const {
            simulator_id,
            date,
            start_time,
            end_time
        } = req.body;
        
        const trainerId = req.trainer.id;
        const trainerName = req.trainer.fullName;
        
        // Валидация
        if (!simulator_id || !date || !start_time || !end_time) {
            return res.status(400).json({ 
                error: 'Требуются поля: simulator_id, date, start_time, end_time' 
            });
        }
        
        // Проверка: бронирование только на неделю вперед
        const bookingDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const oneWeekLater = new Date(today);
        oneWeekLater.setDate(oneWeekLater.getDate() + 7);
        
        if (bookingDate < today) {
            return res.status(400).json({ 
                error: 'Нельзя бронировать время в прошлом' 
            });
        }
        
        if (bookingDate > oneWeekLater) {
            return res.status(400).json({ 
                error: 'Можно бронировать только на неделю вперед' 
            });
        }
        
        // Проверка: тренажер работает
        const simulatorCheck = await client.query(
            'SELECT is_working, working_hours_start, working_hours_end FROM simulators WHERE id = $1',
            [simulator_id]
        );
        
        if (simulatorCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Тренажер не найден' });
        }
        
        if (!simulatorCheck.rows[0].is_working) {
            return res.status(400).json({ 
                error: 'Тренажер не работает' 
            });
        }
        
        // Проверка: слот в рабочее время тренажера
        const workingStart = simulatorCheck.rows[0].working_hours_start;
        const workingEnd = simulatorCheck.rows[0].working_hours_end;
        
        if (start_time < workingStart || end_time > workingEnd) {
            return res.status(400).json({ 
                error: `Тренажер работает с ${workingStart} до ${workingEnd}` 
            });
        }
        
        // Проверка: слот свободен (не забронирован)
        const slotCheck = await client.query(
            `SELECT id, is_booked FROM schedule 
             WHERE simulator_id = $1 
             AND date = $2 
             AND start_time >= $3 
             AND start_time < $4`,
            [simulator_id, date, start_time, end_time]
        );
        
        if (slotCheck.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Слот не найден в расписании' 
            });
        }
        
        const bookedSlots = slotCheck.rows.filter(slot => slot.is_booked);
        if (bookedSlots.length > 0) {
            return res.status(409).json({ 
                error: 'Слот уже забронирован',
                details: 'Выбранное время уже занято'
            });
        }
        
        // Проверка: нет тренировок в это время
        const trainingCheck = await client.query(
            `SELECT id FROM training_sessions
             WHERE simulator_id = $1
             AND session_date = $2
             AND start_time < $4
             AND end_time > $3
             AND status = 'scheduled'`,
            [simulator_id, date, start_time, end_time]
        );
        
        if (trainingCheck.rows.length > 0) {
            return res.status(409).json({ 
                error: 'В это время запланирована тренировка',
                details: 'Выбранное время занято тренировкой'
            });
        }
        
        // Создаем блокировку от имени тренера
        const blockResult = await client.query(
            `INSERT INTO schedule_blocks (
                simulator_id,
                trainer_id,
                blocked_by_type,
                block_type,
                start_date,
                end_date,
                start_time,
                end_time,
                reason,
                is_active
            ) VALUES ($1, $2, 'trainer', 'specific', $3, $3, $4, $5, $6, TRUE)
            RETURNING *`,
            [
                simulator_id,
                trainerId,
                date,
                start_time,
                end_time,
                trainerName // ФИО тренера в причине
            ]
        );
        
        const booking = blockResult.rows[0];
        
        // Помечаем слоты как забронированные
        await client.query(
            `UPDATE schedule
             SET is_booked = TRUE
             WHERE simulator_id = $1
             AND date = $2
             AND start_time >= $3
             AND start_time < $4`,
            [simulator_id, date, start_time, end_time]
        );
        
        await client.query('COMMIT');
        
        console.log(`✓ Тренер ${trainerName} (ID: ${trainerId}) забронировал ${date} ${start_time}-${end_time} на тренажере ${simulator_id}`);
        
        // Отправляем уведомление администраторам (будет реализовано в следующей задаче)
        try {
            const { notifyTrainerBookingCreated } = require('../bot/admin-notify');
            await notifyTrainerBookingCreated({
                trainerName,
                date,
                startTime: start_time,
                endTime: end_time,
                simulatorId: simulator_id
            });
        } catch (notificationError) {
            console.error('Ошибка при отправке уведомления о бронировании:', notificationError);
            // Не прерываем выполнение, если уведомление не отправилось
        }
        
        res.status(201).json({
            message: 'Бронирование создано успешно',
            booking: {
                ...booking,
                start_date: booking.start_date.toISOString().split('T')[0],
                end_date: booking.end_date.toISOString().split('T')[0]
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании бронирования тренера:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * DELETE /api/trainer/bookings/:id
 * Отменить свое бронирование
 */
router.delete('/bookings/:id', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { id } = req.params;
        const trainerId = req.trainer.id;
        const trainerName = req.trainer.fullName;
        
        // Получаем информацию о бронировании
        const bookingResult = await client.query(
            `SELECT sb.*, s.name as simulator_name
             FROM schedule_blocks sb
             LEFT JOIN simulators s ON sb.simulator_id = s.id
             WHERE sb.id = $1`,
            [id]
        );
        
        if (bookingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Бронирование не найдено' });
        }
        
        const booking = bookingResult.rows[0];
        
        // Проверка: это бронирование принадлежит текущему тренеру
        if (booking.trainer_id !== trainerId) {
            return res.status(403).json({ 
                error: 'Нельзя отменить чужое бронирование' 
            });
        }
        
        // Удаляем блокировку
        await client.query(
            'DELETE FROM schedule_blocks WHERE id = $1',
            [id]
        );
        
        // Освобождаем слоты (только те, которые не заняты тренировками)
        await client.query(
            `UPDATE schedule
             SET is_booked = FALSE
             WHERE date = $1
             AND start_time >= $2
             AND start_time < $3
             AND simulator_id = $4
             AND is_booked = TRUE
             AND id NOT IN (
                 SELECT DISTINCT s.id
                 FROM schedule s
                 JOIN training_sessions ts ON 
                     s.date = ts.session_date 
                     AND s.simulator_id = ts.simulator_id
                     AND s.start_time < ts.end_time
                     AND s.end_time > ts.start_time
             )`,
            [booking.start_date, booking.start_time, booking.end_time, booking.simulator_id]
        );
        
        await client.query('COMMIT');
        
        console.log(`✓ Тренер ${trainerName} (ID: ${trainerId}) отменил бронирование #${id}`);
        
        // Отправляем уведомление администраторам (будет реализовано в следующей задаче)
        try {
            const { notifyTrainerBookingCancelled } = require('../bot/admin-notify');
            await notifyTrainerBookingCancelled({
                trainerName,
                date: booking.start_date.toISOString().split('T')[0],
                startTime: booking.start_time,
                endTime: booking.end_time,
                simulatorId: booking.simulator_id,
                simulatorName: booking.simulator_name
            });
        } catch (notificationError) {
            console.error('Ошибка при отправке уведомления об отмене бронирования:', notificationError);
            // Не прерываем выполнение
        }
        
        res.json({
            message: 'Бронирование отменено успешно',
            booking: {
                id: booking.id,
                date: booking.start_date.toISOString().split('T')[0],
                startTime: booking.start_time,
                endTime: booking.end_time
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при отмене бронирования тренера:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    } finally {
        client.release();
    }
});

module.exports = router;

