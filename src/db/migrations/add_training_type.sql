-- Добавляем поле training_type, если его еще нет
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'training_sessions' 
        AND column_name = 'training_type'
    ) THEN
        ALTER TABLE training_sessions 
        ADD COLUMN training_type BOOLEAN DEFAULT FALSE; -- FALSE = individual, TRUE = group

        -- Обновляем существующие записи
        UPDATE training_sessions 
        SET training_type = is_group_session 
        WHERE training_type IS NULL;
    END IF;
END $$; 