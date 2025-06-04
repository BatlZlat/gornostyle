const { pool } = require('../db');
const moment = require('moment-timezone');

(async () => {
    try {
        const now = moment().tz('Asia/Yekaterinburg');
        const today = now.format('YYYY-MM-DD');
        const currentTime = now.format('HH:mm:ss');

        // Обновляем тренировки, которые уже прошли (по дате и времени)
        const result = await pool.query(`
            UPDATE training_sessions
            SET status = 'completed', updated_at = NOW()
            WHERE training_type = TRUE
              AND status = 'scheduled'
              AND (
                session_date < $1
                OR (session_date = $1 AND end_time < $2)
              )
        `, [today, currentTime]);

        console.log(`Групповых тренировок переведено в completed: ${result.rowCount}`);
        process.exit(0);
    } catch (err) {
        console.error('Ошибка при обновлении статусов:', err);
        process.exit(1);
    }
})(); 