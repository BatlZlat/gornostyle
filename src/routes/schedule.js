const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Получение временных слотов для конкретной даты
router.get('/', async (req, res) => {
    const { date, simulator_id } = req.query;

    if (!date) {
        return res.status(400).json({ error: 'Необходимо указать дату' });
    }

    try {
        let query = `SELECT id, simulator_id, start_time, end_time, is_holiday, is_booked 
                     FROM schedule 
                     WHERE date = $1`;
        const params = [date];
        if (simulator_id) {
            query += ' AND simulator_id = $2';
            params.push(simulator_id);
        }
        query += ' ORDER BY simulator_id, start_time';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении временных слотов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Новый эндпоинт для админ-панели
router.get('/admin', async (req, res) => {
    try {
        const { slope_type } = req.query; // 'simulator' или 'natural_slope'
        
        console.log('🔍 Запрос расписания для slope_type:', slope_type);
        
        // Запрос для групповых тренировок из training_sessions
        let groupQuery = `
            SELECT 
                ts.id,
                ts.session_date as date,
                ts.start_time,
                ts.end_time,
                ts.duration,
                FALSE as is_individual,
                ts.trainer_id,
                t.full_name as trainer_name,
                ts.simulator_id,
                s.name as simulator_name,
                ts.max_participants,
                ts.skill_level,
                ts.price,
                ts.equipment_type,
                ts.with_trainer,
                g.name as group_name,
                ts.slope_type,
                ts.winter_training_type,
                ts.status,
                COUNT(sp.id) as current_participants
            FROM training_sessions ts
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN simulators s ON ts.simulator_id = s.id
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                AND sp.status = 'confirmed'
            WHERE ts.session_date >= CURRENT_DATE - INTERVAL '7 days'
                AND ts.session_date <= CURRENT_DATE + INTERVAL '60 days'
                AND (ts.status = 'scheduled' OR (ts.status = 'completed' AND (ts.session_date > CURRENT_DATE OR (ts.session_date = CURRENT_DATE AND ts.end_time > CURRENT_TIME))))
                AND ts.training_type = TRUE
                ${slope_type ? `AND ts.slope_type = '${slope_type}'` : ''}
            GROUP BY ts.id, t.full_name, s.name, g.name, ts.slope_type, ts.winter_training_type, ts.status
        `;
        
        // Запрос для индивидуальных тренировок тренажера
        let individualQuery = `
            SELECT 
                its.id,
                its.preferred_date as date,
                its.preferred_time as start_time,
                (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
                its.duration,
                TRUE as is_individual,
                its.trainer_id,
                t.full_name as trainer_name,
                its.simulator_id,
                s.name as simulator_name,
                1 as max_participants,
                NULL as skill_level,
                its.price,
                its.equipment_type,
                its.with_trainer,
                NULL as group_name,
                'simulator' as slope_type,
                NULL as winter_training_type,
                1 as current_participants
            FROM individual_training_sessions its
            LEFT JOIN simulators s ON its.simulator_id = s.id
            LEFT JOIN trainers t ON its.trainer_id = t.id
            WHERE its.preferred_date >= CURRENT_DATE
                AND its.preferred_date <= CURRENT_DATE + INTERVAL '7 days'
                ${slope_type === 'simulator' ? '' : 'AND 1=0'} -- Показываем только если запрашиваем тренажер
        `;
        
        // Запрос для индивидуальных тренировок естественного склона
        let naturalSlopeIndividualQuery = `
            SELECT 
                ts.id,
                ts.session_date as date,
                ts.start_time,
                ts.end_time,
                ts.duration,
                TRUE as is_individual,
                ts.trainer_id,
                t.full_name as trainer_name,
                ts.simulator_id,
                s.name as simulator_name,
                ts.max_participants,
                ts.skill_level,
                ts.price,
                ts.equipment_type,
                ts.with_trainer,
                g.name as group_name,
                ts.slope_type,
                ts.winter_training_type,
                ts.status,
                COUNT(sp.id) as current_participants,
                STRING_AGG(
                    DISTINCT COALESCE(c.full_name, ch.full_name), 
                    ', ' 
                    ORDER BY COALESCE(c.full_name, ch.full_name)
                ) FILTER (WHERE sp.status = 'confirmed') as participant_names
            FROM training_sessions ts
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN simulators s ON ts.simulator_id = s.id
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                AND sp.status = 'confirmed'
            LEFT JOIN clients c ON sp.client_id = c.id AND NOT sp.is_child
            LEFT JOIN children ch ON sp.child_id = ch.id AND sp.is_child
            WHERE ts.session_date >= CURRENT_DATE - INTERVAL '7 days'
                AND ts.session_date <= CURRENT_DATE + INTERVAL '60 days'
                AND (ts.status = 'scheduled' OR (ts.status = 'completed' AND (ts.session_date > CURRENT_DATE OR (ts.session_date = CURRENT_DATE AND ts.end_time > CURRENT_TIME))))
                AND ts.training_type = FALSE
                AND ts.slope_type = 'natural_slope'
            GROUP BY ts.id, ts.session_date, ts.start_time, ts.end_time, ts.duration, ts.trainer_id, ts.simulator_id, ts.max_participants, ts.skill_level, ts.price, ts.equipment_type, ts.with_trainer, t.full_name, s.name, g.name, ts.slope_type, ts.winter_training_type, ts.status
        `;
        
        console.log('📊 Выполняем запросы...');
        
        // Выполняем запросы в зависимости от типа склона
        let results = [];
        
        if (slope_type === 'simulator') {
            const [groupResult, individualResult] = await Promise.all([
                pool.query(groupQuery),
                pool.query(individualQuery)
            ]);
            results = [...groupResult.rows, ...individualResult.rows];
        } else if (slope_type === 'natural_slope') {
            // Запросы для тренировок из training_sessions (старый формат)
            const [groupResult, naturalSlopeResult] = await Promise.all([
                pool.query(groupQuery),
                pool.query(naturalSlopeIndividualQuery)
            ]);
            
            // Запрос для групповых тренировок Кулиги
            const kuligaGroupQuery = `
                SELECT 
                    kgt.id,
                    kgt.date,
                    kgt.start_time,
                    kgt.end_time,
                    EXTRACT(EPOCH FROM (kgt.end_time::time - kgt.start_time::time))/60 as duration,
                    FALSE as is_individual,
                    kgt.instructor_id as trainer_id,
                    ki.full_name as trainer_name,
                    NULL::INTEGER as simulator_id,
                    NULL::TEXT as simulator_name,
                    kgt.max_participants,
                    kgt.current_participants,
                    CASE kgt.level
                        WHEN 'beginner' THEN 1
                        WHEN 'intermediate' THEN 2
                        WHEN 'advanced' THEN 3
                        ELSE NULL
                    END::INTEGER as skill_level,
                    kgt.price_per_person * kgt.max_participants as price,
                    NULL::TEXT as equipment_type,
                    NULL::BOOLEAN as with_trainer,
                    CASE kgt.sport_type
                        WHEN 'ski' THEN 'Групповая тренировка (Горные лыжи)'
                        WHEN 'snowboard' THEN 'Групповая тренировка (Сноуборд)'
                        ELSE CONCAT('Групповая тренировка (', kgt.sport_type, ')')
                    END as group_name,
                    'natural_slope' as slope_type,
                    'group' as winter_training_type,
                    CASE kgt.status
                        WHEN 'open' THEN 'scheduled'
                        WHEN 'confirmed' THEN 'scheduled'
                        WHEN 'cancelled' THEN 'cancelled'
                        ELSE 'scheduled'
                    END as status,
                    COALESCE(
                        STRING_AGG(
                            DISTINCT array_to_string(kb.participants_names, ', '), 
                            ', '
                        ) FILTER (WHERE kb.status IN ('pending', 'confirmed') AND kb.participants_names IS NOT NULL),
                        ''
                    ) as participant_names
                FROM kuliga_group_trainings kgt
                LEFT JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
                LEFT JOIN kuliga_bookings kb ON kgt.id = kb.group_training_id
                    AND kb.status IN ('pending', 'confirmed')
                WHERE kgt.date >= CURRENT_DATE - INTERVAL '7 days'
                    AND kgt.date <= CURRENT_DATE + INTERVAL '60 days'
                    AND kgt.status IN ('open', 'confirmed')
                GROUP BY kgt.id, kgt.date, kgt.start_time, kgt.end_time, kgt.instructor_id, 
                         kgt.max_participants, kgt.current_participants, kgt.level, kgt.price_per_person,
                         kgt.sport_type, kgt.status, ki.full_name
            `;
            
            // Запрос для индивидуальных тренировок Кулиги
            const kuligaIndividualQuery = `
                SELECT 
                    kb.id,
                    kb.date,
                    kb.start_time,
                    kb.end_time,
                    EXTRACT(EPOCH FROM (kb.end_time::time - kb.start_time::time))/60 as duration,
                    TRUE as is_individual,
                    kb.instructor_id as trainer_id,
                    ki.full_name as trainer_name,
                    NULL::INTEGER as simulator_id,
                    NULL::TEXT as simulator_name,
                    1 as max_participants,
                    kb.participants_count as current_participants,
                    NULL::INTEGER as skill_level,
                    kb.price_total as price,
                    NULL::TEXT as equipment_type,
                    NULL::BOOLEAN as with_trainer,
                    NULL::TEXT as group_name,
                    'natural_slope' as slope_type,
                    'individual' as winter_training_type,
                    CASE kb.status
                        WHEN 'pending' THEN 'scheduled'
                        WHEN 'confirmed' THEN 'scheduled'
                        WHEN 'cancelled' THEN 'cancelled'
                        ELSE 'scheduled'
                    END as status,
                    COALESCE(array_to_string(kb.participants_names, ', '), '') as participant_names
                FROM kuliga_bookings kb
                LEFT JOIN kuliga_instructors ki ON kb.instructor_id = ki.id
                WHERE kb.booking_type = 'individual'
                    AND kb.date >= CURRENT_DATE - INTERVAL '7 days'
                    AND kb.date <= CURRENT_DATE + INTERVAL '60 days'
                    AND kb.status IN ('pending', 'confirmed')
            `;
            
            const [oldGroupResult, oldIndividualResult, kuligaGroupResult, kuligaIndividualResult] = await Promise.all([
                pool.query(groupQuery),
                pool.query(naturalSlopeIndividualQuery),
                pool.query(kuligaGroupQuery),
                pool.query(kuligaIndividualQuery)
            ]);
            
            // Объединяем все результаты
            results = [
                ...oldGroupResult.rows, 
                ...oldIndividualResult.rows,
                ...kuligaGroupResult.rows,
                ...kuligaIndividualResult.rows
            ];
        } else {
            // Если slope_type не указан, возвращаем пустой массив
            results = [];
        }
        
        // Сортируем по дате и времени
        results.sort((a, b) => {
            if (a.date !== b.date) return new Date(a.date) - new Date(b.date);
            return a.start_time.localeCompare(b.start_time);
        });
        
        console.log(`✅ Найдено ${results.length} тренировок`);
        
        res.json(results);
    } catch (error) {
        console.error('❌ Ошибка при получении расписания для админ-панели:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера', details: error.message });
    }
});

// Получение диапазона существующего расписания
router.get('/range', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT MIN(date) as min_date, MAX(date) as max_date 
             FROM schedule 
             WHERE date >= CURRENT_DATE`
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении диапазона расписания:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 