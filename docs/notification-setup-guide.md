# Быстрая установка системы уведомлений

## Шаг 1: Применение миграции

Подключитесь к базе данных и примените миграцию:

```bash
cd /home/dan/Project/gornostyle

# Замените данные на ваши
psql -U postgres -d your_database -f migrations/012_add_notification_logs.sql
```

Или через вашу существующую систему миграций.

## Шаг 2: Проверка конфигурации

Убедитесь, что в `.env` файле присутствуют:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_TELEGRAM_ID=your_admin_telegram_id  # опционально, для отчетов
```

## Шаг 3: Тестирование (без реальной отправки)

```bash
cd /home/dan/Project/gornostyle

# Тестовый запуск (покажет, что будет отправлено, но не отправит)
node src/scripts/test-notifications.js --dry-run
```

**Что проверяет:**
- ✅ Наличие тренировок на завтра
- ✅ Группировку по клиентам
- ✅ Формат сообщений
- ✅ Telegram ID у клиентов

## Шаг 4: Тестовая отправка

Если все корректно, попробуйте реальную отправку:

```bash
# Отправит реальные уведомления на завтра
node src/scripts/test-notifications.js

# Или на конкретную дату
node src/scripts/test-notifications.js 2025-10-15
```

## Шаг 5: Перезапуск приложения

После успешного тестирования перезапустите приложение для активации планировщика:

```bash
# Если используете PM2
pm2 restart gornostyle

# Или обычный перезапуск
npm start
```

## Шаг 6: Проверка работы планировщика

Планировщик автоматически запустится и будет отправлять уведомления каждый день в **21:00** по времени Екатеринбурга.

Проверьте логи приложения:
```bash
# Если используете PM2
pm2 logs gornostyle

# Или смотрите логи напрямую
tail -f logs/combined.log
```

В логах вы должны увидеть:
```
Инициализация планировщика задач...
✓ Задача "Напоминания о тренировках" настроена на 21:00 (Екатеринбург)
Планировщик запущен. Активных задач: 1
```

## Проверка логов уведомлений

После первой отправки проверьте таблицу логов:

```sql
-- Последние отправленные уведомления
SELECT 
    sent_at,
    c.full_name,
    training_date,
    status
FROM notification_logs nl
JOIN clients c ON nl.client_id = c.id
ORDER BY sent_at DESC
LIMIT 10;
```

## Ручная отправка (если нужна)

В любое время можно запустить отправку вручную:

```bash
# Отправить напоминания на завтра
node src/scripts/send-training-reminders.js

# Отправить на конкретную дату
node src/scripts/send-training-reminders.js 2025-10-15
```

## Возможные проблемы

### 1. "Нет тренировок на указанную дату"

**Решение:** Проверьте, есть ли записи в БД:
```sql
-- Проверка групповых тренировок
SELECT * FROM training_sessions 
WHERE session_date = CURRENT_DATE + INTERVAL '1 day'
AND status = 'scheduled';

-- Проверка индивидуальных тренировок
SELECT * FROM individual_training_sessions 
WHERE preferred_date = CURRENT_DATE + INTERVAL '1 day';
```

### 2. "У клиента нет telegram_id"

**Решение:** Клиент должен зарегистрироваться через бота. Проверьте:
```sql
SELECT id, full_name, telegram_id FROM clients WHERE telegram_id IS NULL;
```

### 3. Ошибка отправки через Telegram

**Решение:**
- Проверьте токен бота в `.env`
- Убедитесь, что клиент не заблокировал бота
- Проверьте error_message в таблице notification_logs

## Мониторинг

### Статистика отправок

```sql
SELECT 
    DATE(sent_at) as date,
    COUNT(*) as total,
    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM notification_logs
WHERE notification_type = 'training_reminder'
GROUP BY DATE(sent_at)
ORDER BY date DESC
LIMIT 7;
```

### Клиенты с проблемами

```sql
SELECT 
    c.full_name,
    nl.telegram_id,
    nl.error_message,
    nl.sent_at
FROM notification_logs nl
JOIN clients c ON nl.client_id = c.id
WHERE nl.status = 'failed'
ORDER BY nl.sent_at DESC
LIMIT 10;
```

## Полная документация

Подробная документация доступна в файле: `docs/notification-system.md`

---

✅ **Система готова к работе!**

Уведомления будут отправляться автоматически каждый день в 21:00.

