-- Создание таблицы прайсов
CREATE TABLE IF NOT EXISTS prices (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL, -- 'individual' или 'group'
    with_trainer BOOLEAN NOT NULL,
    duration INTEGER NOT NULL, -- в минутах
    participants INTEGER NOT NULL, -- для групповых занятий
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Индивидуальные занятия с тренером
INSERT INTO prices (type, with_trainer, duration, participants, price) VALUES
('individual', true, 30, 1, 3000),
('individual', true, 60, 1, 6000);

-- Индивидуальные занятия без тренера
INSERT INTO prices (type, with_trainer, duration, participants, price) VALUES
('individual', false, 30, 1, 2500),
('individual', false, 60, 1, 5000);

-- Групповые занятия с тренером
INSERT INTO prices (type, with_trainer, duration, participants, price) VALUES
('group', true, 60, 2, 3500),
('group', true, 60, 3, 3000),
('group', true, 60, 4, 2500),
('group', true, 60, 5, 2200),
('group', true, 60, 6, 1700);

-- Групповые занятия без тренера
INSERT INTO prices (type, with_trainer, duration, participants, price) VALUES
('group', false, 60, 2, 3000),
('group', false, 60, 3, 2500),
('group', false, 60, 4, 2000),
('group', false, 60, 5, 1500),
('group', false, 60, 6, 1300); 