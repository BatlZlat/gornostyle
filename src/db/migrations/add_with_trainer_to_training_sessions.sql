-- Добавление колонки with_trainer в таблицу training_sessions
ALTER TABLE training_sessions
ADD COLUMN with_trainer BOOLEAN NOT NULL DEFAULT false; 