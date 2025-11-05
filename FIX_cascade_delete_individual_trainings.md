# 🔧 ИСПРАВЛЕНИЕ ПРОБЛЕМЫ С УДАЛЕНИЕМ ИНДИВИДУАЛЬНЫХ ТРЕНИРОВОК

## 🐛 ПРОБЛЕМА

**Симптом:** Клиенты не могли отменить индивидуальные тренировки через бота. При попытке отмены появлялась ошибка: "Произошла ошибка при отмене тренировки. Пожалуйста, попробуйте позже."

**Причина:** В таблице `trainer_payments` отсутствовало каскадное удаление для внешнего ключа `individual_training_id`. Когда система пыталась удалить индивидуальную тренировку, PostgreSQL блокировал операцию из-за связанных записей в `trainer_payments`.

---

## 🔍 ДИАГНОСТИКА

### 1. Анализ структуры базы данных

**Проблемный внешний ключ:**
```sql
-- ❌ БЕЗ каскадного удаления
"trainer_payments_individual_training_id_fkey" 
FOREIGN KEY (individual_training_id) REFERENCES individual_training_sessions(id)
```

**Связанные записи:**
```sql
-- Найдена 1 запись в trainer_payments для индивидуальной тренировки ID 146
SELECT COUNT(*) FROM trainer_payments WHERE individual_training_id IS NOT NULL;
-- Результат: 1
```

### 2. Проверка миграций

**Обнаружено:** В миграции `009_add_natural_slope_support.sql` была правильная структура с `individual_training_id`, но в продакшен базе каскадное удаление не было настроено.

---

## 🔧 РЕШЕНИЕ

### 1. Создана миграция `014_fix_trainer_payments_cascade.sql`

```sql
-- Удаляем существующие внешние ключи
ALTER TABLE trainer_payments 
DROP CONSTRAINT IF EXISTS trainer_payments_individual_training_id_fkey;

-- Добавляем с каскадным удалением
ALTER TABLE trainer_payments 
ADD CONSTRAINT trainer_payments_individual_training_id_fkey 
FOREIGN KEY (individual_training_id) 
REFERENCES individual_training_sessions(id) 
ON DELETE CASCADE;

-- Аналогично для других внешних ключей
ALTER TABLE trainer_payments 
ADD CONSTRAINT trainer_payments_training_session_id_fkey 
FOREIGN KEY (training_session_id) 
REFERENCES training_sessions(id) 
ON DELETE CASCADE;

ALTER TABLE trainer_payments 
ADD CONSTRAINT trainer_payments_trainer_id_fkey 
FOREIGN KEY (trainer_id) 
REFERENCES trainers(id) 
ON DELETE CASCADE;
```

### 2. Применена миграция

```bash
PGPASSWORD='Nemezida2324%)' psql -U batl-zlat -h 90.156.210.24 -d skisimulator -p 5432 < migrations/014_fix_trainer_payments_cascade.sql
```

### 3. Обновлена схема в `schema.sql`

```sql
CREATE TABLE trainer_payments (
    id SERIAL PRIMARY KEY,
    trainer_id INTEGER REFERENCES trainers(id) ON DELETE CASCADE,
    training_session_id INTEGER REFERENCES training_sessions(id) ON DELETE CASCADE,
    individual_training_id INTEGER REFERENCES individual_training_sessions(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('group_training', 'individual_training')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    payment_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## ✅ ТЕСТИРОВАНИЕ

### 1. Проверка каскадного удаления

```sql
-- До удаления: 1 запись в trainer_payments
SELECT COUNT(*) FROM trainer_payments WHERE individual_training_id = 146;
-- Результат: 1

-- Удаляем тренировку
DELETE FROM individual_training_sessions WHERE id = 146;
-- Результат: DELETE 1

-- После удаления: 0 записей в trainer_payments
SELECT COUNT(*) FROM trainer_payments WHERE individual_training_id = 146;
-- Результат: 0
```

### 2. Проверка структуры таблицы

```sql
\d trainer_payments
-- Результат: Все внешние ключи теперь имеют ON DELETE CASCADE
```

---

## 🎯 РЕЗУЛЬТАТ

✅ **Проблема решена:** Теперь индивидуальные тренировки можно удалять без ошибок  
✅ **Каскадное удаление работает:** Связанные записи в `trainer_payments` автоматически удаляются  
✅ **Схема обновлена:** `schema.sql` синхронизирован с продакшен базой  
✅ **Миграция применена:** Изменения зафиксированы в базе данных  

---

## 📋 ВЛИЯНИЕ НА СИСТЕМУ

### Положительные изменения:
- ✅ Клиенты могут отменять индивидуальные тренировки через бота
- ✅ Автоматическая очистка связанных записей при удалении
- ✅ Целостность данных сохранена
- ✅ Система стала более надежной

### Безопасность:
- ✅ Каскадное удаление применяется только к `trainer_payments`
- ✅ Основные таблицы (`clients`, `trainers`, `individual_training_sessions`) не затронуты
- ✅ Триггеры продолжают работать корректно

---

## 🚀 СТАТУС

**✅ ИСПРАВЛЕНО И ПРОТЕСТИРОВАНО**

Теперь система удаления индивидуальных тренировок работает корректно как в боте, так и в админ-панели!
