const { pool } = require('../db');

/**
 * Получает все тренировки на завтрашний день (групповые и индивидуальные)
 * @returns {Promise<Array>} Массив тренировок на завтра
 */
async function getTomorrowTrainings() {
    const client = await pool.connect();
    try {
        const query = `
            WITH tomorrow_trainings AS (
                -- Групповые тренировки на завтра
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
                    COUNT(sp.id) as current_participants,
                    -- Получаем список участников
                    STRING_AGG(
                        CASE 
                            WHEN sp.is_child = true THEN ch.full_name
                            ELSE c.full_name
                        END, 
                        ', '
                    ) as participants_list
                FROM training_sessions ts
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                LEFT JOIN simulators s ON ts.simulator_id = s.id
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                    AND sp.status = 'confirmed'
                LEFT JOIN clients c ON sp.client_id = c.id
                LEFT JOIN children ch ON sp.child_id = ch.id
                WHERE ts.session_date = CURRENT_DATE + INTERVAL '1 day'
                    AND ts.status = 'scheduled'
                GROUP BY ts.id, t.full_name, s.name, g.name, ts.session_date, ts.start_time, ts.end_time, 
                         ts.duration, ts.trainer_id, ts.simulator_id, ts.max_participants, ts.skill_level, 
                         ts.price, ts.equipment_type, ts.with_trainer

                UNION ALL

                -- Индивидуальные тренировки на завтра
                SELECT 
                    its.id,
                    its.preferred_date as date,
                    its.preferred_time as start_time,
                    (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
                    its.duration,
                    TRUE as is_individual,
                    NULL as trainer_id,
                    NULL as trainer_name,
                    its.simulator_id,
                    s.name as simulator_name,
                    1 as max_participants,
                    NULL as skill_level,
                    its.price,
                    its.equipment_type,
                    its.with_trainer,
                    NULL as group_name,
                    1 as current_participants,
                    -- Получаем имя участника
                    CASE 
                        WHEN its.child_id IS NOT NULL THEN ch.full_name
                        ELSE c.full_name
                    END as participants_list
                FROM individual_training_sessions its
                LEFT JOIN simulators s ON its.simulator_id = s.id
                LEFT JOIN clients c ON its.client_id = c.id
                LEFT JOIN children ch ON its.child_id = ch.id
                WHERE its.preferred_date = CURRENT_DATE + INTERVAL '1 day'
            )
            SELECT *
            FROM tomorrow_trainings
            ORDER BY start_time;
        `;

        const result = await client.query(query);
        
        // Преобразуем даты и время в строки для корректной сериализации
        const trainings = result.rows.map(training => ({
            ...training,
            date: training.date ? training.date.toISOString().split('T')[0] : null,
            start_time: training.start_time ? training.start_time.toString() : null,
            end_time: training.end_time ? training.end_time.toString() : null
        }));

        return trainings;
    } catch (error) {
        console.error('Ошибка при получении тренировок на завтра:', error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    getTomorrowTrainings
};
