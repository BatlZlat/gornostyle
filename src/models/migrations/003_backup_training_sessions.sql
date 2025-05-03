-- Создаем временную таблицу для бэкапа
CREATE TABLE training_sessions_backup AS 
SELECT * FROM training_sessions; 