-- Удаляем существующее ограничение внешнего ключа
ALTER TABLE session_participants 
DROP CONSTRAINT session_participants_session_id_fkey;

-- Добавляем новое ограничение без CASCADE
ALTER TABLE session_participants 
ADD CONSTRAINT session_participants_session_id_fkey 
FOREIGN KEY (session_id) 
REFERENCES training_sessions(id);

-- Создаем функцию для обновления статуса тренировки
CREATE OR REPLACE FUNCTION update_training_session_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Если это DELETE операция
    IF (TG_OP = 'DELETE') THEN
        -- Проверяем, остались ли еще участники
        IF NOT EXISTS (
            SELECT 1 
            FROM session_participants 
            WHERE session_id = OLD.session_id 
            AND status = 'confirmed'
        ) THEN
            -- Обновляем статус тренировки на 'cancelled'
            UPDATE training_sessions 
            SET status = 'cancelled' 
            WHERE id = OLD.session_id;
        END IF;
        RETURN OLD;
    -- Если это UPDATE операция
    ELSIF (TG_OP = 'UPDATE') THEN
        -- Если статус участника изменился на 'cancelled'
        IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
            -- Проверяем, остались ли еще участники
            IF NOT EXISTS (
                SELECT 1 
                FROM session_participants 
                WHERE session_id = NEW.session_id 
                AND status = 'confirmed'
                AND id != NEW.id
            ) THEN
                -- Обновляем статус тренировки на 'cancelled'
                UPDATE training_sessions 
                SET status = 'cancelled' 
                WHERE id = NEW.session_id;
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Создаем триггер для отслеживания изменений в session_participants
DROP TRIGGER IF EXISTS update_training_status_trigger ON session_participants;
CREATE TRIGGER update_training_status_trigger
AFTER DELETE OR UPDATE ON session_participants
FOR EACH ROW
EXECUTE FUNCTION update_training_session_status(); 