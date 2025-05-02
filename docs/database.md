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
    is_group_session BOOLEAN DEFAULT FALSE,
    max_participants INTEGER NOT NULL,
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 5),
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled',
    equipment_type VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Поля таблицы:

- `id` - уникальный идентификатор тренировки
- `simulator_id` - ID тренажера (1 или 2)
- `trainer_id` - ID тренера (может быть NULL для тренировок без тренера)
- `group_id` - ID группы (заполняется только для групповых тренировок)
- `session_date` - дата тренировки
- `start_time` - время начала
- `end_time` - время окончания
- `duration` - длительность в минутах (по умолчанию 60)
- `is_group_session` - флаг групповой тренировки
- `max_participants` - максимальное количество участников
- `skill_level` - уровень сложности (1-5, может быть NULL)
- `price` - стоимость тренировки
- `status` - статус тренировки (scheduled, completed, cancelled)
- `equipment_type` - тип снаряжения (ski, snowboard)
- `created_at` - дата создания записи
- `updated_at` - дата последнего обновления

### Особенности работы:

1. **Групповые тренировки**:
   - Создаются администратором
   - Всегда имеют длительность 60 минут
   - Требуют выбора группы из списка
   - Имеют ограничение по уровню сложности (опционально)
   - При создании блокируют слоты в расписании

2. **Индивидуальные тренировки**:
   - Могут создаваться через личный кабинет или форму на сайте
   - Могут быть с тренером или без
   - При записи блокируют слоты в расписании

3. **Взаимодействие с расписанием**:
   - При создании тренировки соответствующие слоты в таблице `schedule` помечаются как занятые (`is_booked = true`)
   - При отмене тренировки слоты освобождаются (`is_booked = false`)

### Примеры использования:

1. Создание групповой тренировки:
```sql
INSERT INTO training_sessions (
    simulator_id, trainer_id, group_id, session_date, 
    start_time, end_time, is_group_session, max_participants, 
    skill_level, price, equipment_type
) VALUES (
    1, 1, 1, '2024-03-20', 
    '10:00', '11:00', true, 6, 
    2, 2500.00, 'ski'
);
```

2. Создание индивидуальной тренировки:
```sql
INSERT INTO training_sessions (
    simulator_id, trainer_id, session_date, 
    start_time, end_time, is_group_session, max_participants, 
    price, equipment_type
) VALUES (
    1, 1, '2024-03-20', 
    '11:00', '11:30', false, 1, 
    3000.00, 'ski'
);
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