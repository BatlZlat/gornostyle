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
        let groupTrainings = [];

        if (instructorIds.length > 0) {
            const [slotResult, groupTrainingResult] = await Promise.all([
                pool.query(
                    `SELECT id, instructor_id, date, start_time, end_time, status
                     FROM kuliga_schedule_slots
                     WHERE instructor_id = ANY($1)
                       AND date BETWEEN $2 AND $3
                     ORDER BY date, start_time`,
                    [instructorIds, startDate, endDate]
                ),
                pool.query(
                    `SELECT id, instructor_id, slot_id, date, start_time, end_time, status, sport_type, 
                            max_participants, current_participants, price_per_person, description
                     FROM kuliga_group_trainings
                     WHERE instructor_id = ANY($1)
                       AND date BETWEEN $2 AND $3
                       AND status IN ('open', 'confirmed')
                     ORDER BY date, start_time`,
                    [instructorIds, startDate, endDate]
                )
            ]);
            slots = slotResult.rows;
            groupTrainings = groupTrainingResult.rows;
        }

        const scheduleByInstructor = instructorIds.reduce((acc, id) => {
            acc[id] = {};
            days.forEach((day) => {
                acc[id][day.iso] = [];
            });
            return acc;
        }, {});

        // Добавляем слоты
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
                type: 'slot'
            });
        });

        // Добавляем групповые тренировки (даже если slot_id = null)
        groupTrainings.forEach((training) => {
            const dateKey = formatDate(training.date);
            if (!scheduleByInstructor[training.instructor_id]) return;
            if (!scheduleByInstructor[training.instructor_id][dateKey]) {
                scheduleByInstructor[training.instructor_id][dateKey] = [];
            }
            scheduleByInstructor[training.instructor_id][dateKey].push({
                id: training.id,
                startTime: training.start_time,
                endTime: training.end_time,
                status: training.status,
                type: 'group_training',
                sportType: training.sport_type,
                maxParticipants: training.max_participants,
                currentParticipants: training.current_participants,
                pricePerPerson: training.price_per_person,
                description: training.description
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

// GET /api/kuliga/programs/:id - Получение программы по ID
router.get('/api/kuliga/programs/:id', async (req, res) => {
    try {
        const programId = parseInt(req.params.id, 10);
        if (isNaN(programId) || programId <= 0) {
            return res.status(400).json({ success: false, error: 'Некорректный ID программы' });
        }

        const result = await pool.query(
            `SELECT p.id, p.name, p.description, p.sport_type, p.location, p.max_participants,
                    p.training_duration, p.warmup_duration, p.practice_duration,
                    p.weekdays, p.time_slots, p.equipment_provided,
                    p.skipass_provided, p.price, p.is_active, p.created_at,
                    COALESCE(
                        array_agg(pi.instructor_id) FILTER (WHERE pi.instructor_id IS NOT NULL),
                        ARRAY[]::integer[]
                    ) as instructor_ids
             FROM kuliga_programs p
             LEFT JOIN kuliga_program_instructors pi ON p.id = pi.program_id
             WHERE p.id = $1 AND p.is_active = TRUE
             GROUP BY p.id`,
            [programId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Программа не найдена или неактивна' });
        }

        const program = result.rows[0];
        
        // Получаем информацию о тренировке на конкретную дату и время (если указаны)
        const { date, time } = req.query;
        let trainingInfo = null;
        
        if (date && time) {
            // Нормализуем формат времени: "10:00" -> "10:00:00"
            let normalizedTime = time.trim();
            if (normalizedTime.length === 5 && normalizedTime.includes(':')) {
                normalizedTime = normalizedTime + ':00';
            }
            
            const trainingResult = await pool.query(
                `SELECT kgt.id, kgt.date, kgt.start_time, kgt.end_time, kgt.current_participants,
                        kgt.max_participants, kgt.price_per_person, kgt.status,
                        kgt.instructor_id, ki.full_name as instructor_name, ki.photo_url as instructor_photo_url,
                        ki.description as instructor_description
                 FROM kuliga_group_trainings kgt
                 LEFT JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
                 WHERE kgt.program_id = $1
                   AND kgt.date = $2
                   AND kgt.start_time = $3
                   AND kgt.status IN ('open', 'confirmed')
                 LIMIT 1`,
                [programId, date, normalizedTime]
            );
            
            if (trainingResult.rows.length > 0) {
                trainingInfo = trainingResult.rows[0];
            }
        }

        const programData = {
            ...program,
            price: Number(program.price),
            instructor_ids: Array.isArray(program.instructor_ids) ? program.instructor_ids : [],
            practice_duration:
                program.practice_duration !== null
                    ? Number(program.practice_duration)
                    : Number(program.training_duration) - Number(program.warmup_duration),
            training: trainingInfo
        };

        res.json({
            success: true,
            data: programData
        });
    } catch (error) {
        console.error('Ошибка получения программы Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить информацию о программе' });
    }
});

router.get('/api/kuliga/programs', async (req, res) => {
    try {
        const { location } = req.query || {};
        const { isValidLocation } = require('../utils/location-mapper');
        
        let query = `SELECT p.id, p.name, p.description, p.sport_type, p.location, p.max_participants,
                    p.training_duration, p.warmup_duration, p.practice_duration,
                    p.weekdays, p.time_slots, p.equipment_provided,
                    p.skipass_provided, p.price, p.is_active, p.created_at,
                    COALESCE(
                        array_agg(pi.instructor_id) FILTER (WHERE pi.instructor_id IS NOT NULL),
                        ARRAY[]::integer[]
                    ) as instructor_ids
             FROM kuliga_programs p
             LEFT JOIN kuliga_program_instructors pi ON p.id = pi.program_id
             WHERE p.is_active = TRUE`;
        const params = [];
        
        // Фильтр по location, если указан
        if (location && isValidLocation(location)) {
            params.push(location);
            query += ` AND p.location = $${params.length}`;
        }
        
        query += ` GROUP BY p.id ORDER BY p.created_at DESC`;
        
        const { rows } = await pool.query(query, params);

        const now = moment().tz(TIMEZONE);
        const end = now.clone().add(14, 'days').endOf('day');

        const programs = rows.map((program) => ({
            ...program,
            price: Number(program.price),
            instructor_ids: Array.isArray(program.instructor_ids) ? program.instructor_ids : [],
            practice_duration:
                program.practice_duration !== null
                    ? Number(program.practice_duration)
                    : Number(program.training_duration) - Number(program.warmup_duration),
        }));

        const schedule = [];

        // Получаем реальные созданные тренировки из программ
        let createdTrainingsQuery = `SELECT 
                kgt.id as training_id,
                kgt.program_id,
                kgt.date,
                kgt.start_time,
                kgt.end_time,
                kgt.price_per_person,
                kgt.max_participants,
                kgt.current_participants,
                kgt.status,
                kgt.instructor_id,
                kgt.location,
                ki.full_name as instructor_name,
                kp.name as program_name,
                kp.sport_type
             FROM kuliga_group_trainings kgt
             JOIN kuliga_programs kp ON kgt.program_id = kp.id
             LEFT JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
             WHERE kgt.program_id IS NOT NULL
               AND kgt.date >= $1
               AND kgt.date <= $2
               AND kgt.status IN ('open', 'confirmed')`;
        const trainingParams = [now.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')];
        
        // Применяем фильтр по location к тренировкам, если указан
        if (location && isValidLocation(location)) {
            trainingParams.push(location);
            createdTrainingsQuery += ` AND kgt.location = $${trainingParams.length}`;
        }
        
        createdTrainingsQuery += ` ORDER BY kgt.date, kgt.start_time`;
        
        const createdTrainingsResult = await pool.query(createdTrainingsQuery, trainingParams);

        // Объединяем расписание программ с реальными тренировками
        // ВАЖНО: Показываем ТОЛЬКО реальные тренировки из БД
        // Если тренировка была удалена администратором, она не должна отображаться
        const allScheduleItems = [];
        
        // Группируем реальные тренировки по program_id для заполнения program.schedule
        const trainingsByProgram = {};
        
        // Добавляем только реальные тренировки из БД (с фильтром по статусу)
        createdTrainingsResult.rows.forEach((training) => {
            // Пропускаем отмененные и удаленные тренировки
            if (training.status === 'cancelled') {
                return;
            }
            
            const dateStr = moment(training.date).tz(TIMEZONE).format('YYYY-MM-DD');
            const timeStr = moment(training.start_time, 'HH:mm:ss').format('HH:mm');
            const dateLabel = moment(training.date).tz(TIMEZONE).format('D MMMM');
            const weekdayShort = moment(training.date).tz(TIMEZONE).format('dd');
            
            const scheduleItem = {
                program_id: training.program_id,
                program_name: training.program_name,
                sport_type: training.sport_type,
                date_iso: dateStr,
                date_label: dateLabel,
                weekday_short: weekdayShort,
                time: timeStr,
                available_slots: training.max_participants - (training.current_participants || 0),
                max_participants: training.max_participants,
                current_participants: training.current_participants || 0,
                price_per_person: Number(training.price_per_person),
                instructor_id: training.instructor_id,
                instructor_name: training.instructor_name,
                training_id: training.training_id,
                location: training.location,
                status: training.status,
            };
            
            allScheduleItems.push(scheduleItem);
            
            // Группируем по program_id для заполнения program.schedule
            if (!trainingsByProgram[training.program_id]) {
                trainingsByProgram[training.program_id] = [];
            }
            trainingsByProgram[training.program_id].push(scheduleItem);
        });
        
        // Сортируем по дате и времени
        allScheduleItems.sort((a, b) => {
            const dateCompare = a.date_iso.localeCompare(b.date_iso);
            if (dateCompare !== 0) return dateCompare;
            return a.time.localeCompare(b.time);
        });
        
        // Заполняем program.schedule реальными тренировками из БД
        // ВАЖНО: program.schedule используется для отображения "Ближайшее занятие"
        programs.forEach((program) => {
            const programTrainings = trainingsByProgram[program.id] || [];
            // Сортируем тренировки программы по дате и времени
            programTrainings.sort((a, b) => {
                const dateCompare = a.date_iso.localeCompare(b.date_iso);
                if (dateCompare !== 0) return dateCompare;
                return a.time.localeCompare(b.time);
            });
            
            // Сохраняем weekdays и time_slots для обратной совместимости
            const weekdaysArray = Array.isArray(program.weekdays) ? program.weekdays : [];
            const weekdays = weekdaysArray.map((day) => Number(day)).filter((day) => !Number.isNaN(day));
            const timeSlots = Array.isArray(program.time_slots) ? program.time_slots : [];
            
            program.schedule = programTrainings;
            program.weekdays = weekdays;
            program.time_slots = timeSlots;
        });

        res.json({
            success: true,
            data: {
                programs: programs.map(({ weekdays, time_slots, ...rest }) => ({
                    ...rest,
                    weekdays,
                    time_slots,
                })),
                schedule: allScheduleItems,
            },
        });
    } catch (error) {
        console.error('Ошибка получения программ Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список программ' });
    }
});

module.exports = router;
