-- Миграция 003: пересоздание таблицы training_sessions (DROP и CREATE) с добавлением колонки training_type (FALSE = individual, TRUE = group)
DROP TABLE IF EXISTS training_sessions CASCADE;
CREATE TABLE training_sessions (
    id SERIAL PRIMARY KEY,
    simulator_id INTEGER REFERENCES simulators(id),
    trainer_id INTEGER REFERENCES trainers(id),
    group_id INTEGER REFERENCES groups(id),
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration INTEGER NOT NULL DEFAULT 60,
    training_type BOOLEAN DEFAULT FALSE, -- FALSE = individual, TRUE = group
    max_participants INTEGER NOT NULL,
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 5),
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, completed, cancelled
    equipment_type VARCHAR(20), -- ski, snowboard
    with_trainer BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
); 