const { pool } = require('../db');
const moment = require('moment-timezone');

(async () => {
    try {
        const now = moment().tz('Asia/Yekaterinburg');
        const today = now.format('YYYY-MM-DD');
        const currentTime = now.format('HH:mm:ss');

        // Обновляем тренировки тренажера (групповые), которые уже прошли
        const simulatorResult = await pool.query(`
            UPDATE training_sessions
            SET status = 'completed', updated_at = NOW()
            WHERE (slope_type IS NULL OR slope_type = 'simulator')
              AND training_type = TRUE
              AND status = 'scheduled'
              AND (
                session_date < $1
                OR (session_date = $1 AND end_time < $2)
              )
        `, [today, currentTime]);

        console.log(`Групповых тренировок тренажера переведено в completed: ${simulatorResult.rowCount}`);

        // Обновляем зимние тренировки (групповые и индивидуальные), которые уже прошли
        // Важно: обновляем только те, которые действительно прошли по дате И времени
        const winterResult = await pool.query(`
            UPDATE training_sessions
            SET status = 'completed', updated_at = NOW()
            WHERE slope_type = 'natural_slope'
              AND status = 'scheduled'
              AND (
                session_date < $1::date
                OR (session_date = $1::date AND end_time::time < $2::time)
              )
        `, [today, currentTime]);

        console.log(`Зимних тренировок (естественный склон) переведено в completed: ${winterResult.rowCount}`);
        console.log(`Всего тренировок переведено в completed: ${simulatorResult.rowCount + winterResult.rowCount}`);
        
        process.exit(0);
    } catch (err) {
        console.error('Ошибка при обновлении статусов:', err);
        process.exit(1);
    }
})(); 