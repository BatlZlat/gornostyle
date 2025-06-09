-- Миграция 001: добавление колонки training_type (FALSE = individual, TRUE = group) в таблицу training_sessions
ALTER TABLE training_sessions ADD COLUMN training_type BOOLEAN DEFAULT FALSE; 