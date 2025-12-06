# Логика начисления денег инструкторам Кулиги

## Структура данных

### Таблица kuliga_instructors
- `id` - ID инструктора
- `admin_percentage` - Процент администратора (по умолчанию 20%)
- `telegram_id` - Telegram ID для уведомлений

### Таблица kuliga_bookings
- `instructor_id` - ID инструктора
- `price_total` - Общая стоимость тренировки
- `date` - Дата тренировки
- `status` - Статус бронирования (pending, confirmed, completed, cancelled, refunded)

## Расчет заработка

### Формула
```
Заработок инструктора = price_total * (1 - admin_percentage / 100)
```

### Пример
- Стоимость тренировки: 2700 руб.
- Процент администратора: 20%
- Заработок инструктора: 2700 * (1 - 20/100) = 2700 * 0.8 = 2160 руб.
- Доля администратора: 2700 * 0.2 = 540 руб.

## Статусы бронирований и начисления

1. **pending** - Бронирование создано, но не оплачено
   - Деньги не начисляются

2. **confirmed** - Бронирование оплачено
   - Деньги начисляются (но не выплачиваются сразу)

3. **completed** - Тренировка проведена
   - Деньги готовы к выплате

4. **cancelled** / **refunded** - Отмена или возврат
   - Деньги не начисляются (или начисление отменяется)

## Таблица kuliga_instructor_payouts (предлагаемая структура)

```sql
CREATE TABLE kuliga_instructor_payouts (
    id SERIAL PRIMARY KEY,
    instructor_id INTEGER NOT NULL REFERENCES kuliga_instructors(id) ON DELETE CASCADE,
    
    -- Период выплаты
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Финансы
    trainings_count INTEGER NOT NULL DEFAULT 0,
    total_revenue DECIMAL(10,2) NOT NULL DEFAULT 0, -- Общая выручка
    instructor_earnings DECIMAL(10,2) NOT NULL DEFAULT 0, -- Заработок инструктора
    admin_commission DECIMAL(10,2) NOT NULL DEFAULT 0, -- Комиссия администратора
    
    -- Статус выплаты
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    payment_method VARCHAR(50), -- Способ выплаты (наличные, банковская карта и т.д.)
    payment_date DATE,
    payment_comment TEXT,
    
    -- Метаданные
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES administrators(id),
    paid_by INTEGER REFERENCES administrators(id),
    
    -- Индексы для быстрого поиска
    CONSTRAINT unique_instructor_period UNIQUE(instructor_id, period_start, period_end)
);

CREATE INDEX idx_kuliga_payouts_instructor ON kuliga_instructor_payouts(instructor_id);
CREATE INDEX idx_kuliga_payouts_status ON kuliga_instructor_payouts(status);
CREATE INDEX idx_kuliga_payouts_period ON kuliga_instructor_payouts(period_start, period_end);
```

## Процесс выплат

### 1. Автоматический расчет
В конце каждого периода (например, месяца) администратор может сформировать выплату:
- Собираются все завершенные тренировки за период
- Рассчитывается общая сумма к выплате
- Создается запись в `kuliga_instructor_payouts` со статусом `pending`

### 2. Подтверждение выплаты
Администратор проверяет расчет и подтверждает выплату:
- Статус меняется на `paid`
- Указывается дата и способ выплаты
- Инструктор получает уведомление

### 3. Отображение в личном кабинете
Инструктор видит:
- Текущий заработок (за неоплаченный период)
- Историю выплат
- Детализацию по тренировкам

## Уведомления

### При записи клиента
Инструктор получает уведомление:
- Участник
- Дата и время
- Общая стоимость
- Его заработок (с учетом процента администратора)

### При выплате
Инструктор получает уведомление:
- Период выплаты
- Количество тренировок
- Общая сумма выплаты
- Способ выплаты

## Просмотр расписания в боте

Инструктор может посмотреть свое расписание в Telegram боте:
- Дата (день недели)
- Время слота
- Статус (свободно / забронировано / заблокировано)
- Для забронированных слотов:
  - ФИО участника
  - Телефон клиента
  - Вид спорта
  - Заработок инструктора за эту тренировку

## API для личного кабинета

### Получение статистики заработка
```javascript
GET /api/kuliga/instructor/earnings?period=current_month
GET /api/kuliga/instructor/earnings?period=all_time
GET /api/kuliga/instructor/earnings?from=2025-01-01&to=2025-01-31
```

### Получение истории выплат
```javascript
GET /api/kuliga/instructor/payouts
```

### Получение детализации тренировок
```javascript
GET /api/kuliga/instructor/trainings?status=completed&from=2025-01-01&to=2025-01-31
```

