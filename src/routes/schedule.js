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
                COUNT(sp.id) as current_participants
            FROM training_sessions ts
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN simulators s ON ts.simulator_id = s.id
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                AND sp.status = 'confirmed'
            WHERE ts.session_date >= CURRENT_DATE
                AND ts.session_date <= CURRENT_DATE + INTERVAL '7 days'
                AND ts.status = 'scheduled'
                AND ts.training_type = TRUE
                ${slope_type ? `AND ts.slope_type = '${slope_type}'` : ''}
            GROUP BY ts.id, t.full_name, s.name, g.name, ts.slope_type, ts.winter_training_type
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
                COUNT(sp.id) as current_participants
            FROM training_sessions ts
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN simulators s ON ts.simulator_id = s.id
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                AND sp.status = 'confirmed'
            WHERE ts.session_date >= CURRENT_DATE
                AND ts.session_date <= CURRENT_DATE + INTERVAL '7 days'
                AND ts.status = 'scheduled'
                AND ts.training_type = FALSE
                AND ts.slope_type = 'natural_slope'
            GROUP BY ts.id, t.full_name, s.name, g.name, ts.slope_type, ts.winter_training_type
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
            const [groupResult, naturalSlopeResult] = await Promise.all([
                pool.query(groupQuery),
                pool.query(naturalSlopeIndividualQuery)
            ]);
            results = [...groupResult.rows, ...naturalSlopeResult.rows];
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