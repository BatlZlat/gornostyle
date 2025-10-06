# Анализ дополнительных требований

## 1. Юридические аспекты и договор-оферта

### Зачем нужна таблица для договора-оферты?

**ДА, таблица нужна по следующим причинам:**

1. **Юридическая защита**:
   - В случае споров можно доказать, что клиент согласился с условиями
   - IP-адрес и время согласия фиксируются
   - Версия договора сохраняется на момент согласия

2. **Изменение условий**:
   - Можно обновлять договор без потери согласий старых клиентов
   - Новые клиенты соглашаются с новой версией
   - Старые клиенты продолжают работать по старой версии

3. **Соответствие закону**:
   - Требование ФЗ "О персональных данных"
   - Соответствие требованиям Роскомнадзора
   - Защита от штрафов и претензий

### Рекомендуемая реализация:

```sql
-- Таблица договора-оферты
CREATE TABLE terms_of_service (
    id SERIAL PRIMARY KEY,
    version VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    effective_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица согласий пользователей
CREATE TABLE user_agreements (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    terms_version VARCHAR(20) NOT NULL,
    agreed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);
```

### В боте:
1. При первой записи показываем договор
2. Клиент должен поставить галочку "Согласен с правилами"
3. Сохраняем согласие в БД с IP и временем
4. Без согласия запись невозможна

## 2. Реферальная система

### Простая реализация:

**Концепция:**
- Каждый клиент получает уникальную реферальную ссылку
- При регистрации по ссылке оба получают 500₽
- Простая и понятная система

### Изменения в БД:

```sql
-- Добавляем поле в таблицу клиентов
ALTER TABLE clients ADD COLUMN referral_code VARCHAR(20) UNIQUE;
ALTER TABLE clients ADD COLUMN referred_by INTEGER REFERENCES clients(id);

-- Таблица реферальных транзакций
CREATE TABLE referral_transactions (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER REFERENCES clients(id),
    referee_id INTEGER REFERENCES clients(id),
    referrer_bonus DECIMAL(10,2) DEFAULT 500.00,
    referee_bonus DECIMAL(10,2) DEFAULT 500.00,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Логика работы:
1. При регистрации генерируем уникальный код (например: REF123456)
2. Реферальная ссылка: `t.me/your_bot?start=ref_REF123456`
3. При регистрации по ссылке:
   - Начисляем 500₽ рефереру
   - Начисляем 500₽ новому клиенту
   - Записываем в `referral_transactions`

## 3. Система абонементов

### Концепция:
- Клиент покупает абонемент на N тренировок
- Получает скидку за покупку пакета
- Тренировки списываются по мере посещения

### Новые таблицы:

```sql
-- Таблица типов абонементов
CREATE TABLE subscription_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    sessions_count INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица абонементов клиентов
CREATE TABLE client_subscriptions (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    subscription_type_id INTEGER REFERENCES subscription_types(id),
    sessions_remaining INTEGER NOT NULL,
    sessions_used INTEGER DEFAULT 0,
    purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица использования абонементов
CREATE TABLE subscription_usage (
    id SERIAL PRIMARY KEY,
    subscription_id INTEGER REFERENCES client_subscriptions(id),
    training_session_id INTEGER REFERENCES training_sessions(id),
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Примеры абонементов:
- 5 тренировок: 2000₽ (скидка 20%)
- 10 тренировок: 3500₽ (скидка 30%)
- 20 тренировок: 6000₽ (скидка 40%)

## 4. Расширенная система бонусов

### Приоритеты реализации:

**Приоритет 1 (реализовать в первую очередь):**
- Бонус за раннее бронирование (за месяц вперед)
- Бонус за покупку абонемента
- Бонус за отзыв
- Бонус за день рождения

**Приоритет 2 (реализовать во вторую очередь):**
- Бонус за утренние/вечерние тренировки
- Бонус за нового тренера
- Бонус за прогресс

**Приоритет 3 (реализовать позже):**
- Бонус за участие в соревнованиях
- Бонус за VIP статус
- Бонус за социальную активность

### Дополнительные таблицы:

```sql
-- Таблица достижений клиентов
CREATE TABLE client_achievements (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    achievement_type VARCHAR(50) NOT NULL,
    achievement_data JSONB,
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица отзывов
CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    training_session_id INTEGER REFERENCES training_sessions(id),
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    bonus_awarded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Рекомендации по реализации:

### Этап 1: Основные функции
1. Применить базовую миграцию
2. Реализовать договор-оферту
3. Добавить реферальную систему
4. Создать систему абонементов

### Этап 2: Расширенные бонусы
1. Бонус за раннее бронирование
2. Бонус за покупку абонемента
3. Бонус за отзыв
4. Бонус за день рождения

### Этап 3: Дополнительные функции
1. Бонус за время тренировок
2. Бонус за прогресс
3. VIP статус
4. Социальные бонусы

## Выводы:

1. **Договор-оферта**: ОБЯЗАТЕЛЬНО нужна для юридической защиты
2. **Реферальная система**: Простая и эффективная реализация
3. **Абонементы**: Отличная идея для увеличения лояльности
4. **Расширенные бонусы**: Поэтапная реализация по приоритетам

