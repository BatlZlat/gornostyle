-- Обновление триггера для индивидуальных тренировок

-- Удаляем старый триггер, если он существует
DROP TRIGGER IF EXISTS individual_training_sessions_schedule_trigger ON individual_training_sessions;

-- Удаляем старую функцию, если она существует
DROP FUNCTION IF EXISTS update_individual_training_slots();

-- Создаем новую функцию с расширенным логированием
CREATE OR REPLACE FUNCTION update_individual_training_slots()
RETURNS TRIGGER AS $$
DECLARE
    affected_slots INTEGER;
    slot RECORD;
BEGIN
    -- Добавляем логирование
    RAISE NOTICE '=== Триггер update_individual_training_slots ===';
    RAISE NOTICE 'Операция: %', TG_OP;
    RAISE NOTICE 'Параметры: simulator_id = %, date = %, time = %, duration = %',
        CASE WHEN TG_OP = 'INSERT' THEN NEW.simulator_id ELSE OLD.simulator_id END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.preferred_date ELSE OLD.preferred_date END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.preferred_time ELSE OLD.preferred_time END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.duration ELSE OLD.duration END;

    IF TG_OP = 'INSERT' THEN
        -- Проверяем текущий статус слотов
        RAISE NOTICE 'Проверка статуса слотов перед бронированием:';
        FOR slot IN 
            SELECT id, start_time, is_booked 
            FROM schedule 
            WHERE simulator_id = NEW.simulator_id
            AND date = NEW.preferred_date
            AND start_time >= NEW.preferred_time
            AND start_time < (NEW.preferred_time + (NEW.duration || ' minutes')::interval)
        LOOP
            RAISE NOTICE 'Слот %: время = %, занят = %', slot.id, slot.start_time, slot.is_booked;
        END LOOP;

        -- При создании тренировки помечаем слоты как занятые
        UPDATE schedule 
        SET is_booked = true
        WHERE simulator_id = NEW.simulator_id
        AND date = NEW.preferred_date
        AND start_time >= NEW.preferred_time
        AND start_time < (NEW.preferred_time + (NEW.duration || ' minutes')::interval);
        
        GET DIAGNOSTICS affected_slots = ROW_COUNT;
        RAISE NOTICE 'Забронировано слотов: %', affected_slots;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Проверяем текущий статус слотов
        RAISE NOTICE 'Проверка статуса слотов перед освобождением:';
        FOR slot IN 
            SELECT id, start_time, is_booked 
            FROM schedule 
            WHERE simulator_id = OLD.simulator_id
            AND date = OLD.preferred_date
            AND start_time >= OLD.preferred_time
            AND start_time < (OLD.preferred_time + (OLD.duration || ' minutes')::interval)
        LOOP
            RAISE NOTICE 'Слот %: время = %, занят = %', slot.id, slot.start_time, slot.is_booked;
        END LOOP;

        -- При удалении тренировки освобождаем слоты
        UPDATE schedule 
        SET is_booked = false
        WHERE simulator_id = OLD.simulator_id
        AND date = OLD.preferred_date
        AND start_time >= OLD.preferred_time
        AND start_time < (OLD.preferred_time + (OLD.duration || ' minutes')::interval);
        
        GET DIAGNOSTICS affected_slots = ROW_COUNT;
        RAISE NOTICE 'Освобождено слотов: %', affected_slots;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Создаем новый триггер
CREATE TRIGGER individual_training_sessions_schedule_trigger
AFTER INSERT OR DELETE ON individual_training_sessions
FOR EACH ROW
EXECUTE FUNCTION update_individual_training_slots();

-- Проверяем и обновляем существующие слоты
UPDATE schedule s
SET is_booked = true
FROM individual_training_sessions its
WHERE s.simulator_id = its.simulator_id
AND s.date = its.preferred_date
AND s.start_time >= its.preferred_time
AND s.start_time < (its.preferred_time + (its.duration || ' minutes')::interval)
AND s.is_booked = false;

-- Добавляем запись о применении миграции
INSERT INTO migrations (name)
VALUES ('007_update_individual_training_trigger.sql')
ON CONFLICT (name) DO NOTHING; 