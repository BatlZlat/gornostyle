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