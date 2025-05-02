-- Очистка таблицы тренажеров
TRUNCATE simulators CASCADE;

-- Создание тренажеров
INSERT INTO simulators (id, name, is_working, working_hours_start, working_hours_end) VALUES
(1, 'Тренажер 1', true, '10:00', '21:00'),
(2, 'Тренажер 2', true, '10:00', '21:00'); 