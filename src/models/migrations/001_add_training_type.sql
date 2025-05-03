-- Добавление поля training_type
ALTER TABLE training_sessions 
ADD COLUMN training_type BOOLEAN DEFAULT FALSE;

-- Обновление существующих записей
UPDATE training_sessions 
SET training_type = is_group_session;

-- Добавление комментария к полю
COMMENT ON COLUMN training_sessions.training_type IS 'FALSE = individual, TRUE = group'; 