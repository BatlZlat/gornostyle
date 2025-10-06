const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { notifyAdminGroupTrainingCancellationByAdmin } = require('../bot/admin-notify');

/**
 * GET /api/recurring-templates
 * Получить все шаблоны постоянного расписания
 */
router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                t.*,
                g.name as group_name,
                tr.full_name as trainer_name,
                s.name as simulator_name,
                CASE t.day_of_week
                    WHEN 0 THEN 'Воскресенье'
                    WHEN 1 THEN 'Понедельник'
                    WHEN 2 THEN 'Вторник'
                    WHEN 3 THEN 'Среда'
                    WHEN 4 THEN 'Четверг'
                    WHEN 5 THEN 'Пятница'
                    WHEN 6 THEN 'Суббота'
                END as day_name,
                (
                    SELECT COUNT(*) 
                    FROM training_sessions ts 
                    WHERE ts.template_id = t.id 
                    AND ts.session_date >= CURRENT_DATE
                    AND ts.status = 'scheduled'
                ) as future_trainings_count
            FROM recurring_training_templates t
            LEFT JOIN groups g ON t.group_id = g.id
            LEFT JOIN trainers tr ON t.trainer_id = tr.id
            LEFT JOIN simulators s ON t.simulator_id = s.id
            ORDER BY t.day_of_week, t.start_time
        `;
        
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении шаблонов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

/**
 * GET /api/recurring-templates/:id
 * Получить конкретный шаблон по ID
 */
router.get('/:id', async (req, res) => {
    try {
        const query = `
            SELECT 
                t.*,
                g.name as group_name,
                tr.full_name as trainer_name,
                s.name as simulator_name
            FROM recurring_training_templates t
            LEFT JOIN groups g ON t.group_id = g.id
            LEFT JOIN trainers tr ON t.trainer_id = tr.id
            LEFT JOIN simulators s ON t.simulator_id = s.id
            WHERE t.id = $1
        `;
        
        const result = await pool.query(query, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении шаблона:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

/**
 * POST /api/recurring-templates
 * Создать новый шаблон
 */
router.post('/', async (req, res) => {
    console.log('Создание нового шаблона:', req.body);
    
    const {
        name,
        day_of_week,
        start_time,
        simulator_id,
        trainer_id,
        group_id,
        skill_level,
        max_participants,
        equipment_type
    } = req.body;
    
    // Валидация обязательных полей
    if (!name) {
        return res.status(400).json({ error: 'Название шаблона обязательно' });
    }
    
    if (day_of_week === undefined || day_of_week === null || day_of_week < 0 || day_of_week > 6) {
        return res.status(400).json({ error: 'День недели должен быть от 0 до 6' });
    }
    
    if (!start_time) {
        return res.status(400).json({ error: 'Время начала обязательно' });
    }
    
    if (!simulator_id) {
        return res.status(400).json({ error: 'Тренажер обязателен' });
    }
    
    if (!group_id) {
        return res.status(400).json({ error: 'Группа обязательна' });
    }
    
    try {
        // Проверяем, не существует ли уже шаблон на это время
        const conflictCheck = await pool.query(
            `SELECT id, name FROM recurring_training_templates 
             WHERE day_of_week = $1 
             AND start_time = $2 
             AND simulator_id = $3 
             AND is_active = TRUE`,
            [day_of_week, start_time, simulator_id]
        );
        
        if (conflictCheck.rows.length > 0) {
            return res.status(409).json({ 
                error: 'Конфликт: шаблон на это время уже существует',
                conflict_with: conflictCheck.rows[0].name
            });
        }
        
        const result = await pool.query(
            `INSERT INTO recurring_training_templates (
                name, day_of_week, start_time, simulator_id, trainer_id, group_id,
                skill_level, max_participants, equipment_type, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE) 
            RETURNING *`,
            [
                name,
                day_of_week,
                start_time,
                simulator_id,
                trainer_id || null,
                group_id,
                skill_level || 1,
                max_participants || 4,
                equipment_type || 'ski'
            ]
        );
        
        console.log('Шаблон успешно создан:', result.rows[0]);
        res.status(201).json({
            message: 'Шаблон успешно создан',
            template: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при создании шаблона:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * PUT /api/recurring-templates/:id
 * Обновить существующий шаблон
 * ВАЖНО: Не обновляет существующие тренировки, только влияет на новые создания
 */
router.put('/:id', async (req, res) => {
    console.log('Обновление шаблона:', req.params.id, req.body);
    
    const {
        name,
        day_of_week,
        start_time,
        simulator_id,
        trainer_id,
        group_id,
        skill_level,
        max_participants,
        equipment_type
    } = req.body;
    
    // Валидация обязательных полей
    if (!name) {
        return res.status(400).json({ error: 'Название шаблона обязательно' });
    }
    
    if (day_of_week < 0 || day_of_week > 6) {
        return res.status(400).json({ error: 'День недели должен быть от 0 до 6' });
    }
    
    if (!start_time) {
        return res.status(400).json({ error: 'Время начала обязательно' });
    }
    
    if (!simulator_id) {
        return res.status(400).json({ error: 'Тренажер обязателен' });
    }
    
    if (!group_id) {
        return res.status(400).json({ error: 'Группа обязательна' });
    }
    
    try {
        const result = await pool.query(
            `UPDATE recurring_training_templates 
             SET name = $1, day_of_week = $2, start_time = $3, simulator_id = $4,
                 trainer_id = $5, group_id = $6, skill_level = $7, 
                 max_participants = $8, equipment_type = $9,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $10 
             RETURNING *`,
            [
                name,
                day_of_week,
                start_time,
                simulator_id,
                trainer_id || null,
                group_id,
                skill_level || 1,
                max_participants || 4,
                equipment_type || 'ski',
                req.params.id
            ]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не найден' });
        }
        
        console.log('Шаблон успешно обновлён:', result.rows[0]);
        res.json({
            message: 'Шаблон успешно обновлён',
            template: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при обновлении шаблона:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * DELETE /api/recurring-templates/:id
 * Удалить шаблон и все БУДУЩИЕ тренировки, созданные по нему
 */
router.delete('/:id', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Получаем все будущие тренировки, созданные по этому шаблону
        const trainingsResult = await client.query(
            `SELECT ts.*, g.name as group_name, t.full_name as trainer_name, s.name as simulator_name
             FROM training_sessions ts
             LEFT JOIN groups g ON ts.group_id = g.id
             LEFT JOIN trainers t ON ts.trainer_id = t.id
             LEFT JOIN simulators s ON ts.simulator_id = s.id
             WHERE ts.template_id = $1 
             AND ts.session_date >= CURRENT_DATE
             AND ts.status = 'scheduled'`,
            [req.params.id]
        );
        
        const trainings = trainingsResult.rows;
        console.log(`Найдено будущих тренировок для удаления: ${trainings.length}`);
        
        // Обрабатываем каждую тренировку с возвратом средств и уведомлениями
        let totalRefund = 0;
        const allRefunds = [];
        
        for (const training of trainings) {
            const price = Number(training.price);
            
            // Получаем участников тренировки
            const participantsResult = await client.query(`
                SELECT sp.id, sp.client_id, c.full_name, c.telegram_id, c.birth_date
                FROM session_participants sp
                LEFT JOIN clients c ON sp.client_id = c.id
                WHERE sp.session_id = $1 AND sp.status = 'confirmed'
            `, [training.id]);
            const participants = participantsResult.rows;
            
            // Возвращаем средства каждому участнику
            for (const participant of participants) {
                const walletResult = await client.query('SELECT id, balance FROM wallets WHERE client_id = $1', [participant.client_id]);
                if (walletResult.rows.length === 0) continue;
                
                const wallet = walletResult.rows[0];
                const newBalance = Number(wallet.balance) + price;
                
                // Обновляем баланс кошелька
                await client.query('UPDATE wallets SET balance = $1, last_updated = NOW() WHERE id = $2', [newBalance, wallet.id]);
                
                // Создаем транзакцию возврата
                const dateObj = new Date(training.session_date);
                const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;
                const startTime = training.start_time ? training.start_time.slice(0,5) : '';
                const duration = training.duration || 60;
                
                await client.query(
                    'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                    [wallet.id, price, 'amount', `Возврат (отмена шаблона): Группа, ${participant.full_name}, Дата: ${formattedDate}, Время: ${startTime}, Длительность: ${duration} мин.`]
                );
                
                allRefunds.push({
                    full_name: participant.full_name,
                    telegram_id: participant.telegram_id,
                    client_id: participant.client_id,
                    amount: price,
                    birth_date: participant.birth_date
                });
                totalRefund += price;
            }
            
            // Освобождаем слоты в расписании
            await client.query(
                `UPDATE schedule 
                 SET is_booked = false 
                 WHERE simulator_id = $1 
                 AND date = $2 
                 AND start_time >= $3 
                 AND start_time < $4`,
                [training.simulator_id, training.session_date, training.start_time, training.end_time]
            );
            
            // Удаляем тренировку
            await client.query('DELETE FROM training_sessions WHERE id = $1', [training.id]);
        }
        
        console.log(`Удалено тренировок: ${trainings.length}, возвращено средств: ${totalRefund}`);
        
        // Удаляем сам шаблон
        const deleteTemplateResult = await client.query(
            'DELETE FROM recurring_training_templates WHERE id = $1 RETURNING name',
            [req.params.id]
        );
        
        if (deleteTemplateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Шаблон не найден' });
        }
        
        await client.query('COMMIT');
        
        // Отправляем уведомления администратору
        if (allRefunds.length > 0) {
            try {
                // Рассчитываем возраст участников
                const calculateAge = (birthDate) => {
                    if (!birthDate) return null;
                    const today = new Date();
                    const birth = new Date(birthDate);
                    let age = today.getFullYear() - birth.getFullYear();
                    const monthDiff = today.getMonth() - birth.getMonth();
                    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
                        age--;
                    }
                    return age;
                };
                
                const participantsWithAge = allRefunds.map(refund => ({
                    ...refund,
                    age: calculateAge(refund.birth_date)
                }));
                
                // Отправляем уведомление для каждой тренировки
                for (const training of trainings) {
                    await notifyAdminGroupTrainingCancellationByAdmin({
                        session_date: training.session_date,
                        start_time: training.start_time,
                        end_time: training.end_time,
                        duration: training.duration,
                        group_name: training.group_name,
                        trainer_name: training.trainer_name,
                        skill_level: training.skill_level,
                        simulator_id: training.simulator_id,
                        simulator_name: training.simulator_name,
                        price: training.price,
                        refunds: participantsWithAge
                    });
                }
            } catch (notificationError) {
                console.error('Ошибка при отправке уведомления администратору:', notificationError);
            }
        }
        
        console.log(`Шаблон "${deleteTemplateResult.rows[0].name}" успешно удалён`);
        res.json({
            message: 'Шаблон и все будущие тренировки успешно удалены',
            template_name: deleteTemplateResult.rows[0].name,
            deleted_trainings_count: trainings.length,
            total_refund: totalRefund,
            refunds_count: allRefunds.length
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при удалении шаблона:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * PATCH /api/recurring-templates/:id/toggle
 * Активировать/деактивировать шаблон
 */
router.patch('/:id/toggle', async (req, res) => {
    try {
        // Получаем текущий статус
        const currentStatus = await pool.query(
            'SELECT is_active, name FROM recurring_training_templates WHERE id = $1',
            [req.params.id]
        );
        
        if (currentStatus.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не найден' });
        }
        
        const newStatus = !currentStatus.rows[0].is_active;
        
        // Обновляем статус
        const result = await pool.query(
            `UPDATE recurring_training_templates 
             SET is_active = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 
             RETURNING *`,
            [newStatus, req.params.id]
        );
        
        console.log(`Шаблон "${result.rows[0].name}" ${newStatus ? 'активирован' : 'деактивирован'}`);
        res.json({
            message: `Шаблон ${newStatus ? 'активирован' : 'деактивирован'}`,
            template: result.rows[0],
            is_active: newStatus
        });
    } catch (error) {
        console.error('Ошибка при изменении статуса шаблона:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

/**
 * GET /api/recurring-templates/:id/preview
 * Предпросмотр будущих тренировок для шаблона
 * Показывает, какие тренировки будут созданы в следующем месяце
 */
router.get('/:id/preview', async (req, res) => {
    try {
        // Получаем шаблон
        const templateResult = await pool.query(
            'SELECT * FROM recurring_training_templates WHERE id = $1',
            [req.params.id]
        );
        
        if (templateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не найден' });
        }
        
        const template = templateResult.rows[0];
        const moment = require('moment-timezone');
        
        // Получаем даты на следующий месяц
        const nextMonth = moment().tz('Asia/Yekaterinburg').add(1, 'months');
        const startDate = nextMonth.clone().startOf('month');
        const endDate = nextMonth.clone().endOf('month');
        
        // Находим все даты с нужным днем недели
        const dates = [];
        let current = startDate.clone();
        
        // Находим первое вхождение нужного дня недели
        while (current.day() !== template.day_of_week && current.isSameOrBefore(endDate)) {
            current.add(1, 'days');
        }
        
        // Собираем все даты
        while (current.isSameOrBefore(endDate)) {
            dates.push(current.format('YYYY-MM-DD'));
            current.add(7, 'days');
        }
        
        // Проверяем конфликты для каждой даты
        const previews = [];
        const endTime = moment(template.start_time, 'HH:mm:ss').add(60, 'minutes').format('HH:mm:ss');
        
        for (const date of dates) {
            const conflictCheck = await pool.query(
                `SELECT ts.id, g.name as group_name
                 FROM training_sessions ts
                 LEFT JOIN groups g ON ts.group_id = g.id
                 WHERE ts.simulator_id = $1 
                 AND ts.session_date = $2 
                 AND ts.start_time < $3 
                 AND ts.end_time > $4
                 AND ts.status != 'cancelled'`,
                [template.simulator_id, date, endTime, template.start_time]
            );
            
            previews.push({
                date,
                start_time: template.start_time,
                end_time: endTime,
                has_conflict: conflictCheck.rows.length > 0,
                conflict_with: conflictCheck.rows[0]?.group_name || null
            });
        }
        
        res.json({
            template_name: template.name,
            month: nextMonth.locale('ru').format('MMMM YYYY'),
            trainings_count: dates.length,
            conflicts_count: previews.filter(p => p.has_conflict).length,
            preview: previews
        });
    } catch (error) {
        console.error('Ошибка при предпросмотре:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

// Применение шаблонов к существующему расписанию
router.post('/apply-current-month', async (req, res) => {
    try {
        const client = await pool.connect();
        
        // Получаем диапазон существующего расписания
        const scheduleRangeResult = await client.query(
            `SELECT MIN(date) as min_date, MAX(date) as max_date 
             FROM schedule 
             WHERE date >= CURRENT_DATE`
        );
        
        if (!scheduleRangeResult.rows[0].min_date) {
            client.release();
            return res.status(400).json({
                success: false,
                message: 'Расписание не найдено. Сначала создайте расписание.'
            });
        }
        
        // Конвертируем в moment объекты
        const moment = require('moment-timezone');
        const startDate = moment(scheduleRangeResult.rows[0].min_date).tz('Asia/Yekaterinburg');
        const endDate = moment(scheduleRangeResult.rows[0].max_date).tz('Asia/Yekaterinburg');
        
        console.log(`Применение шаблонов к расписанию с ${startDate.format('YYYY-MM-DD')} по ${endDate.format('YYYY-MM-DD')}`);
        
        // Импортируем функции из скрипта создания расписания
        const { createTrainingsFromTemplates } = require('../scripts/create-next-month-schedule');
        
        // Применяем шаблоны к существующему расписанию
        const result = await createTrainingsFromTemplates(client, startDate, endDate);
        
        client.release();
        
        res.json({
            success: true,
            message: 'Шаблоны успешно применены к существующему расписанию',
            date_range: {
                from: startDate.format('YYYY-MM-DD'),
                to: endDate.format('YYYY-MM-DD')
            },
            created: result.successCount,
            conflicts: result.conflictCount,
            conflicts_details: result.conflicts
        });
        
    } catch (error) {
        console.error('Ошибка при применении шаблонов к существующему расписанию:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка при применении шаблонов к существующему расписанию',
            error: error.message
        });
    }
});

module.exports = router;

