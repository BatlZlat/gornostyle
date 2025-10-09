const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { notifyBlockCreated, notifyBlockDeleted } = require('../bot/admin-notify');

/**
 * GET /api/schedule-blocks
 * Получить все блокировки
 */
router.get('/', async (req, res) => {
    try {
        const { simulator_id, block_type, is_active } = req.query;
        
        let query = `
            SELECT sb.*, 
                   s.name as simulator_name,
                   a.full_name as created_by_name
            FROM schedule_blocks sb
            LEFT JOIN simulators s ON sb.simulator_id = s.id
            LEFT JOIN administrators a ON sb.created_by = a.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (simulator_id) {
            query += ` AND (sb.simulator_id = $${paramIndex} OR sb.simulator_id IS NULL)`;
            params.push(simulator_id);
            paramIndex++;
        }
        
        if (block_type) {
            query += ` AND sb.block_type = $${paramIndex}`;
            params.push(block_type);
            paramIndex++;
        }
        
        if (is_active !== undefined) {
            query += ` AND sb.is_active = $${paramIndex}`;
            params.push(is_active === 'true');
            paramIndex++;
        }
        
        query += ' ORDER BY sb.created_at DESC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении блокировок:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * GET /api/schedule-blocks/check
 * Проверить, заблокирован ли слот
 */
router.get('/check', async (req, res) => {
    try {
        const { simulator_id, date, start_time, end_time } = req.query;
        
        if (!date || !start_time || !end_time) {
            return res.status(400).json({ error: 'Требуются параметры: date, start_time, end_time' });
        }
        
        const dateObj = new Date(date);
        const dayOfWeek = dateObj.getDay();
        
        // Проверяем блокировки
        const query = `
            SELECT * FROM schedule_blocks
            WHERE is_active = TRUE
            AND (simulator_id = $1 OR simulator_id IS NULL)
            AND (
                (block_type = 'specific' 
                    AND $2::date >= start_date 
                    AND $2::date <= end_date
                    AND start_time < $4::time
                    AND end_time > $3::time
                )
                OR
                (block_type = 'recurring' 
                    AND day_of_week = $5
                    AND start_time < $4::time
                    AND end_time > $3::time
                )
            )
        `;
        
        const result = await pool.query(query, [
            simulator_id || null,
            date,
            start_time,
            end_time,
            dayOfWeek
        ]);
        
        res.json({
            is_blocked: result.rows.length > 0,
            blocks: result.rows
        });
    } catch (error) {
        console.error('Ошибка при проверке блокировки:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * GET /api/schedule-blocks/slots
 * Получить все слоты для диапазона дат с информацией о блокировках и бронированиях
 */
router.get('/slots', async (req, res) => {
    try {
        const { start_date, end_date, simulator_id } = req.query;
        
        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'Требуются параметры: start_date, end_date' });
        }
        
        let query = `
            SELECT 
                s.id,
                s.simulator_id,
                s.date,
                s.start_time,
                s.end_time,
                s.is_booked,
                s.is_holiday,
                sim.name as simulator_name
            FROM schedule s
            LEFT JOIN simulators sim ON s.simulator_id = sim.id
            WHERE s.date >= $1 AND s.date <= $2
        `;
        
        const params = [start_date, end_date];
        
        if (simulator_id) {
            query += ` AND s.simulator_id = $3`;
            params.push(simulator_id);
        }
        
        query += ' ORDER BY s.date, s.simulator_id, s.start_time';
        
        const slotsResult = await pool.query(query, params);
        
        // Получаем все активные блокировки
        const blocksResult = await pool.query(`
            SELECT * FROM schedule_blocks
            WHERE is_active = TRUE
            AND (simulator_id = $1 OR simulator_id IS NULL OR $1 IS NULL)
        `, [simulator_id || null]);
        
        // Получаем все исключения из блокировок для заданного диапазона дат
        const exceptionsResult = await pool.query(`
            SELECT * FROM schedule_block_exceptions
            WHERE date >= $1 AND date <= $2
            AND (simulator_id = $3 OR simulator_id IS NULL OR $3 IS NULL)
        `, [start_date, end_date, simulator_id || null]);
        
        // Обогащаем слоты информацией о блокировках с учётом исключений
        const slots = slotsResult.rows.map(slot => {
            const dateObj = new Date(slot.date);
            const dayOfWeek = dateObj.getDay();
            
            const applicableBlocks = blocksResult.rows.filter(block => {
                if (block.block_type === 'specific') {
                    return slot.date >= block.start_date && slot.date <= block.end_date
                        && slot.start_time <= block.end_time && slot.start_time >= block.start_time
                        && (block.simulator_id === slot.simulator_id || block.simulator_id === null);
                } else if (block.block_type === 'recurring') {
                    return block.day_of_week === dayOfWeek
                        && slot.start_time <= block.end_time && slot.start_time >= block.start_time
                        && (block.simulator_id === slot.simulator_id || block.simulator_id === null);
                }
                return false;
            });
            
            // Проверяем есть ли исключение для этого слота
            const hasException = exceptionsResult.rows.some(exception => {
                return exception.date.toISOString().split('T')[0] === slot.date.toISOString().split('T')[0]
                    && exception.start_time === slot.start_time
                    && (exception.simulator_id === slot.simulator_id || exception.simulator_id === null)
                    && applicableBlocks.some(block => block.id === exception.schedule_block_id);
            });
            
            return {
                ...slot,
                is_blocked: applicableBlocks.length > 0 && !hasException,
                block_reason: applicableBlocks.length > 0 && !hasException ? applicableBlocks[0].reason : null,
                block_id: applicableBlocks.length > 0 ? applicableBlocks[0].id : null
            };
        });
        
        res.json(slots);
    } catch (error) {
        console.error('Ошибка при получении слотов:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * POST /api/schedule-blocks
 * Создать новую блокировку
 */
router.post('/', async (req, res) => {
    try {
        const {
            simulator_id,
            block_type,
            start_date,
            end_date,
            day_of_week,
            start_time,
            end_time,
            reason
        } = req.body;
        
        // Валидация
        if (!block_type || !start_time || !end_time) {
            return res.status(400).json({ error: 'Требуются поля: block_type, start_time, end_time' });
        }
        
        if (block_type === 'specific' && (!start_date || !end_date)) {
            return res.status(400).json({ error: 'Для типа "specific" требуются start_date и end_date' });
        }
        
        if (block_type === 'recurring' && day_of_week === undefined) {
            return res.status(400).json({ error: 'Для типа "recurring" требуется day_of_week' });
        }
        
        // Проверяем конфликты с существующими бронированиями
        if (block_type === 'specific') {
            const conflictQuery = `
                SELECT COUNT(*) as count
                FROM schedule s
                WHERE s.is_booked = TRUE
                AND s.date >= $1 AND s.date <= $2
                AND s.start_time < $4::time AND s.end_time > $3::time
                AND (s.simulator_id = $5 OR $5 IS NULL)
            `;
            
            const conflictResult = await pool.query(conflictQuery, [
                start_date,
                end_date,
                start_time,
                end_time,
                simulator_id
            ]);
            
            if (conflictResult.rows[0].count > 0) {
                return res.status(409).json({ 
                    error: 'Конфликт: найдены забронированные слоты в указанном диапазоне',
                    conflicting_bookings: conflictResult.rows[0].count
                });
            }
        }
        
        const result = await pool.query(
            `INSERT INTO schedule_blocks (
                simulator_id, block_type, start_date, end_date, 
                day_of_week, start_time, end_time, reason, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
            RETURNING *`,
            [
                simulator_id || null,
                block_type,
                start_date || null,
                end_date || null,
                day_of_week !== undefined ? day_of_week : null,
                start_time,
                end_time,
                reason || null
            ]
        );
        
        console.log('Блокировка успешно создана:', result.rows[0]);
        
        // Применяем блокировку к существующим слотам в таблице schedule
        try {
            if (block_type === 'specific') {
                // Для конкретных дат
                await pool.query(
                    `UPDATE schedule
                     SET is_booked = true
                     WHERE date >= $1 AND date <= $2
                     AND (simulator_id = $3 OR $3 IS NULL)
                     AND start_time <= $5
                     AND start_time >= $4
                     AND is_booked = false`,
                    [start_date, end_date, simulator_id, start_time, end_time]
                );
                console.log('Блокировка применена к schedule для конкретных дат');
            } else if (block_type === 'recurring') {
                // Для постоянных блокировок - находим все даты с этим днем недели
                const futureDatesResult = await pool.query(
                    `SELECT DISTINCT date FROM schedule
                     WHERE date >= CURRENT_DATE
                     AND EXTRACT(DOW FROM date) = $1
                     ORDER BY date`,
                    [day_of_week]
                );
                
                for (const row of futureDatesResult.rows) {
                    await pool.query(
                        `UPDATE schedule
                         SET is_booked = true
                         WHERE date = $1
                         AND (simulator_id = $2 OR $2 IS NULL)
                         AND start_time <= $4
                         AND start_time >= $3
                         AND is_booked = false`,
                        [row.date, simulator_id, start_time, end_time]
                    );
                }
                console.log('Блокировка применена к schedule для постоянных дат');
            }
        } catch (scheduleError) {
            console.error('Ошибка при применении блокировки к schedule:', scheduleError);
        }
        
        // Отправляем уведомление администратору
        try {
            const simulatorResult = simulator_id ? await pool.query('SELECT name FROM simulators WHERE id = $1', [simulator_id]) : null;
            
            await notifyBlockCreated({
                reason: result.rows[0].reason,
                block_type: result.rows[0].block_type,
                start_date: result.rows[0].start_date,
                end_date: result.rows[0].end_date,
                day_of_week: result.rows[0].day_of_week,
                start_time: result.rows[0].start_time,
                end_time: result.rows[0].end_time,
                simulator_name: simulatorResult?.rows[0]?.name
            });
        } catch (notificationError) {
            console.error('Ошибка при отправке уведомления о создании блокировки:', notificationError);
        }
        
        res.status(201).json({
            message: 'Блокировка успешно создана и применена к расписанию',
            block: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при создании блокировки:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * PUT /api/schedule-blocks/:id
 * Обновить блокировку
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            simulator_id,
            block_type,
            start_date,
            end_date,
            day_of_week,
            start_time,
            end_time,
            reason,
            is_active
        } = req.body;
        
        const result = await pool.query(
            `UPDATE schedule_blocks SET
                simulator_id = COALESCE($1, simulator_id),
                block_type = COALESCE($2, block_type),
                start_date = COALESCE($3, start_date),
                end_date = COALESCE($4, end_date),
                day_of_week = COALESCE($5, day_of_week),
                start_time = COALESCE($6, start_time),
                end_time = COALESCE($7, end_time),
                reason = COALESCE($8, reason),
                is_active = COALESCE($9, is_active)
            WHERE id = $10
            RETURNING *`,
            [
                simulator_id !== undefined ? simulator_id : null,
                block_type,
                start_date,
                end_date,
                day_of_week,
                start_time,
                end_time,
                reason,
                is_active,
                id
            ]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Блокировка не найдена' });
        }
        
        res.json({
            message: 'Блокировка успешно обновлена',
            block: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при обновлении блокировки:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * DELETE /api/schedule-blocks/:id
 * Удалить блокировку
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Сначала получаем данные блокировки для уведомления
        const blockResult = await pool.query(
            `SELECT sb.*, s.name as simulator_name
             FROM schedule_blocks sb
             LEFT JOIN simulators s ON sb.simulator_id = s.id
             WHERE sb.id = $1`,
            [id]
        );
        
        if (blockResult.rows.length === 0) {
            return res.status(404).json({ error: 'Блокировка не найдена' });
        }
        
        const blockData = blockResult.rows[0];
        
        // Освобождаем слоты в таблице schedule перед удалением блокировки
        try {
            if (blockData.block_type === 'specific') {
                // Для конкретных дат - просто освобождаем слоты
                // НО только те, которые не имеют реальных бронирований (не связаны с training_sessions)
                await pool.query(
                    `UPDATE schedule
                     SET is_booked = false
                     WHERE date >= $1 AND date <= $2
                     AND (simulator_id = $3 OR $3 IS NULL)
                     AND start_time < $5
                     AND end_time > $4
                     AND is_booked = true
                     AND id NOT IN (
                         SELECT DISTINCT s.id
                         FROM schedule s
                         JOIN training_sessions ts ON 
                             s.date = ts.session_date 
                             AND s.simulator_id = ts.simulator_id
                             AND s.start_time < ts.end_time
                             AND s.end_time > ts.start_time
                     )`,
                    [blockData.start_date, blockData.end_date, blockData.simulator_id, blockData.start_time, blockData.end_time]
                );
                console.log('Слоты освобождены в schedule для конкретных дат');
            } else if (blockData.block_type === 'recurring') {
                // Для постоянных блокировок
                const futureDatesResult = await pool.query(
                    `SELECT DISTINCT date FROM schedule
                     WHERE date >= CURRENT_DATE
                     AND EXTRACT(DOW FROM date) = $1
                     ORDER BY date`,
                    [blockData.day_of_week]
                );
                
                for (const row of futureDatesResult.rows) {
                    await pool.query(
                        `UPDATE schedule
                         SET is_booked = false
                         WHERE date = $1
                         AND (simulator_id = $2 OR $2 IS NULL)
                         AND start_time < $4
                         AND end_time > $3
                         AND is_booked = true
                         AND id NOT IN (
                             SELECT DISTINCT s.id
                             FROM schedule s
                             JOIN training_sessions ts ON 
                                 s.date = ts.session_date 
                                 AND s.simulator_id = ts.simulator_id
                                 AND s.start_time < ts.end_time
                                 AND s.end_time > ts.start_time
                         )`,
                        [row.date, blockData.simulator_id, blockData.start_time, blockData.end_time]
                    );
                }
                console.log('Слоты освобождены в schedule для постоянных дат');
            }
        } catch (scheduleError) {
            console.error('Ошибка при освобождении слотов в schedule:', scheduleError);
        }
        
        // Удаляем блокировку
        await pool.query('DELETE FROM schedule_blocks WHERE id = $1', [id]);
        
        // Отправляем уведомление администратору
        try {
            await notifyBlockDeleted({
                reason: blockData.reason,
                block_type: blockData.block_type,
                start_date: blockData.start_date,
                end_date: blockData.end_date,
                day_of_week: blockData.day_of_week,
                start_time: blockData.start_time,
                end_time: blockData.end_time,
                simulator_name: blockData.simulator_name
            });
        } catch (notificationError) {
            console.error('Ошибка при отправке уведомления об удалении блокировки:', notificationError);
        }
        
        res.json({
            message: 'Блокировка успешно удалена',
            block: blockData
        });
    } catch (error) {
        console.error('Ошибка при удалении блокировки:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * PATCH /api/schedule-blocks/:id/toggle
 * Переключить статус активности блокировки
 */
router.patch('/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            `UPDATE schedule_blocks 
             SET is_active = NOT is_active 
             WHERE id = $1 
             RETURNING *`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Блокировка не найдена' });
        }
        
        res.json({
            message: 'Статус блокировки изменен',
            block: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при изменении статуса блокировки:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * POST /api/schedule-blocks/apply-all
 * Применить все активные блокировки к существующему расписанию
 */
router.post('/apply-all', async (req, res) => {
    try {
        const blocksResult = await pool.query(
            'SELECT * FROM schedule_blocks WHERE is_active = TRUE'
        );
        
        let appliedCount = 0;
        
        for (const block of blocksResult.rows) {
            if (block.block_type === 'specific') {
                const result = await pool.query(
                    `UPDATE schedule
                     SET is_booked = true
                     WHERE date >= $1 AND date <= $2
                     AND (simulator_id = $3 OR $3 IS NULL)
                     AND start_time <= $5
                     AND start_time >= $4
                     AND is_booked = false`,
                    [block.start_date, block.end_date, block.simulator_id, block.start_time, block.end_time]
                );
                appliedCount += result.rowCount;
            } else if (block.block_type === 'recurring') {
                const futureDatesResult = await pool.query(
                    `SELECT DISTINCT date FROM schedule
                     WHERE date >= CURRENT_DATE
                     AND EXTRACT(DOW FROM date) = $1
                     ORDER BY date`,
                    [block.day_of_week]
                );
                
                for (const row of futureDatesResult.rows) {
                    const result = await pool.query(
                        `UPDATE schedule
                         SET is_booked = true
                         WHERE date = $1
                         AND (simulator_id = $2 OR $2 IS NULL)
                         AND start_time <= $4
                         AND start_time >= $3
                         AND is_booked = false`,
                        [row.date, block.simulator_id, block.start_time, block.end_time]
                    );
                    appliedCount += result.rowCount;
                }
            }
        }
        
        res.json({
            message: 'Блокировки применены к расписанию',
            applied_slots: appliedCount,
            blocks_count: blocksResult.rows.length
        });
    } catch (error) {
        console.error('Ошибка при применении блокировок:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * POST /api/schedule-blocks/bulk
 * Массовое создание блокировок
 */
router.post('/bulk', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { blocks } = req.body;
        
        if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
            return res.status(400).json({ error: 'Требуется массив blocks' });
        }
        
        const created = [];
        const errors = [];
        
        for (const block of blocks) {
            try {
                const result = await client.query(
                    `INSERT INTO schedule_blocks (
                        simulator_id, block_type, start_date, end_date, 
                        day_of_week, start_time, end_time, reason, is_active
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
                    RETURNING *`,
                    [
                        block.simulator_id || null,
                        block.block_type,
                        block.start_date || null,
                        block.end_date || null,
                        block.day_of_week !== undefined ? block.day_of_week : null,
                        block.start_time,
                        block.end_time,
                        block.reason || null
                    ]
                );
                created.push(result.rows[0]);
            } catch (error) {
                errors.push({
                    block,
                    error: error.message
                });
            }
        }
        
        await client.query('COMMIT');
        
        res.json({
            message: `Создано блокировок: ${created.length}`,
            created,
            errors
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при массовом создании блокировок:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * POST /api/schedule-blocks/exceptions
 * Создать исключение из блокировки (точечно снять блокировку с одного слота)
 */
router.post('/exceptions', async (req, res) => {
    try {
        const { schedule_block_id, date, start_time, simulator_id } = req.body;
        
        // Валидация
        if (!schedule_block_id || !date || !start_time) {
            return res.status(400).json({ error: 'Требуются поля: schedule_block_id, date, start_time' });
        }
        
        // Проверяем что блокировка существует
        const blockResult = await pool.query(
            'SELECT * FROM schedule_blocks WHERE id = $1',
            [schedule_block_id]
        );
        
        if (blockResult.rows.length === 0) {
            return res.status(404).json({ error: 'Блокировка не найдена' });
        }
        
        // Создаём исключение
        const exceptionResult = await pool.query(
            `INSERT INTO schedule_block_exceptions 
             (schedule_block_id, date, start_time, simulator_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (schedule_block_id, date, start_time, simulator_id) 
             DO NOTHING
             RETURNING *`,
            [schedule_block_id, date, start_time, simulator_id || null]
        );
        
        // Освобождаем слот в schedule
        await pool.query(
            `UPDATE schedule
             SET is_booked = false
             WHERE date = $1
             AND start_time = $2
             AND (simulator_id = $3 OR $3 IS NULL)
             AND is_booked = true
             AND id NOT IN (
                 SELECT DISTINCT s.id
                 FROM schedule s
                 JOIN training_sessions ts ON 
                     s.date = ts.session_date 
                     AND s.simulator_id = ts.simulator_id
                     AND s.start_time < ts.end_time
                     AND s.end_time > ts.start_time
             )`,
            [date, start_time, simulator_id || null]
        );
        
        res.json({
            message: 'Исключение создано, слот освобождён',
            exception: exceptionResult.rows[0] || null
        });
    } catch (error) {
        console.error('Ошибка при создании исключения:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

module.exports = router;

