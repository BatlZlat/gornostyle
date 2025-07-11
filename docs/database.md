# Документация базы данных

## Таблица training_sessions

Таблица хранит информацию о тренировках (как групповых, так и индивидуальных).

### Структура таблицы:

```sql
CREATE TABLE training_sessions (
    id SERIAL PRIMARY KEY,
    simulator_id INTEGER REFERENCES simulators(id),
    trainer_id INTEGER REFERENCES trainers(id),
    group_id INTEGER REFERENCES groups(id),
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration INTEGER NOT NULL DEFAULT 60,
    training_type BOOLEAN DEFAULT FALSE, -- FALSE = individual, TRUE = group
    max_participants INTEGER NOT NULL,
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 5),
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, completed, cancelled
    equipment_type VARCHAR(20), -- ski, snowboard
    with_trainer BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Поля таблицы:

- `id` - уникальный идентификатор тренировки
- `simulator_id` - ID тренажера
- `trainer_id` - ID тренера (может быть NULL для тренировок без тренера)
- `group_id` - ID группы (заполняется только для групповых тренировок)
- `session_date` - дата тренировки
- `start_time` - время начала
- `end_time` - время окончания
- `duration` - длительность в минутах (по умолчанию 60)
- `training_type` - тип тренировки (FALSE = индивидуальная, TRUE = групповая)
- `max_participants` - максимальное количество участников
- `skill_level` - уровень сложности (1-5)
- `price` - стоимость тренировки
- `status` - статус тренировки (scheduled, completed, cancelled)
- `equipment_type` - тип снаряжения (ski, snowboard)
- `with_trainer` - наличие тренера
- `created_at` - дата создания записи
- `updated_at` - дата последнего обновления

### Особенности работы:

1. **Групповые тренировки**:
   - Создаются администратором
   - Всегда имеют длительность 60 минут
   - Требуют выбора группы из списка
   - Имеют ограничение по уровню сложности
   - При создании блокируют слоты в расписании

2. **Индивидуальные тренировки**:
   - Могут создаваться через личный кабинет или форму на сайте
   - Могут быть с тренером или без
   - При записи блокируют слоты в расписании

3. **Отображение тренировок**:
   - Тренировки отображаются в хронологическом порядке
   - Показываются только текущие и будущие тренировки
   - Группируются по датам для удобного просмотра
   - Для каждой тренировки доступно редактирование

### Примеры использования:

1. Получение списка тренировок на определенную дату:
```sql
SELECT ts.*, g.name as group_name, t.full_name as trainer_name
FROM training_sessions ts
LEFT JOIN groups g ON ts.group_id = g.id
LEFT JOIN trainers t ON ts.trainer_id = t.id
WHERE ts.session_date >= CURRENT_DATE
ORDER BY ts.session_date, ts.start_time;
```

2. Создание групповой тренировки:
```sql
INSERT INTO training_sessions (
    simulator_id, trainer_id, group_id, session_date, 
    start_time, end_time, training_type, max_participants, 
    skill_level, price, equipment_type
) VALUES (
    1, 1, 1, '2024-03-20', 
    '10:00', '11:00', true, 6, 
    2, 2500.00, 'ski'
);
```

## Telegram бот

### Основные функции:
1. Регистрация и авторизация пользователей
2. Запись на тренировки
3. Просмотр расписания
4. Управление личным кабинетом
5. Работа с кошельком
6. Покупка сертификатов

### Структура данных:
1. Таблица `clients`:
   - Добавлены поля для Telegram: `telegram_id`, `telegram_username`, `nickname`
   - Связь с таблицей `wallets` для управления балансом

2. Таблица `group_training_requests`:
   - Хранение заявок на групповые тренировки
   - Отслеживание статуса заявок
   - Связь с клиентами и тренировками

### Процесс регистрации:
1. Получение базовой информации (ФИО, дата рождения, телефон)
2. Опциональное добавление информации о ребенке
3. Создание кошелька с уникальным номером
4. Активация аккаунта в системе

### Процесс записи на тренировку:
1. Выбор типа тренировки (индивидуальная/групповая)
2. Указание предпочтительной даты и времени
3. Выбор тренера (опционально)
4. Подтверждение записи
5. Получение уведомления о статусе записи

## Таблица group_training_requests

Таблица хранит заявки на групповые тренировки от клиентов.

### Структура таблицы:

```sql
CREATE TABLE group_training_requests (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    has_group BOOLEAN NOT NULL,
    group_size INTEGER,
    training_frequency VARCHAR(20) NOT NULL,
    sport_type VARCHAR(20) NOT NULL,
    skill_level INTEGER CHECK (skill_level BETWEEN 0 AND 10),
    preferred_date DATE NOT NULL,
    preferred_time TIME NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Поля таблицы:

- `id` - уникальный идентификатор заявки
- `client_id` - ID клиента (с каскадным удалением)
- `has_group` - наличие готовой группы
- `group_size` - размер группы (если есть)
- `training_frequency` - частота тренировок ('regular' или 'one-time')
- `sport_type` - тип спорта ('ski' или 'snowboard')
- `skill_level` - уровень катания (0-10)
- `preferred_date` - предпочтительная дата
- `preferred_time` - предпочтительное время
- `status` - статус заявки ('pending', 'approved', 'rejected')
- `created_at` - дата создания заявки
- `updated_at` - дата последнего обновления

### Индексы:

- `idx_group_training_requests_client` - по полю client_id
- `idx_group_training_requests_status` - по полю status

### Триггеры:

- `update_group_training_requests_updated_at` - автоматическое обновление updated_at

### Примеры использования:

1. Создание новой заявки:
```sql
INSERT INTO group_training_requests (
    client_id, has_group, group_size, training_frequency,
    sport_type, skill_level, preferred_date, preferred_time
) VALUES (
    1, true, 4, 'regular',
    'ski', 3, '2024-05-17', '13:00'
);
```

2. Получение всех заявок клиента:
```sql
SELECT * FROM group_training_requests
WHERE client_id = 1
ORDER BY created_at DESC;
```

3. Обновление статуса заявки:
```sql
UPDATE group_training_requests
SET status = 'approved'
WHERE id = 1;
```

### Триггеры:

При создании или отмене тренировки автоматически обновляется статус слотов в таблице `schedule`:

```sql
CREATE OR REPLACE FUNCTION update_schedule_slots()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- При создании тренировки помечаем слоты как занятые
        UPDATE schedule 
        SET is_booked = true
        WHERE simulator_id = NEW.simulator_id
        AND date = NEW.session_date
        AND start_time >= NEW.start_time
        AND end_time <= NEW.end_time;
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' THEN
        -- При отмене тренировки освобождаем слоты
        UPDATE schedule 
        SET is_booked = false
        WHERE simulator_id = NEW.simulator_id
        AND date = NEW.session_date
        AND start_time >= NEW.start_time
        AND end_time <= NEW.end_time;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER training_sessions_schedule_trigger
AFTER INSERT OR UPDATE ON training_sessions
FOR EACH ROW
EXECUTE FUNCTION update_schedule_slots();
``` 