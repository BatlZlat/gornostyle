-- Восстанавливаем данные из бэкапа
INSERT INTO training_sessions (
    simulator_id,
    trainer_id,
    group_id,
    session_date,
    start_time,
    end_time,
    duration,
    training_type,
    max_participants,
    skill_level,
    price,
    status,
    equipment_type,
    created_at,
    updated_at
)
SELECT 
    simulator_id,
    trainer_id,
    group_id,
    session_date,
    start_time,
    end_time,
    duration,
    is_group_session as training_type, -- конвертируем старое поле в новое
    max_participants,
    skill_level,
    price,
    status,
    equipment_type,
    created_at,
    updated_at
FROM training_sessions_backup;

-- Удаляем временную таблицу
DROP TABLE training_sessions_backup; 