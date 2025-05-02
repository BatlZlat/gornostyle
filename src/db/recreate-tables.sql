-- Отключаем проверку внешних ключей
SET session_replication_role = 'replica';

-- Удаляем все таблицы с каскадным удалением
DROP TABLE IF EXISTS administrators CASCADE;
DROP TABLE IF EXISTS children CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS trainers CASCADE;
DROP TABLE IF EXISTS simulators CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS training_sessions CASCADE;
DROP TABLE IF EXISTS session_participants CASCADE;
DROP TABLE IF EXISTS certificates CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS schedule CASCADE;
DROP TABLE IF EXISTS schedule_settings CASCADE;

-- Включаем проверку внешних ключей
SET session_replication_role = 'origin';

-- Создаем таблицы заново
\i src/models/schema.sql

-- Инициализируем базовые данные
\i src/db/init-simulators.sql 