const express = require('express');
const moment = require('moment-timezone');
const { pool } = require('../db');

const router = express.Router();
const TIMEZONE = 'Asia/Yekaterinburg';

const formatDate = (date) => moment(date).tz(TIMEZONE).format('YYYY-MM-DD');

const buildWeekContext = (days = 7) => {
    const start = moment().tz(TIMEZONE).startOf('day');
    return Array.from({ length: days }, (_, index) => {
        const day = start.clone().add(index, 'day');
        return {
            iso: day.format('YYYY-MM-DD'),
            weekday: day.format('dd'),
            label: day.format('D MMM'),
        };
    });
};

router.get('/instruktora-kuliga', (req, res) => {
    res.render('kuliga-landing', {
        pageTitle: 'Служба инструкторов Кулиги Горностайл72',
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        botUsername: process.env.BOT_USERNAME,
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
    });
});

router.get('/api/kuliga/prices', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, type, duration, participants, price, description
             FROM winter_prices
             WHERE is_active = TRUE
             ORDER BY type, duration`
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Ошибка получения прайса Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить прайс' });
    }
});

router.get('/api/kuliga/group-trainings', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, instructor_id, date, start_time, end_time,
                    sport_type, level, description, price_per_person,
                    max_participants, min_participants, current_participants, status
             FROM kuliga_group_trainings
             WHERE date >= CURRENT_DATE
               AND status IN ('open', 'confirmed')
             ORDER BY date, start_time
             LIMIT 20`
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Ошибка получения групповых тренировок Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить групповые тренировки' });
    }
});

router.get('/api/kuliga/instructors', async (_req, res) => {
    try {
        const days = buildWeekContext();
        const startDate = days[0].iso;
        const endDate = days[days.length - 1].iso;

        const instructorsResult = await pool.query(
            `SELECT id, full_name, phone, email, photo_url, description,
                    sport_type, admin_percentage, telegram_registered
             FROM kuliga_instructors
             WHERE is_active = TRUE
             ORDER BY full_name`
        );

        const instructorIds = instructorsResult.rows.map((i) => i.id);
        let slots = [];

        if (instructorIds.length > 0) {
            const slotResult = await pool.query(
                `SELECT id, instructor_id, date, start_time, end_time, status
                 FROM kuliga_schedule_slots
                 WHERE instructor_id = ANY($1)
                   AND date BETWEEN $2 AND $3
                 ORDER BY date, start_time`,
                [instructorIds, startDate, endDate]
            );
            slots = slotResult.rows;
        }

        const scheduleByInstructor = instructorIds.reduce((acc, id) => {
            acc[id] = {};
            days.forEach((day) => {
                acc[id][day.iso] = [];
            });
            return acc;
        }, {});

        slots.forEach((slot) => {
            const dateKey = formatDate(slot.date);
            if (!scheduleByInstructor[slot.instructor_id]) return;
            if (!scheduleByInstructor[slot.instructor_id][dateKey]) {
                scheduleByInstructor[slot.instructor_id][dateKey] = [];
            }
            scheduleByInstructor[slot.instructor_id][dateKey].push({
                id: slot.id,
                startTime: slot.start_time,
                endTime: slot.end_time,
                status: slot.status,
            });
        });

        const instructors = instructorsResult.rows.map((instructor) => ({
            ...instructor,
            schedule: scheduleByInstructor[instructor.id] || {},
        }));

        res.json({ success: true, data: { days, instructors } });
    } catch (error) {
        console.error('Ошибка получения инструкторов Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список инструкторов' });
    }
});

module.exports = router;
