-- Добавление полей для хранения ФИО в таблицу training_requests
ALTER TABLE training_requests 
    ADD COLUMN client_full_name VARCHAR(100),
    ADD COLUMN child_full_name VARCHAR(100);

-- Обновляем существующие записи, заполняя ФИО клиента
UPDATE training_requests AS tr
SET client_full_name = c.full_name
FROM clients c
WHERE tr.client_id = c.id;

-- Обновляем ФИО ребенка (если есть)
UPDATE training_requests AS tr
SET child_full_name = ch.full_name
FROM children ch
WHERE tr.child_id = ch.id; 