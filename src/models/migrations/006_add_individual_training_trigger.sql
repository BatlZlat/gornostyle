-- Создаем триггер для обновления слотов при создании/отмене индивидуальных тренировок
CREATE OR REPLACE FUNCTION update_individual_training_slots()
RETURNS TRIGGER AS $$
BEGIN
    -- Добавляем логирование
    RAISE NOTICE 'Триггер update_individual_training_slots: операция %', TG_OP;
    RAISE NOTICE 'Триггер update_individual_training_slots: simulator_id = %, date = %, time = %, duration = %',
        CASE WHEN TG_OP = 'INSERT' THEN NEW.simulator_id ELSE OLD.simulator_id END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.preferred_date ELSE OLD.preferred_date END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.preferred_time ELSE OLD.preferred_time END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.duration ELSE OLD.duration END;

    IF TG_OP = 'INSERT' THEN
        -- При создании тренировки помечаем слоты как занятые
        UPDATE schedule 
        SET is_booked = true
        WHERE simulator_id = NEW.simulator_id
        AND date = NEW.preferred_date
        AND start_time >= NEW.preferred_time
        AND start_time < (NEW.preferred_time + (NEW.duration || ' minutes')::interval);
        RAISE NOTICE 'Триггер update_individual_training_slots: слоты помечены как занятые';
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- При удалении тренировки освобождаем слоты
        UPDATE schedule 
        SET is_booked = false
        WHERE simulator_id = OLD.simulator_id
        AND date = OLD.preferred_date
        AND start_time >= OLD.preferred_time
        AND start_time < (OLD.preferred_time + (OLD.duration || ' minutes')::interval);
        RAISE NOTICE 'Триггер update_individual_training_slots: слоты освобождены';
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Удаляем старый триггер, если он существует
DROP TRIGGER IF EXISTS individual_training_sessions_schedule_trigger ON individual_training_sessions;

-- Создаем новый триггер
CREATE TRIGGER individual_training_sessions_schedule_trigger
AFTER INSERT OR DELETE ON individual_training_sessions
FOR EACH ROW
EXECUTE FUNCTION update_individual_training_slots();

-- Обновляем существующие слоты для индивидуальных тренировок
UPDATE schedule s
SET is_booked = true
FROM individual_training_sessions its
WHERE s.simulator_id = its.simulator_id
AND s.date = its.preferred_date
AND s.start_time >= its.preferred_time
AND s.start_time < (its.preferred_time + (its.duration || ' minutes')::interval); 