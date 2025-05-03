const db = require('./db');

class Training {
    static async create(trainingData) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');

            // 1. Проверяем доступность времени
            const scheduleCheck = await client.query(
                `SELECT id FROM schedule 
                WHERE simulator_id = $1 
                AND date = $2 
                AND start_time = $3 
                AND end_time = $4 
                AND is_booked = false 
                AND is_holiday = false`,
                [trainingData.simulator_id, trainingData.date, trainingData.start_time, trainingData.end_time]
            );

            if (scheduleCheck.rows.length === 0) {
                throw new Error('Выбранное время недоступно для бронирования');
            }

            const scheduleId = scheduleCheck.rows[0].id;

            // 2. Создаем тренировку
            const trainingResult = await client.query(
                `INSERT INTO training_sessions 
                (simulator_id, trainer_id, group_id, session_date, start_time, end_time, 
                duration, training_type, max_participants, skill_level, price, status, equipment_type)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING id`,
                [
                    trainingData.simulator_id,
                    trainingData.trainer_id,
                    trainingData.group_id,
                    trainingData.date,
                    trainingData.start_time,
                    trainingData.end_time,
                    trainingData.duration || 60,
                    trainingData.training_type,
                    trainingData.max_participants,
                    trainingData.skill_level,
                    trainingData.price,
                    'scheduled',
                    trainingData.equipment_type
                ]
            );

            const trainingId = trainingResult.rows[0].id;

            // 3. Помечаем время как забронированное
            await client.query(
                `UPDATE schedule 
                SET is_booked = true 
                WHERE id = $1`,
                [scheduleId]
            );

            await client.query('COMMIT');
            return trainingId;

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // ... остальные методы класса ...
}

module.exports = Training; 