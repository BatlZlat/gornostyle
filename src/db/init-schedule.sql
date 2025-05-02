-- Создание таблицы для настроек расписания
CREATE TABLE IF NOT EXISTS schedule_settings (
    id SERIAL PRIMARY KEY,
    auto_schedule_enabled BOOLEAN DEFAULT false,
    auto_schedule_day INTEGER DEFAULT 1, -- 1 = Понедельник, 7 = Воскресенье
    auto_schedule_time TIME DEFAULT '10:00',
    timezone VARCHAR(50) DEFAULT 'Asia/Yekaterinburg',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание таблицы для слотов расписания
CREATE TABLE IF NOT EXISTS schedule_slots (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    simulator_id INTEGER NOT NULL REFERENCES simulators(id),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_booked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, simulator_id, start_time)
);

-- Создание временных слотов для каждого тренажера
DO $$
DECLARE
    simulator_id INTEGER;
    current_date DATE := CURRENT_DATE;
    slot_time TIME;
BEGIN
    -- Для каждого тренажера
    FOR simulator_id IN SELECT id FROM simulators LOOP
        -- Создаем слоты на 7 дней вперед
        FOR i IN 0..6 LOOP
            -- Создаем слоты с 10:00 до 21:00 с интервалом в 1 час
            slot_time := '10:00'::TIME;
            WHILE slot_time < '22:00'::TIME LOOP
                INSERT INTO schedule (
                    simulator_id,
                    date,
                    start_time,
                    end_time,
                    is_holiday,
                    is_booked
                ) VALUES (
                    simulator_id,
                    current_date + i,
                    slot_time,
                    slot_time + '1 hour'::INTERVAL,
                    FALSE,
                    FALSE
                );
                slot_time := slot_time + '1 hour'::INTERVAL;
            END LOOP;
        END LOOP;
    END LOOP;
END $$; 