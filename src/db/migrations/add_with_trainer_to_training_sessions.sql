-- Добавляем поле with_trainer, если его еще нет
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'training_sessions' 
        AND column_name = 'with_trainer'
    ) THEN
        ALTER TABLE training_sessions 
        ADD COLUMN with_trainer BOOLEAN DEFAULT FALSE;

        -- Обновляем существующие записи
        UPDATE training_sessions 
        SET with_trainer = FALSE 
        WHERE with_trainer IS NULL;
    END IF;
END $$; 