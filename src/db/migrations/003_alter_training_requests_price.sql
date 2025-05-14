-- Изменение колонки price в таблице training_requests
ALTER TABLE training_requests 
    ALTER COLUMN price DROP NOT NULL,
    ALTER COLUMN price SET DEFAULT 0;

-- Обновляем существующие записи, где price IS NULL
UPDATE training_requests 
SET price = 0 
WHERE price IS NULL; 