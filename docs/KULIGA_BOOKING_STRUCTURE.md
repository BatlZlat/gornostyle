# 📊 СТРУКТУРА БРОНИРОВАНИЙ КУЛИГИ: Объяснение таблиц и связей

## 🎯 Краткий ответ на вопрос "Как система понимает, что клиент записан на программу?"

**Ответ:** Система определяет это через цепочку таблиц:
1. **`kuliga_programs`** - шаблон программы (например, "Лыжники новички +14")
2. **`kuliga_group_trainings`** - конкретная тренировка из программы (13.12.2025 в 10:15)
3. **`kuliga_bookings`** - бронирование клиента на эту тренировку
4. **`clients`** - информация о клиенте

**Связь:** `kuliga_bookings.group_training_id` → `kuliga_group_trainings.id` → `kuliga_group_trainings.program_id` → `kuliga_programs.id`

---

## 📋 Полная схема таблиц и связей

### 1. Таблица `kuliga_programs` (Регулярные программы)

**Назначение:** Шаблон программы с расписанием (дни недели, время)

```sql
CREATE TABLE kuliga_programs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,              -- "Лыжники новички +14"
    description TEXT,                         -- Описание программы
    sport_type VARCHAR(20) NOT NULL,         -- 'ski', 'snowboard', 'both'
    max_participants INTEGER NOT NULL,       -- 4 человека
    training_duration INTEGER NOT NULL,      -- 75 минут
    warmup_duration INTEGER NOT NULL,        -- 15 минут
    weekdays INTEGER[] NOT NULL,             -- [6] = суббота
    time_slots TIME[] NOT NULL,              -- ['10:15:00'] = 10:15
    price DECIMAL(10,2) NOT NULL,           -- 1700.00 руб.
    location VARCHAR(20),                    -- 'kuliga' или 'vorona'
    is_active BOOLEAN DEFAULT TRUE,
    ...
);
```

**Пример данных:**
```
id: 22
name: "Лыжники новички +14"
max_participants: 4
weekdays: [6]  -- Суббота
time_slots: ['10:15:00']
location: 'vorona'
```

**Ключевые поля:**
- `weekdays` - массив дней недели (0=ВС, 1=ПН, ..., 6=СБ)
- `time_slots` - массив времен начала тренировок
- **Программа сама по себе не содержит конкретных дат**, только шаблон

---

### 2. Таблица `kuliga_group_trainings` (Конкретные тренировки)

**Назначение:** Реальная тренировка с конкретной датой, созданная из программы или вручную

```sql
CREATE TABLE kuliga_group_trainings (
    id SERIAL PRIMARY KEY,
    program_id INTEGER REFERENCES kuliga_programs(id),  -- ← СВЯЗЬ С ПРОГРАММОЙ
    instructor_id INTEGER REFERENCES kuliga_instructors(id),
    slot_id INTEGER REFERENCES kuliga_schedule_slots(id),
    
    -- Конкретная дата и время
    date DATE NOT NULL,                      -- '2025-12-13'
    start_time TIME NOT NULL,                -- '10:15:00'
    end_time TIME NOT NULL,                  -- '11:30:00'
    
    sport_type VARCHAR(20) NOT NULL,        -- 'ski'
    level VARCHAR(50),                      -- 'beginner' (для программ может быть пустым)
    description TEXT,
    
    price_per_person DECIMAL(10,2) NOT NULL, -- 1700.00
    max_participants INTEGER NOT NULL,      -- 4
    current_participants INTEGER DEFAULT 0,  -- Сколько уже записано
    min_participants INTEGER NOT NULL,      -- 2
    
    status VARCHAR(20) DEFAULT 'open',      -- 'open', 'confirmed', 'cancelled'
    location VARCHAR(20),                   -- 'vorona'
    ...
);
```

**Пример данных:**
```
id: 123
program_id: 22              ← СВЯЗЬ: Эта тренировка создана из программы #22
date: '2025-12-13'          ← Конкретная дата
start_time: '10:15:00'      ← Конкретное время
max_participants: 4
current_participants: 1     ← Уже записан 1 человек
status: 'open'
location: 'vorona'
```

**Ключевые поля:**
- **`program_id`** - связь с программой (NULL, если тренировка создана вручную)
- `current_participants` - **счетчик записанных участников** (обновляется автоматически)
- `date` - конкретная дата тренировки

**Как создаются тренировки:**
1. Автоматически - система генерирует тренировки из программы на даты, где совпадают день недели и время
2. Вручную - инструктор создает групповую тренировку без привязки к программе (`program_id = NULL`)

---

### 3. Таблица `kuliga_bookings` (Бронирования клиентов)

**Назначение:** Запись клиента на конкретную тренировку

```sql
CREATE TABLE kuliga_bookings (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),  -- ← КТО ЗАПИСАН
    
    booking_type VARCHAR(20) NOT NULL,      -- 'individual' или 'group'
    
    -- Для групповых тренировок:
    group_training_id INTEGER REFERENCES kuliga_group_trainings(id),  -- ← СВЯЗЬ С ТРЕНИРОВКОЙ
    
    -- Для индивидуальных тренировок:
    instructor_id INTEGER REFERENCES kuliga_instructors(id),
    slot_id INTEGER REFERENCES kuliga_schedule_slots(id),
    
    -- Детали бронирования (дублируются для удобства)
    date DATE NOT NULL,                     -- '2025-12-13'
    start_time TIME NOT NULL,               -- '10:15:00'
    end_time TIME NOT NULL,                 -- '11:30:00'
    sport_type VARCHAR(20) NOT NULL,       -- 'ski'
    
    -- Количество участников в этом бронировании
    participants_count INTEGER DEFAULT 1,   -- 1 человек
    participants_names TEXT[],              -- ['Тестировщик']
    participants_birth_years INTEGER[],     -- [1988]
    
    -- Цена
    price_total DECIMAL(10,2) NOT NULL,     -- 1700.00
    price_per_person DECIMAL(10,2) NOT NULL, -- 1700.00
    
    status VARCHAR(20) DEFAULT 'pending',   -- 'pending', 'confirmed', 'cancelled'
    location VARCHAR(20),                   -- 'vorona'
    ...
);
```

**Пример данных:**
```
id: 456
client_id: 789                    ← КТО: Клиент с ID 789
group_training_id: 123            ← НА ЧТО: Тренировка #123 (из программы #22)
booking_type: 'group'
date: '2025-12-13'
start_time: '10:15:00'
participants_count: 1
participants_names: ['Тестировщик']
price_total: 1700.00
status: 'confirmed'
location: 'vorona'
```

**Ключевые поля:**
- **`client_id`** - **КТО записан** (клиент)
- **`group_training_id`** - **НА ЧТО записан** (конкретная тренировка)
- `participants_count` - сколько человек в этом бронировании (может быть несколько)
- `participants_names` - имена всех участников
- `status` - статус бронирования

---

### 4. Таблица `clients` (Клиенты)

**Назначение:** Информация о клиентах (используется общая таблица для всей системы)

```sql
CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,        -- 'Тестировщик'
    phone VARCHAR(20) NOT NULL,             -- '+79123456789'
    email VARCHAR(255),
    telegram_id BIGINT,                     -- ID в Telegram боте
    birth_date DATE,
    ...
);
```

**Пример данных:**
```
id: 789
full_name: 'Тестировщик'
phone: '+79123456789'
telegram_id: 123456789
```

---

## 🔗 Связи между таблицами

### Схема связей для записи на программу:

```
┌─────────────────────┐
│ kuliga_programs     │
│ (ID: 22)            │
│ "Лыжники новички +14"│
│ weekdays: [6]       │ ← Шаблон (суббота)
│ time_slots: [10:15] │ ← Шаблон (10:15)
└──────────┬──────────┘
           │
           │ program_id
           ↓
┌──────────────────────────────┐
│ kuliga_group_trainings       │
│ (ID: 123)                    │
│ program_id: 22               │ ← Связь с программой
│ date: '2025-12-13'           │ ← Конкретная дата
│ start_time: '10:15:00'       │ ← Конкретное время
│ current_participants: 1      │ ← Счетчик участников
└──────────┬───────────────────┘
           │
           │ group_training_id
           ↓
┌──────────────────────────────┐
│ kuliga_bookings              │
│ (ID: 456)                    │
│ client_id: 789               │ ← КТО записан
│ group_training_id: 123       │ ← НА ЧТО записан
│ participants_count: 1        │
│ status: 'confirmed'          │
└──────────┬───────────────────┘
           │
           │ client_id
           ↓
┌─────────────────────┐
│ clients             │
│ (ID: 789)           │
│ full_name: "Тестировщик" │
└─────────────────────┘
```

---

## 🔍 Как система определяет запись клиента на программу

### Запрос для получения всех записей клиента на программу:

```sql
SELECT 
    kp.id as program_id,
    kp.name as program_name,
    kgt.id as training_id,
    kgt.date,
    kgt.start_time,
    kb.id as booking_id,
    kb.participants_count,
    kb.participants_names,
    kb.status as booking_status,
    c.full_name as client_name
FROM clients c
JOIN kuliga_bookings kb ON c.id = kb.client_id
JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
LEFT JOIN kuliga_programs kp ON kgt.program_id = kp.id  -- LEFT JOIN, т.к. может быть NULL
WHERE c.id = 789  -- ID клиента
  AND kb.status IN ('pending', 'confirmed')
  AND kgt.program_id IS NOT NULL  -- Только записи на программы
ORDER BY kgt.date, kgt.start_time;
```

### Как считается `current_participants` в `kuliga_group_trainings`:

**Вариант 1:** Через счетчик (обновляется при создании/отмене бронирования)
```sql
-- При создании бронирования:
UPDATE kuliga_group_trainings
SET current_participants = current_participants + $1
WHERE id = $2;

-- При отмене:
UPDATE kuliga_group_trainings
SET current_participants = current_participants - $1
WHERE id = $2;
```

**Вариант 2:** Вычисляется из бронирований (для проверки)
```sql
SELECT 
    kgt.id,
    kgt.max_participants,
    COALESCE(SUM(kb.participants_count) FILTER (WHERE kb.status IN ('pending', 'confirmed')), 0) as current_participants
FROM kuliga_group_trainings kgt
LEFT JOIN kuliga_bookings kb ON kgt.id = kb.group_training_id
WHERE kgt.id = 123
GROUP BY kgt.id;
```

---

## 📝 Пример полного процесса записи

### Шаг 1: Администратор создает программу
```sql
INSERT INTO kuliga_programs (name, max_participants, weekdays, time_slots, ...)
VALUES ('Лыжники новички +14', 4, ARRAY[6], ARRAY['10:15:00'], ...);
-- program_id = 22
```

### Шаг 2: Система автоматически генерирует тренировки
```sql
-- Для каждой субботы (day = 6) в 10:15 создается тренировка:
INSERT INTO kuliga_group_trainings (program_id, date, start_time, ...)
VALUES (22, '2025-12-13', '10:15:00', ...);
-- training_id = 123, current_participants = 0
```

### Шаг 3: Клиент записывается через сайт/бота
```sql
-- Создается бронирование:
INSERT INTO kuliga_bookings (client_id, group_training_id, participants_count, ...)
VALUES (789, 123, 1, ...);
-- booking_id = 456

-- Обновляется счетчик:
UPDATE kuliga_group_trainings
SET current_participants = current_participants + 1
WHERE id = 123;
-- current_participants = 1
```

### Шаг 4: Проверка "Кто записан на программу?"
```sql
SELECT 
    c.full_name,
    kb.participants_names,
    kb.date,
    kb.start_time
FROM kuliga_bookings kb
JOIN clients c ON kb.client_id = c.id
JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
WHERE kgt.program_id = 22  -- Программа "Лыжники новички +14"
  AND kb.status = 'confirmed';
```

---

## 🎯 Итоговая схема для вопроса "Как система понимает?"

**Ответ в виде SQL:**
```sql
-- Все записи клиента на программы:
SELECT 
    kp.name as program_name,           -- "Лыжники новички +14"
    kgt.date,                          -- '2025-12-13'
    kgt.start_time,                    -- '10:15:00'
    kb.participants_names,             -- ['Тестировщик']
    kb.status                          -- 'confirmed'
FROM kuliga_bookings kb
JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
JOIN kuliga_programs kp ON kgt.program_id = kp.id
WHERE kb.client_id = 789  -- ID клиента
  AND kb.status IN ('pending', 'confirmed');
```

**Цепочка связей:**
1. `kuliga_bookings.client_id` → **КТО** (клиент)
2. `kuliga_bookings.group_training_id` → **НА КАКУЮ ТРЕНИРОВКУ** (конкретная дата/время)
3. `kuliga_group_trainings.program_id` → **ИЗ КАКОЙ ПРОГРАММЫ** (шаблон)
4. `kuliga_programs.name` → **НАЗВАНИЕ ПРОГРАММЫ**

---

## 🔑 Ключевые моменты

1. **`kuliga_programs`** - это **ШАБЛОН**, не конкретная тренировка
2. **`kuliga_group_trainings`** - это **КОНКРЕТНАЯ ТРЕНИРОВКА** с датой (может быть из программы или создана вручную)
3. **`kuliga_bookings`** - это **ЗАПИСЬ КЛИЕНТА** на конкретную тренировку
4. **Счетчик `current_participants`** обновляется автоматически при создании/отмене бронирований
5. Для программ: `program_id` связывает тренировку с шаблоном программы
6. Один клиент может иметь несколько `kuliga_bookings` на разные тренировки одной программы








