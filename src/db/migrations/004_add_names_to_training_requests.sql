-- Добавление полей для хранения ФИО в таблицу training_requests
ALTER TABLE training_requests 
    ADD COLUMN client_full_name VARCHAR(100),
    ADD COLUMN child_full_name VARCHAR(100);

-- Обновляем существующие записи, заполняя ФИО из связанных таблиц
UPDATE training_requests tr
SET 
    client_full_name = c.full_name,
    child_full_name = ch.full_name
FROM clients c
LEFT JOIN children ch ON tr.child_id = ch.id
WHERE tr.client_id = c.id; 