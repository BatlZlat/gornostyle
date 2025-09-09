# Схема базы данных для системы сертификатов

## Обзор изменений

Система сертификатов требует обновления существующей таблицы `certificates` и добавления новой таблицы `certificate_designs` для управления дизайнами сертификатов.

## Обновленная таблица certificates

### Текущая структура
```sql
CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    certificate_number VARCHAR(20) UNIQUE NOT NULL,
    purchaser_id INTEGER REFERENCES clients(id),
    purchase_date TIMESTAMP NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active', -- active, used, expired
    expiry_date TIMESTAMP NOT NULL,
    activated_by_id INTEGER REFERENCES clients(id),
    activation_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Новая структура
```sql
-- Удаляем старую таблицу
DROP TABLE IF EXISTS certificates;

-- Создаем новую таблицу с расширенной функциональностью
CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    certificate_number VARCHAR(12) UNIQUE NOT NULL, -- 6-значный номер
    purchaser_id INTEGER REFERENCES clients(id), -- кто купил
    recipient_name VARCHAR(100), -- кому подарили (может быть пустым)
    recipient_phone VARCHAR(20), -- телефон получателя
    nominal_value DECIMAL(10,2) NOT NULL, -- номинал сертификата
    design_id INTEGER NOT NULL REFERENCES certificate_designs(id), -- выбранный дизайн
    status VARCHAR(20) DEFAULT 'active', -- active, used, expired, cancelled
    expiry_date TIMESTAMP NOT NULL, -- срок действия (1 год)
    activated_by_id INTEGER REFERENCES clients(id), -- кто активировал
    activation_date TIMESTAMP, -- дата активации
    message TEXT, -- сообщение для получателя
    purchase_date TIMESTAMP NOT NULL, -- дата покупки
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Изменения в полях
| Поле | Старое | Новое | Описание |
|------|--------|-------|----------|
| `certificate_number` | VARCHAR(20) | VARCHAR(12) | Уменьшено до 6-значного номера |
| `amount` | DECIMAL(10,2) | `nominal_value` | Переименовано для ясности |
| `recipient_name` | - | VARCHAR(100) | **НОВОЕ** - имя получателя |
| `recipient_phone` | - | VARCHAR(20) | **НОВОЕ** - телефон получателя |
| `design_id` | - | INTEGER | **НОВОЕ** - ссылка на дизайн |
| `message` | - | TEXT | **НОВОЕ** - сообщение для получателя |
| `status` | active, used, expired | active, used, expired, cancelled | Добавлен статус "cancelled" |

## Новая таблица certificate_designs

```sql
CREATE TABLE certificate_designs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL, -- "Классический", "Спортивный", "Праздничный"
    description TEXT, -- описание дизайна
    image_url VARCHAR(255) NOT NULL, -- ссылка на превью изображение
    template_url VARCHAR(255) NOT NULL, -- ссылка на HTML шаблон для генерации
    is_active BOOLEAN DEFAULT TRUE, -- активен ли дизайн
    sort_order INTEGER DEFAULT 0, -- порядок сортировки
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Индексы для оптимизации

### Индексы для таблицы certificates
```sql
-- Основные индексы
CREATE INDEX idx_certificates_number ON certificates(certificate_number);
CREATE INDEX idx_certificates_status ON certificates(status);
CREATE INDEX idx_certificates_purchaser ON certificates(purchaser_id);
CREATE INDEX idx_certificates_activated_by ON certificates(activated_by_id);
CREATE INDEX idx_certificates_design ON certificates(design_id);
CREATE INDEX idx_certificates_expiry ON certificates(expiry_date);
CREATE INDEX idx_certificates_purchase_date ON certificates(purchase_date);

-- Составные индексы для частых запросов
CREATE INDEX idx_certificates_status_expiry ON certificates(status, expiry_date);
CREATE INDEX idx_certificates_purchaser_status ON certificates(purchaser_id, status);
CREATE INDEX idx_certificates_activated_by_status ON certificates(activated_by_id, status);
```

### Индексы для таблицы certificate_designs
```sql
CREATE INDEX idx_certificate_designs_active ON certificate_designs(is_active);
CREATE INDEX idx_certificate_designs_sort ON certificate_designs(sort_order);
CREATE INDEX idx_certificate_designs_active_sort ON certificate_designs(is_active, sort_order);
```

## Триггеры для автоматического обновления

### Триггер для обновления updated_at
```sql
-- Триггер для certificates
CREATE TRIGGER update_certificates_updated_at
    BEFORE UPDATE ON certificates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Триггер для certificate_designs
CREATE TRIGGER update_certificate_designs_updated_at
    BEFORE UPDATE ON certificate_designs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

## Начальные данные

### Вставка дизайнов сертификатов
```sql
INSERT INTO certificate_designs (name, description, image_url, template_url, sort_order) VALUES
('Классический', 'Элегантный, деловой стиль с логотипом компании', '/images/certificates/classic.jpg', '/templates/certificates/classic.html', 1),
('Спортивный', 'Динамичный дизайн с лыжами и сноубордом', '/images/certificates/sport.jpg', '/templates/certificates/sport.html', 2),
('Праздничный', 'Яркий дизайн для особых случаев', '/images/certificates/party.jpg', '/templates/certificates/party.html', 3),
('Минималистичный', 'Простой, современный дизайн', '/images/certificates/minimal.jpg', '/templates/certificates/minimal.html', 4);
```

## Миграция существующих данных

### Скрипт миграции
```sql
-- Создаем временную таблицу для сохранения существующих данных
CREATE TABLE certificates_backup AS SELECT * FROM certificates;

-- Удаляем старую таблицу
DROP TABLE certificates;

-- Создаем новую таблицу (код выше)

-- Восстанавливаем данные из backup
INSERT INTO certificates (
    id, certificate_number, purchaser_id, purchase_date, 
    nominal_value, status, expiry_date, activated_by_id, 
    activation_date, created_at, updated_at
)
SELECT 
    id, certificate_number, purchaser_id, purchase_date,
    amount as nominal_value, status, expiry_date, activated_by_id,
    activation_date, created_at, updated_at
FROM certificates_backup;

-- Удаляем backup таблицу
DROP TABLE certificates_backup;
```

## Ограничения и проверки

### CHECK ограничения
```sql
-- Проверка номинала сертификата
ALTER TABLE certificates ADD CONSTRAINT check_nominal_value 
    CHECK (nominal_value >= 500 AND nominal_value <= 50000);

-- Проверка статуса сертификата
ALTER TABLE certificates ADD CONSTRAINT check_certificate_status 
    CHECK (status IN ('active', 'used', 'expired', 'cancelled'));

-- Проверка номера сертификата (6 цифр)
ALTER TABLE certificates ADD CONSTRAINT check_certificate_number 
    CHECK (certificate_number ~ '^[0-9]{6}$');

-- Проверка срока действия (не более 1 года)
ALTER TABLE certificates ADD CONSTRAINT check_expiry_date 
    CHECK (expiry_date <= purchase_date + INTERVAL '1 year');
```

### Уникальные ограничения
```sql
-- Уникальность номера сертификата
ALTER TABLE certificates ADD CONSTRAINT unique_certificate_number 
    UNIQUE (certificate_number);

-- Уникальность имени дизайна
ALTER TABLE certificate_designs ADD CONSTRAINT unique_design_name 
    UNIQUE (name);
```

## Представления для удобства

### Представление для активных сертификатов
```sql
CREATE VIEW active_certificates AS
SELECT 
    c.id,
    c.certificate_number,
    c.nominal_value,
    c.recipient_name,
    c.recipient_phone,
    c.message,
    c.expiry_date,
    c.purchase_date,
    cd.name as design_name,
    cd.image_url as design_image,
    cl.full_name as purchaser_name
FROM certificates c
JOIN certificate_designs cd ON c.design_id = cd.id
LEFT JOIN clients cl ON c.purchaser_id = cl.id
WHERE c.status = 'active' AND c.expiry_date > NOW();
```

### Представление для использованных сертификатов
```sql
CREATE VIEW used_certificates AS
SELECT 
    c.id,
    c.certificate_number,
    c.nominal_value,
    c.recipient_name,
    c.activation_date,
    c.purchase_date,
    cd.name as design_name,
    cl.full_name as purchaser_name,
    cl2.full_name as activated_by_name
FROM certificates c
JOIN certificate_designs cd ON c.design_id = cd.id
LEFT JOIN clients cl ON c.purchaser_id = cl.id
LEFT JOIN clients cl2 ON c.activated_by_id = cl2.id
WHERE c.status = 'used';
```

## Статистические запросы

### Популярные номиналы
```sql
SELECT 
    nominal_value,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM certificates 
WHERE status = 'used'
GROUP BY nominal_value 
ORDER BY count DESC;
```

### Популярные дизайны
```sql
SELECT 
    cd.name as design_name,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM certificates c
JOIN certificate_designs cd ON c.design_id = cd.id
WHERE c.status = 'used'
GROUP BY cd.id, cd.name 
ORDER BY count DESC;
```

### Статистика по месяцам
```sql
SELECT 
    DATE_TRUNC('month', purchase_date) as month,
    COUNT(*) as certificates_sold,
    SUM(nominal_value) as total_value,
    AVG(nominal_value) as average_value
FROM certificates 
GROUP BY DATE_TRUNC('month', purchase_date)
ORDER BY month DESC;
```

## Резервное копирование

### Скрипт резервного копирования
```bash
#!/bin/bash
# backup_certificates.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="certificates_backup_$DATE.sql"

pg_dump -h localhost -U username -d database_name \
    -t certificates \
    -t certificate_designs \
    -f "$BACKUP_FILE"

echo "Backup created: $BACKUP_FILE"
```

## Мониторинг производительности

### Запросы для мониторинга
```sql
-- Размер таблиц
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE tablename IN ('certificates', 'certificate_designs');

-- Статистика использования индексов
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE tablename IN ('certificates', 'certificate_designs');
```

## Заключение

Обновленная схема базы данных обеспечивает:

1. **Гибкость** - поддержка произвольных номиналов и дизайнов
2. **Масштабируемость** - оптимизированные индексы для быстрых запросов
3. **Целостность** - проверки и ограничения для корректности данных
4. **Удобство** - представления и статистические запросы
5. **Надежность** - резервное копирование и мониторинг

Схема готова к использованию и может быть легко расширена в будущем.
