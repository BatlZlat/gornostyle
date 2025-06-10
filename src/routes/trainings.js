const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const fetch = require('node-fetch');
require('dotenv').config();

// Создание новой тренировки
router.post('/', async (req, res) => {
    console.log('Получены данные для создания тренировки:', req.body);
    
    const {
        date,                    // переименовываем в session_date
        simulator_id,
        time_slot_id,           // получаем start_time и end_time из time_slot_id
        skill_level,
        trainer_id,
        max_participants,
        training_type,          // переименовано с is_group_session
        group_id,               // добавляем group_id
        price                   // теперь берем из запроса
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Получаем время начала из time_slot_id
        const timeSlotResult = await client.query(
            'SELECT start_time FROM schedule WHERE id = $1',
            [time_slot_id]
        );

        if (timeSlotResult.rows.length === 0) {
            return res.status(400).json({ error: 'Временной слот не найден' });
        }

        let start_time = timeSlotResult.rows[0].start_time;
        
        // Вычисляем end_time как start_time + 60 минут
        const [hours, minutes] = start_time.split(':').map(Number);
        const startDate = new Date(2000, 0, 1, hours, minutes);
        const endDate = new Date(startDate.getTime() + 60 * 60000);
        const end_time = endDate.toTimeString().slice(0, 5) + ':00';

        // Проверяем, не занят ли тренажер в это время
        const checkResult = await client.query(
            `SELECT id FROM training_sessions 
             WHERE simulator_id = $1 
             AND session_date = $2 
             AND ((start_time, end_time) OVERLAPS ($3::time, $4::time))`,
            [simulator_id, date, start_time, end_time]
        );

        if (checkResult.rows.length > 0) {
            return res.status(400).json({ error: 'Тренажер уже занят в это время' });
        }

        // Логируем итоговые значения
        console.log('Вставляем в training_sessions:', {
            simulator_id,
            trainer_id,
            group_id,
            date,
            start_time,
            end_time,
            duration: 60,
            training_type,
            max_participants: max_participants || 1,
            skill_level: skill_level || 1,
            price,
            equipment_type: 'ski'
        });

        // Создаем тренировку
        const result = await client.query(
            `INSERT INTO training_sessions (
                simulator_id, trainer_id, group_id, session_date, 
                start_time, end_time, duration,
                training_type, max_participants, 
                skill_level, price, equipment_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id`,
            [
                simulator_id,
                trainer_id,
                group_id,
                date,
                start_time,
                end_time,
                60, // всегда 60 минут
                training_type,
                max_participants || 1,
                skill_level || 1,
                price || 0,
                'ski'
            ]
        );
        const trainingId = result.rows[0].id;

        // Получаем детали для уведомления
        const detailsResult = await client.query(
            `SELECT ts.*, g.name as group_name, t.full_name as trainer_name, s.name as simulator_name
             FROM training_sessions ts
             LEFT JOIN groups g ON ts.group_id = g.id
             LEFT JOIN trainers t ON ts.trainer_id = t.id
             LEFT JOIN simulators s ON ts.simulator_id = s.id
             WHERE ts.id = $1`,
            [trainingId]
        );
        const training = detailsResult.rows[0];

        // Форматируем дату в формат д.м.г
        const formatDate = (dateStr) => {
            const date = new Date(dateStr);
            return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
        };

        // Формируем текст уведомления для клиентов
        const clientTrainingText =
`Друзья! Создана новая *${training.training_type ? 'групповая' : 'индивидуальная'} тренировка*! Присоединяйтесь, в группе тренироваться дешевле и интересней!

👥 *Группа:* ${training.group_name || '-'}
📅 *Дата:* ${formatDate(training.session_date)}
⏰ *Время:* ${training.start_time ? training.start_time.slice(0,5) : '-'}
⏱ *Длительность:* ${training.duration || 60} минут
👤 *Тренер:* ${training.trainer_name || '-'}
👥 *Мест:* ${training.max_participants}
📊 *Уровень:* ${training.skill_level}
💰 *Стоимость:* ${Number(training.price).toFixed(2)} руб.`;

        // Формируем текст уведомления для администраторов
        const adminTrainingText =
`✅ *Создана новая тренировка!*

👥 *Группа:* ${training.group_name || '-'}
📅 *Дата:* ${formatDate(training.session_date)}
⏰ *Время:* ${training.start_time ? training.start_time.slice(0,5) : '-'}
⏱ *Длительность:* ${training.duration || 60} минут
👤 *Тренер:* ${training.trainer_name || '-'}
👥 *Мест:* ${training.max_participants}
📊 *Уровень:* ${training.skill_level}
💰 *Стоимость:* ${Number(training.price).toFixed(2)} руб.`;

        // Уведомление клиентам
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const clientsResult = await client.query('SELECT telegram_id FROM clients WHERE telegram_id IS NOT NULL');
        for (const c of clientsResult.rows) {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: c.telegram_id, 
                    text: clientTrainingText,
                    parse_mode: 'Markdown'
                })
            });
        }

        // Отправляем уведомления администраторам
        const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
        const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
        if (ADMIN_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
            const adminIds = ADMIN_TELEGRAM_ID.split(',').map(id => id.trim()).filter(Boolean);
            for (const adminId of adminIds) {
                await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        chat_id: adminId, 
                        text: adminTrainingText,
                        parse_mode: 'Markdown'
                    })
                });
            }
        }

        // Бронируем слоты в расписании
        // Бронируем все слоты между start_time и end_time
        await client.query(
            `UPDATE schedule 
             SET is_booked = true 
             WHERE simulator_id = $1 
             AND date = $2 
             AND start_time >= $3 
             AND start_time < $4`,
            [simulator_id, date, start_time, end_time]
        );

        await client.query('COMMIT');

        res.status(201).json({ 
            message: 'Тренировка успешно создана',
            training_id: trainingId 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании тренировки:', error);
        res.status(500).json({ 
            error: 'Ошибка при создании тренировки',
            details: error.message
        });
    } finally {
        client.release();
    }
});

// Получение активных групповых тренировок (должен быть перед /:id)
router.get('/active-groups', async (req, res) => {
    console.log('Запрос на получение активных групповых тренировок');
    let client;
    try {
        // Проверяем подключение к базе данных
        console.log('Проверка подключения к базе данных...');
        client = await pool.connect();
        console.log('Подключение к базе данных успешно установлено');

        // Проверяем доступность таблицы
        console.log('Проверка доступности таблицы training_sessions...');
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'training_sessions'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            throw new Error('Таблица training_sessions не существует');
        }
        console.log('Таблица training_sessions доступна');

        // Проверяем наличие данных
        console.log('Проверка наличия данных...');
        const countCheck = await client.query(`
            SELECT COUNT(*) as count 
            FROM training_sessions 
            WHERE training_type = true 
            AND session_date >= CURRENT_DATE 
            AND status = 'scheduled'
        `);
        console.log('Количество активных групповых тренировок:', countCheck.rows[0].count);

        // Основной запрос
        console.log('Выполняем основной SQL запрос...');
        const query = `
            SELECT 
                ts.id,
                ts.session_date,
                ts.start_time,
                ts.end_time,
                ts.duration,
                ts.max_participants,
                ts.skill_level,
                ts.price,
                COALESCE(g.name, 'Группа не указана') as group_name,
                COALESCE(t.full_name, 'Тренер не назначен') as trainer_name,
                COALESCE(s.name, 'Тренажер не указан') as simulator_name,
                (SELECT COUNT(*) FROM session_participants sp WHERE sp.session_id = ts.id AND sp.status = 'confirmed') as current_participants
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN simulators s ON ts.simulator_id = s.id
            WHERE ts.training_type = true
            AND ts.session_date >= CURRENT_DATE
            AND ts.status = 'scheduled'
            ORDER BY ts.session_date, ts.start_time
        `;
        console.log('SQL запрос:', query);
        
        const result = await client.query(query);
        console.log('Результат запроса:', {
            rowCount: result.rowCount,
            firstRow: result.rows[0],
            error: result.error,
            fields: result.fields ? result.fields.map(f => f.name) : []
        });

        if (!result.rows) {
            throw new Error('Результат запроса не содержит данных');
        }

        // Преобразуем даты и время в строки для корректной сериализации
        const formattedRows = result.rows.map(row => {
            try {
                return {
                    ...row,
                    session_date: row.session_date ? row.session_date.toISOString().split('T')[0] : null,
                    start_time: row.start_time ? row.start_time.toString() : null,
                    end_time: row.end_time ? row.end_time.toString() : null
                };
            } catch (error) {
                console.error('Ошибка при форматировании строки:', {
                    row,
                    error: error.message
                });
                throw error;
            }
        });

        console.log('Отправляем ответ клиенту...');
        res.json(formattedRows);
    } catch (error) {
        console.error('Детальная ошибка при получении активных групповых тренировок:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            where: error.where
        });
        
        // Проверяем тип ошибки
        if (error.code === '42P01') {
            res.status(500).json({ 
                error: 'Ошибка базы данных',
                details: 'Таблица не существует'
            });
        } else if (error.code === '28P01') {
            res.status(500).json({ 
                error: 'Ошибка базы данных',
                details: 'Ошибка аутентификации'
            });
        } else if (error.code === '3D000') {
            res.status(500).json({ 
                error: 'Ошибка базы данных',
                details: 'База данных не существует'
            });
        } else {
            res.status(500).json({ 
                error: 'Внутренняя ошибка сервера',
                details: error.message,
                code: error.code
            });
        }
    } finally {
        if (client) {
            console.log('Освобождаем соединение с базой данных');
            client.release();
        }
    }
});

// Получение тренировки по ID (должен быть после /active-groups)
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Получаем основную информацию о тренировке
        const result = await pool.query(`
            SELECT ts.*, g.name as group_name, g.description as group_description, t.full_name as trainer_name
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            WHERE ts.id = $1
        `, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }
        const training = result.rows[0];

        // Получаем участников тренировки
        const participantsResult = await pool.query(`
            SELECT 
                sp.id,
                sp.is_child,
                sp.status,
                c.full_name as client_full_name,
                c.birth_date as client_birth_date,
                c.skill_level as client_skill_level,
                c.phone as client_phone,
                ch.full_name as child_full_name,
                ch.birth_date as child_birth_date,
                ch.skill_level as child_skill_level,
                ch.id as child_id,
                par.phone as parent_phone
            FROM session_participants sp
            LEFT JOIN clients c ON sp.client_id = c.id
            LEFT JOIN children ch ON sp.child_id = ch.id
            LEFT JOIN clients par ON ch.parent_id = par.id
            WHERE sp.session_id = $1
        `, [id]);

        // Проверяем, детская ли это тренировка
        const isChildrenGroup = training.group_name && training.group_name.toLowerCase().includes('дети');

        // Формируем массив участников с нужными полями
        const participants = participantsResult.rows.map(row => {
            if (isChildrenGroup) {
                // Для детских групп всегда отображаем ФИО ребенка
                return {
                    full_name: row.child_full_name || row.client_full_name,
                    birth_date: row.child_birth_date || row.client_birth_date,
                    skill_level: row.child_skill_level || row.client_skill_level,
                    phone: row.parent_phone || row.client_phone,
                    is_child: true
                };
            } else {
                // Для остальных — ФИО клиента
                return {
                    full_name: row.client_full_name,
                    birth_date: row.client_birth_date,
                    skill_level: row.client_skill_level,
                    phone: row.client_phone,
                    is_child: false
                };
            }
        });

        training.participants = participants;
        training.participants_count = participants.length;

        res.json(training);
    } catch (error) {
        console.error('Ошибка при получении тренировки по id:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получение тренировок
router.get('/', async (req, res) => {
    const { date, date_from, date_to, type } = req.query;

    // Если передан диапазон дат
    if (date_from && date_to) {
        try {
            let query = `
                SELECT ts.*, 
                       g.name as group_name, 
                       g.description as group_description,
                       t.full_name as trainer_full_name
                FROM training_sessions ts
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                WHERE ts.session_date >= $1 AND ts.session_date <= $2
            `;
            const params = [date_from, date_to];

            if (type === 'group') {
                query += ' AND ts.training_type = true';
            } else if (type === 'individual') {
                query += ' AND ts.training_type = false';
            }

            query += ' ORDER BY ts.session_date, ts.start_time';

            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (error) {
            console.error('Ошибка при получении тренировок (диапазон):', error);
            res.status(500).json({ error: 'Внутренняя ошибка сервера' });
        }
        return;
    }

    // Если передан только date (старый режим)
    if (date) {
        try {
            let query = `
                SELECT ts.*, 
                       g.name as group_name, 
                       g.description as group_description,
                       t.full_name as trainer_full_name
                FROM training_sessions ts
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                WHERE ts.session_date = $1
            `;
            const params = [date];

            if (type === 'group') {
                query += ' AND ts.training_type = true';
            } else if (type === 'individual') {
                query += ' AND ts.training_type = false';
            }

            query += ' ORDER BY ts.start_time';

            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (error) {
            console.error('Ошибка при получении тренировок:', error);
            res.status(500).json({ error: 'Внутренняя ошибка сервера' });
        }
        return;
    }

    // Если не передано ни date, ни date_from/date_to
    return res.status(400).json({ error: 'Необходимо указать дату или диапазон дат' });
});

// Получение архивных тренировок
router.get('/archive', async (req, res) => {
    const { date_from, date_to, trainer_id } = req.query;
    
    try {
        let query = `
            SELECT ts.*, 
                   g.name as group_name,
                   t.full_name as trainer_name,
                   s.name as simulator_name,
                   (SELECT COUNT(*) FROM session_participants sp WHERE sp.session_id = ts.id) as participants_count
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN simulators s ON ts.simulator_id = s.id
            WHERE ts.session_date < CURRENT_DATE
        `;
        const params = [];

        if (date_from) {
            query += ' AND ts.session_date >= $1';
            params.push(date_from);
        }
        if (date_to) {
            query += ' AND ts.session_date <= $' + (params.length + 1);
            params.push(date_to);
        }
        if (trainer_id) {
            query += ' AND ts.trainer_id = $' + (params.length + 1);
            params.push(trainer_id);
        }

        query += ' ORDER BY ts.session_date DESC, ts.start_time DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении архивных тренировок:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление тренировки по id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const {
        start_time,
        end_time,
        simulator_id,
        trainer_id,
        group_id,
        max_participants,
        skill_level,
        price
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Проверяем, не занят ли тренажер в это время (исключая текущую тренировку)
        const checkResult = await client.query(
            `SELECT id FROM training_sessions 
             WHERE simulator_id = $1 
             AND session_date = (SELECT session_date FROM training_sessions WHERE id = $2)
             AND ((start_time, end_time) OVERLAPS ($3::time, $4::time))
             AND id != $2`,
            [simulator_id, id, start_time, end_time]
        );

        if (checkResult.rows.length > 0) {
            return res.status(400).json({ error: 'Тренажер уже занят в это время' });
        }

        // Обновляем тренировку
        const result = await client.query(
            `UPDATE training_sessions SET
                start_time = $1,
                end_time = $2,
                simulator_id = $3,
                trainer_id = $4,
                group_id = $5,
                max_participants = $6,
                skill_level = $7,
                price = $8,
                updated_at = NOW()
            WHERE id = $9
            RETURNING *`,
            [start_time, end_time, simulator_id, trainer_id, group_id, max_participants, skill_level, price, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }

        // Обновляем слоты в расписании
        // Сначала освобождаем старые слоты
        const oldTraining = await client.query(
            'SELECT simulator_id, session_date, start_time, end_time FROM training_sessions WHERE id = $1',
            [id]
        );

        if (oldTraining.rows.length > 0) {
            const old = oldTraining.rows[0];
            await client.query(
                `UPDATE schedule 
                 SET is_booked = false 
                 WHERE simulator_id = $1 
                 AND date = $2 
                 AND start_time >= $3 
                 AND start_time < $4`,
                [old.simulator_id, old.session_date, old.start_time, old.end_time]
            );
        }

        // Бронируем новые слоты
        await client.query(
            `UPDATE schedule 
             SET is_booked = true 
             WHERE simulator_id = $1 
             AND date = (SELECT session_date FROM training_sessions WHERE id = $2)
             AND start_time >= $3 
             AND start_time < $4`,
            [simulator_id, id, start_time, end_time]
        );

        await client.query('COMMIT');
        res.json({ message: 'Тренировка обновлена', training: result.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении тренировки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } finally {
        client.release();
    }
});

// Удаление тренировки
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Получаем информацию о тренировке с деталями
        const trainingResult = await client.query(
            `SELECT ts.*, g.name as group_name, t.full_name as trainer_name, s.name as simulator_name
             FROM training_sessions ts
             LEFT JOIN groups g ON ts.group_id = g.id
             LEFT JOIN trainers t ON ts.trainer_id = t.id
             LEFT JOIN simulators s ON ts.simulator_id = s.id
             WHERE ts.id = $1`,
            [id]
        );

        if (trainingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }

        const training = trainingResult.rows[0];
        const price = Number(training.price);

        // Получаем участников тренировки
        const participantsResult = await client.query(`
            SELECT sp.id, sp.client_id, c.full_name, c.telegram_id
            FROM session_participants sp
            LEFT JOIN clients c ON sp.client_id = c.id
            WHERE sp.session_id = $1
        `, [id]);
        const participants = participantsResult.rows;

        let refunds = [];
        let totalRefund = 0;
        for (const participant of participants) {
            // Найти кошелек клиента
            const walletResult = await client.query('SELECT id, balance FROM wallets WHERE client_id = $1', [participant.client_id]);
            if (walletResult.rows.length === 0) continue;
            const wallet = walletResult.rows[0];
            // Вернуть деньги
            const newBalance = Number(wallet.balance) + price;
            await client.query('UPDATE wallets SET balance = $1, last_updated = NOW() WHERE id = $2', [newBalance, wallet.id]);
            // Сформировать корректный description для возврата
            const dateObj = new Date(training.session_date);
            const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;
            const startTime = training.start_time ? training.start_time.slice(0,5) : '';
            const duration = training.duration || 60;
            await client.query(
                'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                [wallet.id, price, 'amount', `Возврат: Группа, ${participant.full_name}, Дата: ${formattedDate}, Время: ${startTime}, Длительность: ${duration} мин.`]
            );
            refunds.push({
                full_name: participant.full_name,
                telegram_id: participant.telegram_id,
                amount: price
            });
            totalRefund += price;
        }

        // Формируем подробное описание тренировки с эмодзи
        const dateObj = new Date(training.session_date);
        const days = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
        const dayOfWeek = days[dateObj.getDay()];
        const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()} (${dayOfWeek})`;
        const startTime = training.start_time ? training.start_time.slice(0,5) : '';
        const endTime = training.end_time ? training.end_time.slice(0,5) : '';
        const duration = training.duration || 60;
        const group = training.group_name || '-';
        const trainer = training.trainer_name || '-';
        const level = training.skill_level || '-';
        const maxPart = training.max_participants || '-';
        const sim = training.simulator_name || `Тренажер ${training.simulator_id}`;
        const priceStr = Number(training.price).toFixed(2);
        const participantsCount = participants.length;
        const trainingInfo =
`📅 Дата: ${dateStr}
⏰ Время: ${startTime} - ${endTime}
⏱ Длительность: ${duration} минут
👥 Группа: ${group}
👨‍🏫 Тренер: ${trainer}
📊 Уровень: ${level}
👥 Участников: ${participantsCount}/${maxPart}
🎿 Тренажер: ${sim}
💰 Стоимость: ${priceStr} руб.`;

        // Уведомление клиентам
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const ADMIN_PHONE = process.env.ADMIN_PHONE || '';
        for (const refund of refunds) {
            if (!refund.telegram_id) continue;
            const text =
`❗️ К сожалению, мы вынуждены отменить вашу тренировку:

${trainingInfo}

Деньги в размере ${refund.amount} руб. возвращены на ваш счет.
Тренировка могла быть отменена из-за недобора группы или болезни тренера.
Подробнее вы можете уточнить у администратора: ${ADMIN_PHONE}`;
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: refund.telegram_id, text })
            });
        }

        // Уведомление админу
        const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
        const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
        if (ADMIN_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
            let adminText = `❗️ Тренировка отменена:

${trainingInfo}

Возвраты:\n`;
            for (const refund of refunds) {
                adminText += `👤 ${refund.full_name} — ${refund.amount} руб.\n`;
            }
            adminText += `\nОбщая сумма возврата: ${totalRefund} руб.`;
            await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: ADMIN_TELEGRAM_ID, text: adminText })
            });
        }

        // Освобождаем все слоты в расписании между start_time и end_time
        await client.query(
            `UPDATE schedule 
             SET is_booked = false 
             WHERE simulator_id = $1 
             AND date = $2 
             AND start_time >= $3 
             AND start_time < $4`,
            [
                training.simulator_id, 
                training.session_date, 
                training.start_time, 
                training.end_time
            ]
        );

        // Удаляем тренировку
        await client.query('DELETE FROM training_sessions WHERE id = $1', [id]);

        await client.query('COMMIT');
        res.json({ message: 'Тренировка успешно удалена' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при удалении тренировки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } finally {
        client.release();
    }
});

// Рассылка сообщения всем клиентам с telegram_id
router.post('/notify-clients', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Нет текста сообщения' });

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    try {
        const result = await pool.query('SELECT telegram_id FROM clients WHERE telegram_id IS NOT NULL');
        const clients = result.rows;

        let sent = 0;
        for (const client of clients) {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: client.telegram_id, text: message })
            });
            sent++;
        }
        res.json({ message: `Сообщение отправлено ${sent} клиентам` });
    } catch (error) {
        console.error('Ошибка при рассылке:', error);
        res.status(500).json({ error: 'Ошибка при рассылке' });
    }
});

// Отправка сообщения конкретному клиенту
router.post('/notify-client/:clientId', async (req, res) => {
    const { clientId } = req.params;
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Нет текста сообщения' });
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    try {
        // Получаем telegram_id клиента
        const result = await pool.query(
            'SELECT telegram_id, full_name FROM clients WHERE id = $1',
            [clientId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }

        const client = result.rows[0];
        if (!client.telegram_id) {
            return res.status(400).json({ error: 'У клиента не указан Telegram ID' });
        }

        // Отправляем сообщение
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chat_id: client.telegram_id, 
                text: message,
                parse_mode: 'Markdown'
            })
        });

        // Уведомляем администратора
        const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
        const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
        if (ADMIN_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
            const adminText = `📨 *Отправлено сообщение клиенту*\n\n👤 *Клиент:* ${client.full_name}\n\n📝 *Текст:*\n${message}`;
            await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: ADMIN_TELEGRAM_ID, 
                    text: adminText,
                    parse_mode: 'Markdown'
                })
            });
        }

        res.json({ 
            message: 'Сообщение успешно отправлено',
            client_name: client.full_name
        });
    } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        res.status(500).json({ error: 'Ошибка при отправке сообщения' });
    }
});

// Отправка сообщения участникам групповой тренировки
router.post('/notify-group/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Нет текста сообщения' });
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    try {
        // Получаем информацию о тренировке и её участниках
        const result = await pool.query(`
            SELECT 
                ts.id,
                ts.session_date,
                ts.start_time,
                g.name as group_name,
                c.id as client_id,
                c.full_name,
                c.telegram_id
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id
            LEFT JOIN clients c ON sp.client_id = c.id
            WHERE ts.id = $1 AND ts.training_type = true
        `, [sessionId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Групповая тренировка не найдена' });
        }

        const training = result.rows[0];
        const participants = result.rows.filter(row => row.client_id !== null);

        if (participants.length === 0) {
            return res.status(400).json({ error: 'У тренировки нет участников' });
        }

        // Форматируем дату для уведомления
        const dateObj = new Date(training.session_date);
        const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;
        const startTime = training.start_time ? training.start_time.slice(0,5) : '';

        // Отправляем сообщения участникам
        let sent = 0;
        for (const participant of participants) {
            if (!participant.telegram_id) continue;

            const participantMessage = 
`📢 *Сообщение для участников группы ${training.group_name}*

📅 *Дата тренировки:* ${formattedDate}
⏰ *Время:* ${startTime}

${message}`;

            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: participant.telegram_id, 
                    text: participantMessage,
                    parse_mode: 'Markdown'
                })
            });
            sent++;
        }

        // Уведомляем администратора
        const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
        const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
        if (ADMIN_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
            const adminText = 
`📨 *Отправлено сообщение участникам группы*

👥 *Группа:* ${training.group_name}
📅 *Дата:* ${formattedDate}
⏰ *Время:* ${startTime}
👥 *Отправлено:* ${sent} из ${participants.length} участников

📝 *Текст сообщения:*
${message}`;

            await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: ADMIN_TELEGRAM_ID, 
                    text: adminText,
                    parse_mode: 'Markdown'
                })
            });
        }

        res.json({ 
            message: `Сообщение отправлено ${sent} из ${participants.length} участников`,
            group_name: training.group_name,
            date: formattedDate,
            time: startTime
        });
    } catch (error) {
        console.error('Ошибка при отправке сообщений:', error);
        res.status(500).json({ error: 'Ошибка при отправке сообщений' });
    }
});

module.exports = router; 