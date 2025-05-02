-- Очистка таблицы тренажеров
TRUNCATE TABLE simulators CASCADE;

-- Создание тренажеров
INSERT INTO simulators (name, status, working_hours_start, working_hours_end) VALUES
('Тренажер 1', 'available', '10:00', '21:00'),
('Тренажер 2', 'available', '10:00', '21:00'); 