const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const cron = require('node-cron');

// Создание расписания
router.post('/api/schedule', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            start_date,
            end_date,
            weekdays,
            simulator1,
            simulator2,
            auto_schedule,
            auto_schedule_settings
        } = req.body;

        // Создаем расписание для каждого тренажера
        for (const simulator of [simulator1, simulator2]) {
            // Создаем записи в таблице schedule
            const scheduleQuery = `
                INSERT INTO schedule (
                    simulator_id,
                    date,
                    start_time,
                    end_time,
                    is_holiday,
                    is_booked
                )
                SELECT 
                    $1,
                    generate_series($2::date, $3::date, '1 day'::interval)::date,
                    $4::time,
                    $5::time,
                    CASE 
                        WHEN EXTRACT(DOW FROM generate_series($2::date, $3::date, '1 day'::interval)::date) = ANY($6::int[]) 
                        THEN false 
                        ELSE true 
                    END,
                    false
                WHERE EXTRACT(DOW FROM generate_series($2::date, $3::date, '1 day'::interval)::date) = ANY($6::int[]);
            `;

            await client.query(scheduleQuery, [
                simulator.id,
                start_date,
                end_date,
                simulator.start_time,
                simulator.end_time,
                weekdays
            ]);

            // Если включено автоматическое создание расписания
            if (auto_schedule && auto_schedule_settings) {
                const settingsQuery = `
                    INSERT INTO schedule_settings (
                        simulator_id,
                        day_of_month,
                        hour,
                        minute,
                        is_active
                    ) VALUES ($1, $2, $3, $4, true)
                    ON CONFLICT (simulator_id) 
                    DO UPDATE SET 
                        day_of_month = EXCLUDED.day_of_month,
                        hour = EXCLUDED.hour,
                        minute = EXCLUDED.minute,
                        is_active = true;
                `;

                const [hours, minutes] = auto_schedule_settings.time.split(':');
                await client.query(settingsQuery, [
                    simulator.id,
                    auto_schedule_settings.day,
                    parseInt(hours),
                    parseInt(minutes)
                ]);

                // Создаем задачу cron для автоматического создания расписания
                const cronExpression = `${minutes} ${hours} ${auto_schedule_settings.day} * *`;
                
                // Удаляем существующую задачу, если она есть
                const existingTask = cron.getTasks().get(`schedule_${simulator.id}`);
                if (existingTask) {
                    existingTask.stop();
                }

                // Создаем новую задачу
                cron.schedule(cronExpression, async () => {
                    try {
                        const today = new Date();
                        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
                        const lastDay = new Date(today.getFullYear(), today.getMonth() + 2, 0);

                        // Создаем расписание на следующий месяц
                        const createNextMonthSchedule = `
                            INSERT INTO schedule (
                                simulator_id,
                                date,
                                start_time,
                                end_time,
                                is_holiday,
                                is_booked
                            )
                            SELECT 
                                $1,
                                generate_series($2::date, $3::date, '1 day'::interval)::date,
                                $4::time,
                                $5::time,
                                CASE 
                                    WHEN EXTRACT(DOW FROM generate_series($2::date, $3::date, '1 day'::interval)::date) = ANY($6::int[]) 
                                    THEN false 
                                    ELSE true 
                                END,
                                false
                            WHERE EXTRACT(DOW FROM generate_series($2::date, $3::date, '1 day'::interval)::date) = ANY($6::int[]);
                        `;

                        await pool.query(createNextMonthSchedule, [
                            simulator.id,
                            nextMonth,
                            lastDay,
                            simulator.start_time,
                            simulator.end_time,
                            weekdays
                        ]);
                    } catch (error) {
                        console.error('Ошибка при автоматическом создании расписания:', error);
                    }
                }, {
                    timezone: auto_schedule_settings.timezone
                });
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании расписания:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при создании расписания' 
        });
    } finally {
        client.release();
    }
});

// Получение расписания
router.get('/api/schedule', async (req, res) => {
    try {
        const { start_date, end_date, simulator_id } = req.query;
        
        const query = `
            SELECT 
                s.*,
                sim.name as simulator_name
            FROM schedule s
            JOIN simulators sim ON s.simulator_id = sim.id
            WHERE ($1::date IS NULL OR s.date >= $1::date)
            AND ($2::date IS NULL OR s.date <= $2::date)
            AND ($3::int IS NULL OR s.simulator_id = $3::int)
            ORDER BY s.date, s.start_time;
        `;

        const result = await pool.query(query, [start_date, end_date, simulator_id]);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении расписания:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении расписания' 
        });
    }
});

// Получение настроек автоматического расписания
router.get('/api/schedule/settings', async (req, res) => {
    try {
        const query = `
            SELECT 
                ss.*,
                sim.name as simulator_name
            FROM schedule_settings ss
            JOIN simulators sim ON ss.simulator_id = sim.id
            WHERE ss.is_active = true;
        `;

        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении настроек расписания:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении настроек расписания' 
        });
    }
});

module.exports = router; 