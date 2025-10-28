# Принцип работы логики групповых тренировок на естественном склоне

## Общая концепция

Групповые тренировки на естественном склоне работают по следующему принципу:

1. **Администратор создает группы** через админ-панель
2. **Система создает слоты** в таблице `winter_schedule` для каждой группы
3. **Клиенты записываются** на свободные слоты через Telegram-бота
4. **Система отслеживает** количество участников и управляет доступностью

## 1. Структура данных

### Таблица `groups` (группы)
```sql
CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,        -- Название группы (например, "Начинающие лыжники")
    description TEXT,                   -- Описание группы
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**Пример:** Группа "Дети 10-14 лет", группа "Взрослые продвинутые", и т.д.

### Таблица `winter_schedule` (расписание)
```sql
CREATE TABLE winter_schedule (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,                 -- Дата тренировки
    time_slot TIME NOT NULL,            -- Временной слот (10:30, 12:00, 14:30, и т.д.)
    
    -- Тип тренировки
    is_group_training BOOLEAN DEFAULT FALSE,    -- TRUE для групповых
    is_individual_training BOOLEAN DEFAULT FALSE, -- TRUE для индивидуальных
    
    -- Связи
    group_id INTEGER REFERENCES groups(id),     -- ID группы
    trainer_id INTEGER REFERENCES trainers(id), -- ID тренера
    
    -- Статус и участники
    is_available BOOLEAN DEFAULT TRUE,          -- Доступен ли слот
    max_participants INTEGER DEFAULT 1,         -- Максимальное количество участников
    current_participants INTEGER DEFAULT 0,     -- Текущее количество участников
    
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**Важно:** 
- Для групповых тренировок: `is_group_training = TRUE`, `is_individual_training = FALSE`
- `max_participants` определяет размер группы (например, 6 человек)
- `current_participants` увеличивается при записи клиента

### Таблица `training_sessions` (сессия тренировки)
```sql
CREATE TABLE training_sessions (
    id SERIAL PRIMARY KEY,
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration INTEGER NOT NULL DEFAULT 60,
    
    training_type BOOLEAN DEFAULT FALSE,  -- FALSE = individual, TRUE = group
    group_id INTEGER REFERENCES groups(id),
    
    max_participants INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled',
    
    slope_type VARCHAR(20) DEFAULT 'simulator',
    winter_training_type VARCHAR(20),     -- 'individual', 'sport_group', 'group'
    
    trainer_id INTEGER REFERENCES trainers(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**Для групповых тренировок:**
- `training_type = TRUE`
- `group_id` - связь с группой
- `slope_type = 'natural_slope'`
- `winter_training_type = 'group'`
- `max_participants` - размер группы

### Таблица `session_participants` (участники)
```sql
CREATE TABLE session_participants (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES training_sessions(id),
    client_id INTEGER REFERENCES clients(id),
    child_id INTEGER REFERENCES children(id),
    is_child BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'confirmed',
    created_at TIMESTAMP
);
```

**Принцип:** Каждая запись в этой таблице = один участник в группе

## 2. Процесс создания групповых слотов

### Шаг 1: Администратор создает группу
Администратор через админ-панель (`groups.html`) создает группу:
- Название: "Дети 10-14 лет"
- Описание: "Группа для детей среднего возраста"

### Шаг 2: Миграция создает слоты
Система (через миграцию) создает слоты в `winter_schedule` для каждой даты:

```sql
-- Пример: создание слотов на выходные для группы на период 25.10.2025 - 15.04.2026
INSERT INTO winter_schedule (
    date, time_slot, is_group_training, is_individual_training,
    group_id, max_participants, current_participants, is_available
)
VALUES
    ('2025-10-25', '10:30', TRUE, FALSE, 1, 6, 0, TRUE),
    ('2025-10-25', '12:00', TRUE, FALSE, 1, 6, 0, TRUE),
    ('2025-10-25', '14:30', TRUE, FALSE, 1, 6, 0, TRUE),
    -- и так далее для всех дат...
```

**Каждый слот** - это потенциальная тренировка группы на определенную дату и время.

## 3. Процесс записи клиента

### Шаг 1: Клиент выбирает "Групповые тренировки"
В Telegram-боте клиент нажимает кнопку "🏔️ Групповые тренировки (естественный склон)"

### Шаг 2: Выбор участника
Бот показывает список участников:
- 👤 Для себя
- 👶 Ребенок 1
- 👶 Ребенок 2

### Шаг 3: Выбор группы
Бот показывает доступные группы:
```
Выберите группу:
1. 🎿 Дети 10-14 лет
2. 🏔️ Взрослые продвинутые
3. 🎯 Начинающие лыжники
```

### Шаг 4: Выбор даты
Клиент вводит дату в формате ДД.ММ.ГГГГ

### Шаг 5: Показ доступных слотов
Бот показывает свободные слоты для выбранной даты и группы:

```sql
SELECT * FROM winter_schedule
WHERE date = '2025-10-26'
AND group_id = 1
AND is_available = TRUE
AND is_group_training = TRUE
AND current_participants < max_participants
ORDER BY time_slot;
```

Пример вывода:
```
📅 26.10.2025
Доступные слоты:
⏰ 10:30 - свободно 4 места (занято 2/6)
⏰ 12:00 - свободно 3 места (занято 3/6)
⏰ 16:00 - свободно 1 место (занято 5/6)
⏰ 17:30 - свободно 6 мест (занято 0/6)
```

### Шагalg 6: Подтверждение
Клиент нажимает кнопку "✅ Записаться"

### Шаг 7: Бронирование (все в одной транзакции)

```javascript
BEGIN;

// 1. Проверяем, что еще есть свободные места
const slot = await pool.query(`
    SELECT id, current_participants, max_participants
    FROM winter_schedule
    WHERE date = $1 AND time_slot = $2 AND group_id = $3
`, [date, timeSlot, groupId]);

if (slot.current_participants >= slot.max_participants) {
    ROLLBACK;
    return "Извините, группа уже заполнена";
}

// 2. Создаем или обновляем training_sessions
const trainingResult = await pool.query(`
    SELECT id FROM training_sessions
    WHERE session_date = $1 
    AND start_time = $2
    AND group_id = $3
`, [date, timeSlot, groupId]);

let trainingId;
if (trainingResult.rows.length === 0) {
    // Первая запись в группу - создаем сессию
    const result = await pool.query(`
        INSERT INTO training_sessions (
            session_date, start_time, end_time, duration,
            training_type, group_id, max_participants,
            price, status, slope_type, winter_training_type,
            trainer_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
    `, [
        date, timeSlot, timeSlot, 60,
        TRUE, groupId, 6,
        price, 'scheduled', 'natural_slope', 'group',
        trainerId
    ]);
    trainingId = result.rows[0].id;
} else {
    // Сессия уже существует
    trainingId = trainingResult.rows[0].id;
}

// 3. Добавляем участника
await pool.query(`
    INSERT INTO session_participants (
        session_id, client_id, child_id, is_child, status
    ) VALUES ($1, $2, $3, $4, 'confirmed')
`, [trainingId, clientId, childId, isChild]);

// 4. Увеличиваем счетчик в winter_schedule
await pool.query(`
    UPDATE winter_schedule
    SET current_participants = current_participants + 1,
        is_available = (current_participants + 1 < max_participants)
    WHERE date = $1 AND time_slot loan = $2 AND group_id = $3
`, [date, timeSlot, groupId]);

// 5. Списание средств
await pool.query(`
    UPDATE wallets SET balance = balance - $1 WHERE client_id = $2
`, [price, clientId]);

// 6. Запись транзакции
await pool.query(`
    INSERT INTO transactions (wallet_id, amount, type, description)
    VALUES ($1, $2, 'payment', $3)
`, [walletId, price, `Групповая тренировка на естественном склоне, ...`]);

COMMIT;
```

**Важные моменты:**
- Если `current_participants` достигает `max_participants`, то `is_available = FALSE`
- Цена берется из таблицы `winter_prices` по типу 'group' и количеству участников
- Первая запись в группу создает `training_sessions`, остальные добавляются в `session_participants`

## 4. Процесс отмены

```javascript
BEGIN;

// 1. Уменьшаем счетчик в winter_schedule
await pool.query(`
    UPDATE winter_schedule
    SET current_participants = current_participants - 1,
        is_available = TRUE
    WHERE date = $1 AND time_slot = $2 AND group_id = $3
`, [date, timeSlot, groupId]);

// 2. Удаляем участника
await pool.query(`
    DELETE FROM session_participants WHERE id = $1
`, [participantId]);

// 3. Если это последний участник - удаляем training_sessions
const remainingCount = await pool.query(`
    SELECT COUNT(*) FROM session_participants WHERE session_id = $1
`, [sessionId]);

if (remainingCount.rows[0].count === 0) {
    await pool.query(`
        DELETE FROM training_sessions WHERE id = $1
    `, [sessionId]);
}

// 4. Возврат средств
await pool.query(`
    UPDATE wallets SET balance = balance + $1 WHERE client_id = $2
`, [price, clientId]);

// 5. Запись транзакции
await pool.query(`
    INSERT INTO transactions (wallet_id, amount, type, description)
    VALUES ($1, $2, 'amount', 'Возврат: ...')
`, [walletId, price]);

COMMIT;
```

## 5. Расчет цены

Цены хранятся в таблице `winter_prices`:

```sql
SELECT price FROM winter_prices
WHERE type = 'group'
AND participants = 6  -- размер группы
AND is_active = TRUE
```

**Пример:** 
- Группа 6 человек: 1700₽ за человека
- Клиент платит 1700₽ за свое участие

## 6. Уведомления администратора

При записи:
```
✅ Новая запись на групповую тренировку естественного склона!

🏔️ Место: Естественный склон
👥 Группа: Дети 10-14 лет
👤 Участник: Иван Иванов
📅 Дата: 26.10.2025
⏰ Время: 12:00
💰 Стоимость: 1700.00 руб.
👥 Занято мест: 4/6
```

При отмене:
```
❌ Отмена групповой тренировки естественного склона!

🏔️ Место: Естественный склон
👥 Группа: Дети 10-14 лет
👤 Участник: Иван Иванов
📅 Дата: 26.10.2025
⏰ Время: 12:00
💰 Возврат: 1700.00 руб.
👥 Осталось мест: 3/6
```

## 7. Отображение в админ-панели

В разделе "Расписание" показываются:

### Групповые тренировки:
| Дата | Время | Группа | Тренер | Участники | Статус |
|------|-------|--------|--------|-----------|--------|
| 26.10.2025 | 12:00 | Дети 10-14 лет | Rut Petr | 5/6 | ✅ Активна |
| 26.10.2025 | 14:30 | Взрослые продвинутые | Ivanov Ivan | 2/6 | ✅ Активна |

При клике на "Подробнее" показывается список всех участников группы.

## Итоговая схема

```
1. Администратор создает ГРУППУ → groups
                ↓
2. Миграция создает СЛОТЫ → winter_schedule (для каждой даты)
                ↓
3. Клиент записывается → 
   - создается/обновляется training_sessions
   - добавляется в session_participants
   - увеличивается current_participants
                ↓
4. Система следит за заполненностью группы
   - current_participants < max_participants → можно записаться
   - current_participants = max_participants → группа заполнена
```

Это и есть вся логика! 🎿

