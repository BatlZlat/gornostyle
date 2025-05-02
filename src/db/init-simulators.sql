-- Очистка таблицы тренажеров
TRUNCATE TABLE simulators CASCADE;

-- Создание тренажеров
INSERT INTO simulators (name, is_working, working_hours_start, working_hours_end) VALUES
('Тренажер 1', true, '10:00', '21:00'),
('Тренажер 2', true, '10:00', '21:00'); 