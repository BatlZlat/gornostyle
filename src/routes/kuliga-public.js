const express = require('express');
const moment = require('moment-timezone');
const { pool } = require('../db');
const { isValidLocation } = require('../utils/location-mapper');

moment.locale('ru');

const router = express.Router();
const TIMEZONE = 'Asia/Yekaterinburg';

const formatDate = (date) => moment(date).tz(TIMEZONE).format('YYYY-MM-DD');
const getKuligaClientBotUsername = () =>
    process.env.KULIGA_CLIENT_BOT_USERNAME || process.env.BOT_USERNAME || '';

const buildWeekContext = (weekOffset = 0) => {
    // Начинаем с понедельника текущей недели
    const today = moment().tz(TIMEZONE).startOf('day');
    const monday = today.clone().startOf('isoWeek'); // Понедельник текущей недели
    const start = monday.clone().add(weekOffset * 7, 'days'); // Добавляем недели для навигации
    
    // Возвращаем полную неделю (7 дней: ПН-ВС)
    return Array.from({ length: 7 }, (_, index) => {
        const day = start.clone().add(index, 'day');
        return {
            iso: day.format('YYYY-MM-DD'),
            weekday: day.format('dd'),
            label: day.format('D MMM'),
        };
    });
};

router.get('/instruktor-po-gornym-lyzham-snoubordy-tyumen', (req, res) => {
    res.render('kuliga-landing', {
        pageTitle: 'Служба инструкторов Горностайл72',
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        botUsername: process.env.BOT_USERNAME,
        kuligaClientBotUsername: getKuligaClientBotUsername(),
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
        inn: process.env.INN,
        ogrnip: process.env.OGRNIP,
        baseUrl: process.env.BASE_URL || '/',
    });
});

router.get('/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking', (req, res) => {
    res.render('kuliga-booking', {
        pageTitle: 'Бронирование тренировки на Кулиге | Горностайл72',
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        botUsername: process.env.BOT_USERNAME,
        kuligaClientBotUsername: getKuligaClientBotUsername(),
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
        inn: process.env.INN,
        ogrnip: process.env.OGRNIP,
    });
});

router.get('/user-agreement', (req, res) => {
    res.render('user-agreement', {
        pageTitle: 'Пользовательское соглашение - Горностайл72',
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
        inn: process.env.INN,
        ogrnip: process.env.OGRNIP,
    });
});

router.get('/payment-terms', (req, res) => {
    res.render('payment-terms', {
        pageTitle: 'Условия оплаты и доставки - Горностайл72',
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
    });
});

router.get('/return-policy', (req, res) => {
    res.render('return-policy', {
        pageTitle: 'Политика возврата - Горностайл72',
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
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

router.get('/api/kuliga/group-trainings', async (req, res) => {
    const { location } = req.query;
    
    try {
        let query = `SELECT id, instructor_id, date, start_time, end_time,
                    sport_type, level, description, price_per_person,
                    max_participants, min_participants, current_participants, status, location
             FROM kuliga_group_trainings
             WHERE date >= CURRENT_DATE
               AND status IN ('open', 'confirmed')`;
        const params = [];
        
        // Фильтр по location, если указан
        if (location && isValidLocation(location)) {
            params.push(location);
            query += ` AND location = $${params.length}`;
        }
        
        query += ' ORDER BY date, start_time LIMIT 20';
        
        const { rows } = await pool.query(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Ошибка получения групповых тренировок Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить групповые тренировки' });
    }
});

router.get('/api/kuliga/instructors', async (req, res) => {
    try {
        const { location } = req.query;
        
        // Поддержка навигации по неделям (weekOffset: 0 = текущая неделя, 1 = следующая и т.д.)
        const weekOffset = parseInt(req.query.weekOffset || '0', 10);
        const days = buildWeekContext(weekOffset);
        const startDate = days[0].iso;
        const endDate = days[days.length - 1].iso;

        let instructorsQuery = `SELECT id, full_name, phone, email, photo_url, description,
                    sport_type, admin_percentage, telegram_registered, location
             FROM kuliga_instructors
             WHERE is_active = TRUE`;
        const params = [];
        
        // Фильтр по location, если указан
        if (location && isValidLocation(location)) {
            params.push(location);
            instructorsQuery += ` AND location = $${params.length}`;
        }
        
        instructorsQuery += ' ORDER BY full_name';
        
        const instructorsResult = await pool.query(instructorsQuery, params);

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

router.get('/api/kuliga/programs', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, name, description, sport_type, max_participants,
                    training_duration, warmup_duration, practice_duration,
                    weekdays, time_slots, equipment_provided,
                    skipass_provided, price, is_active, created_at
             FROM kuliga_programs
             WHERE is_active = TRUE
             ORDER BY created_at DESC`
        );

        const now = moment().tz(TIMEZONE);
        const end = now.clone().add(14, 'days').endOf('day');

        const programs = rows.map((program) => ({
            ...program,
            price: Number(program.price),
            practice_duration:
                program.practice_duration !== null
                    ? Number(program.practice_duration)
                    : Number(program.training_duration) - Number(program.warmup_duration),
        }));

        const schedule = [];

        programs.forEach((program, index) => {
            const programSchedule = [];
            const weekdaysArray = Array.isArray(program.weekdays) ? program.weekdays : [];
            const weekdays = weekdaysArray.map((day) => Number(day)).filter((day) => !Number.isNaN(day));
            const timeSlots = Array.isArray(program.time_slots) ? program.time_slots : [];

            if (weekdays.length && timeSlots.length) {
                const cursor = now.clone().startOf('day');
                while (cursor.isSameOrBefore(end, 'day')) {
                    const weekday = cursor.day(); // 0=Sunday
                    if (weekdays.includes(weekday)) {
                        timeSlots.forEach((slot) => {
                            const [hours = '00', minutes = '00'] = slot.split(':');
                            const startMoment = cursor.clone().hour(Number(hours)).minute(Number(minutes)).second(0);
                            if (startMoment.isAfter(now)) {
                                const scheduleItem = {
                                    program_id: program.id,
                                    program_name: program.name,
                                    sport_type: program.sport_type,
                                    date_iso: startMoment.format('YYYY-MM-DD'),
                                    date_label: startMoment.format('D MMMM'),
                                    weekday_short: startMoment.format('dd'),
                                    weekday_full: startMoment.format('dddd'),
                                    time: startMoment.format('HH:mm'),
                                    available_slots: program.max_participants,
                                    max_participants: program.max_participants,
                                    sort_key: startMoment.valueOf(),
                                };
                                schedule.push(scheduleItem);
                                const { sort_key, ...programItem } = scheduleItem;
                                programSchedule.push(programItem);
                            }
                        });
                    }
                    cursor.add(1, 'day');
                }
            }

            programs[index] = {
                ...program,
                schedule: programSchedule,
                weekdays,
                time_slots: timeSlots,
            };
        });

        schedule.sort((a, b) => a.sort_key - b.sort_key);

        const responseSchedule = schedule.map(({ sort_key, ...rest }) => rest);

        res.json({
            success: true,
            data: {
                programs: programs.map(({ weekdays, time_slots, ...rest }) => ({
                    ...rest,
                    weekdays,
                    time_slots,
                })),
                schedule: responseSchedule,
            },
        });
    } catch (error) {
        console.error('Ошибка получения программ Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список программ' });
    }
});

module.exports = router;
