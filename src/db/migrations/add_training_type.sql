-- Добавляем поле training_type
ALTER TABLE training_sessions 
ADD COLUMN training_type BOOLEAN DEFAULT FALSE; -- FALSE = individual, TRUE = group

-- Обновляем существующие записи
UPDATE training_sessions 
SET training_type = is_group_session 
WHERE training_type IS NULL; 