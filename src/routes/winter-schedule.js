const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

function isValidTimeHHMM(value) {
    return /^\d{2}:\d{2}$/.test(value);
}

// ВАЖНО: сначала более специфичные маршруты, затем параметризированные

// GET /api/winter-schedule/available?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/available', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'Нужны параметры from и to' });
        const result = await pool.query(
            `SELECT date::text as date,
                    COUNT(*) as slots,
                    SUM(CASE WHEN is_available THEN 1 ELSE 0 END) as free_slots
             FROM winter_schedule
             WHERE date >= $1::date AND date <= $2::date
             GROUP BY date
             ORDER BY date`,
            [from, to]
        );
        res.json({ dates: result.rows });
    } catch (error) {
        console.error('Ошибка получения доступных дат расписания:', error);
        res.status(500).json({ error: 'Ошибка получения доступных дат' });
    }
});

// GET /api/winter-schedule/:date - получить слоты на дату
router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await pool.query(
            `SELECT id, date, time_slot, is_group_training, is_individual_training,
                    group_id, trainer_id, is_available, max_participants, current_participants
             FROM winter_schedule
             WHERE date = $1
             ORDER BY time_slot`,
            [date]
        );
        res.json({ date, slots: result.rows });
    } catch (error) {
        console.error('Ошибка получения расписания на дату:', error);
        res.status(500).json({ error: 'Ошибка получения расписания' });
    }
});

// POST /api/winter-schedule/day - создать слоты на дату
router.post('/day', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date, times } = req.body;
        if (!date || !Array.isArray(times) || times.length === 0) {
            return res.status(400).json({ error: 'Нужны date и массив times' });
        }
        // Проверка формата времени
        for (const t of times) {
            if (!isValidTimeHHMM(t)) {
                return res.status(400).json({ error: `Неверный формат времени: ${t}` });
            }
        }

        await client.query('BEGIN');
        // Проверяем, что расписание на дату отсутствует
        const exists = await client.query('SELECT 1 FROM winter_schedule WHERE date = $1 LIMIT 1', [date]);
        if (exists.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Расписание на эту дату уже существует' });
        }

        for (const t of times) {
            await client.query(
                `INSERT INTO winter_schedule (
                    date, time_slot, is_group_training, is_individual_training,
                    group_id, trainer_id, is_available, max_participants, current_participants,
                    created_at, updated_at
                 ) VALUES ($1, $2, false, true, NULL, NULL, true, 1, 0, NOW(), NOW())`,
                [date, t]
            );
        }

        await client.query('COMMIT');
        res.status(201).json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка создания расписания на дату:', error);
        res.status(500).json({ error: 'Ошибка создания расписания' });
    } finally {
        client.release();
    }
});

// POST /api/winter-schedule/bulk - массовое создание расписания
router.post('/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date_from, date_to, weekdays, times } = req.body; // weekdays: [1..7] или [0..6]
        if (!date_from || !date_to || !Array.isArray(weekdays) || !Array.isArray(times) || times.length === 0) {
            return res.status(400).json({ error: 'Нужны date_from, date_to, weekdays[], times[]' });
        }
        for (const t of times) {
            if (!isValidTimeHHMM(t)) {
                return res.status(400).json({ error: `Неверный формат времени: ${t}` });
            }
        }

        const skipped = [];
        await client.query('BEGIN');

        let d = new Date(date_from);
        const end = new Date(date_to);
        while (d <= end) {
            const day = new Date(d);
            const iso = day.toISOString().slice(0, 10);
            const weekday = day.getUTCDay(); // 0=ВС .. 6=СБ
            const match = weekdays.includes(weekday) || weekdays.includes(((weekday + 6) % 7) + 1);
            if (match) {
                const exists = await client.query('SELECT 1 FROM winter_schedule WHERE date = $1 LIMIT 1', [iso]);
                if (exists.rows.length > 0) {
                    skipped.push(iso);
                } else {
                    for (const t of times) {
                        await client.query(
                            `INSERT INTO winter_schedule (
                                date, time_slot, is_group_training, is_individual_training,
                                group_id, trainer_id, is_available, max_participants, current_participants,
                                created_at, updated_at
                             ) VALUES ($1, $2, false, true, NULL, NULL, true, 1, 0, NOW(), NOW())`,
                            [iso, t]
                        );
                    }
                }
            }
            d.setUTCDate(d.getUTCDate() + 1);
        }

        await client.query('COMMIT');
        res.status(201).json({ success: true, skipped });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка массового создания расписания:', error);
        res.status(500).json({ error: 'Ошибка массового создания расписания' });
    } finally {
        client.release();
    }
});

// PUT /api/winter-schedule/:date - заменить слоты на дату
router.put('/:date', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date } = req.params;
        const { times } = req.body;
        if (!Array.isArray(times)) {
            return res.status(400).json({ error: 'Нужен массив times' });
        }
        for (const t of times) {
            if (!isValidTimeHHMM(t)) {
                return res.status(400).json({ error: `Неверный формат времени: ${t}` });
            }
        }

        await client.query('BEGIN');
        // Запрещаем удалять занятые (is_available=false) слоты незаметно
        const occupied = await client.query(
            `SELECT time_slot FROM winter_schedule WHERE date = $1 AND is_available = false`,
            [date]
        );
        if (occupied.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Есть занятые слоты на эту дату, редактирование набора запрещено' });
        }

        await client.query('DELETE FROM winter_schedule WHERE date = $1', [date]);
        for (const t of times) {
            await client.query(
                `INSERT INTO winter_schedule (
                    date, time_slot, is_group_training, is_individual_training,
                    group_id, trainer_id, is_available, max_participants, current_participants,
                    created_at, updated_at
                 ) VALUES ($1, $2, false, true, NULL, NULL, true, 1, 0, NOW(), NOW())`,
                [date, t]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка замены расписания на дату:', error);
        res.status(500).json({ error: 'Ошибка замены расписания' });
    } finally {
        client.release();
    }
});

// DELETE /api/winter-schedule/:date - удалить все слоты на дату (если все свободны)
router.delete('/:date', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date } = req.params;
        await client.query('BEGIN');
        const occupied = await client.query(
            `SELECT COUNT(*)::int AS cnt FROM winter_schedule WHERE date = $1 AND is_available = false`,
            [date]
        );
        if (occupied.rows[0].cnt > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Есть занятые слоты, удаление запрещено' });
        }
        await client.query('DELETE FROM winter_schedule WHERE date = $1', [date]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка удаления расписания на дату:', error);
        res.status(500).json({ error: 'Ошибка удаления расписания' });
    } finally {
        client.release();
    }
});

// POST /api/winter-schedule/:date/slots - добавить слоты на дату
router.post('/:date/slots', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date } = req.params;
        const { times } = req.body;
        if (!Array.isArray(times) || times.length === 0) {
            return res.status(400).json({ error: 'Нужен массив times' });
        }
        for (const t of times) {
            if (!isValidTimeHHMM(t)) {
                return res.status(400).json({ error: `Неверный формат времени: ${t}` });
            }
        }
        await client.query('BEGIN');
        for (const t of times) {
            await client.query(
                `INSERT INTO winter_schedule (
                    date, time_slot, is_group_training, is_individual_training,
                    group_id, trainer_id, is_available, max_participants, current_participants,
                    created_at, updated_at
                 ) VALUES ($1, $2, false, true, NULL, NULL, true, 1, 0, NOW(), NOW())
                 ON CONFLICT (date, time_slot) DO NOTHING`,
                [date, t]
            );
        }
        await client.query('COMMIT');
        res.status(201).json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка добавления слотов:', error);
        res.status(500).json({ error: 'Ошибка добавления слотов' });
    } finally {
        client.release();
    }
});

// DELETE /api/winter-schedule/:date/slots/:time - удалить слот (если свободен)
router.delete('/:date/slots/:time', async (req, res) => {
    try {
        const { date, time } = req.params;
        if (!isValidTimeHHMM(time)) {
            return res.status(400).json({ error: 'Неверный формат времени' });
        }
        const result = await pool.query(
            `DELETE FROM winter_schedule 
             WHERE date = $1 AND time_slot = $2::time AND is_available = true
             RETURNING id`,
            [date, time]
        );
        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'Слот не найден или он занят' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка удаления слота:', error);
        res.status(500).json({ error: 'Ошибка удаления слота' });
    }
});

module.exports = router;


