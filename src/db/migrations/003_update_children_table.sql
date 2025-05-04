-- Обновляем существующую таблицу children
DO $$ 
BEGIN
    -- Проверяем, существует ли ограничение NOT NULL
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'children' 
        AND column_name = 'sport_type' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE children ALTER COLUMN sport_type DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'children' 
        AND column_name = 'skill_level' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE children ALTER COLUMN skill_level DROP NOT NULL;
    END IF;
END $$; 