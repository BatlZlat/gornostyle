# Проект Ski-instruktor

## Текущий статус
- Выполнен переход с модальных окон на отдельные страницы
- Созданы базовые страницы для всех основных функций
- Реализованы основные JavaScript обработчики
- **НОВОЕ**: Обнаружены критические ошибки в боте при отправке заявок на тренировки

## Background and Motivation

Обнаружены следующие проблемы в боте при работе с заявками на тренировки:

1. **Ошибка формата даты**: PostgreSQL не принимает дату в формате "18.06.2025" - возникает ошибка "date/time field value out of range"
2. **Неправильная логика выбора "для себя и ребенка"**: Показывается меню с пунктом "Для себя", который не нужен в данном контексте
3. **Отображение даты как NaN**: В предварительном просмотре заявки дата отображается как "NaN.NaN.NaN"

## Key Challenges and Analysis

### Проблема 1: Формат даты
- PostgreSQL ожидает дату в формате YYYY-MM-DD или ISO 8601
- Бот передает дату в формате DD.MM.YYYY
- Нужно преобразовать формат даты перед отправкой в БД

### Проблема 2: Логика выбора участников
- При выборе "для себя и ребенка" показывается неправильное меню
- Нужно создать отдельный обработчик для выбора ребенка
- Использовать существующую функцию для отображения списка детей

### Проблема 3: Отображение даты в предпросмотре
- Функция форматирования даты возвращает NaN
- Нужно исправить функцию `formatDate` или логику обработки даты

## High-level Task Breakdown

### Задача 1: Исправить формат даты при сохранении в БД
- **Цель**: Преобразовать дату из DD.MM.YYYY в YYYY-MM-DD перед отправкой в PostgreSQL
- **Критерии успеха**: Заявки успешно сохраняются в БД без ошибок формата даты
- **Файлы для изменения**: `src/bot/client-bot.js` (функция сохранения заявки)

### Задача 2: Исправить логику выбора "для себя и ребенка"
- **Цель**: Создать правильный обработчик для выбора ребенка при опции "для себя и ребенка"
- **Критерии успеха**: При выборе "для себя и ребенка" показывается только список детей без пункта "Для себя"
- **Файлы для изменения**: `src/bot/client-bot.js` (обработчик выбора участников)

### Задача 3: Исправить отображение даты в предпросмотре
- **Цель**: Правильно отображать дату в формате DD.MM.YYYY в предварительном просмотре заявки
- **Критерии успеха**: Дата корректно отображается в предпросмотре заявки
- **Файлы для изменения**: `src/bot/client-bot.js` (функция `formatDate` и логика предпросмотра)

### Задача 4: Протестировать исправления
- **Цель**: Убедиться, что все исправления работают корректно
- **Критерии успеха**: Заявки создаются без ошибок, даты отображаются правильно, логика выбора работает корректно

## Project Status Board

- [x] Задача 1: Исправить формат даты при сохранении в БД
- [x] Задача 2: Исправить логику выбора "для себя и ребенка"
- [x] Задача 3: Исправить отображение даты в предпросмотре
- [ ] Задача 4: Протестировать исправления

## Current Status / Progress Tracking

**Текущий статус**: Исправления выполнены, готов к тестированию

**Последние изменения**: 
- ✅ Исправлена функция `validateDate` для правильного преобразования даты в формат YYYY-MM-DD
- ✅ Исправлена логика выбора "для себя и ребенка" - убран лишний пункт "Для себя"
- ✅ Исправлена функция `formatDate` для корректного отображения дат
- ✅ Исправлено отображение даты в предпросмотре заявки
- ✅ Добавлено сохранение даты в двух форматах: для БД и для отображения

## Executor's Feedback or Assistance Requests

**Готово к тестированию**: Все основные проблемы исправлены. Нужно протестировать функциональность.

## Lessons

- PostgreSQL строго требует определенный формат даты
- При работе с датами в боте нужно всегда преобразовывать их в правильный формат для БД
- Логика выбора участников должна быть продумана заранее
- Важно сохранять данные в разных форматах для разных целей (БД vs отображение)

## Анализ структуры данных

### Тренеры (trainers)
```sql
CREATE TABLE trainers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL,
    sport_type VARCHAR(100) NOT NULL,
    experience INTEGER NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    dismissed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Группы (groups)
```sql
CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Тренировки (trainings)
```sql
CREATE TABLE trainings (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    group_id INTEGER REFERENCES groups(id),
    trainer_id INTEGER REFERENCES trainers(id),
    simulator_id INTEGER NOT NULL,
    max_participants INTEGER NOT NULL,
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 5),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Участники тренировок (training_participants)
```sql
CREATE TABLE training_participants (
    id SERIAL PRIMARY KEY,
    training_id INTEGER REFERENCES trainings(id),
    client_id INTEGER REFERENCES clients(id),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Клиенты (clients)
```sql
CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    birth_date DATE,
    has_child BOOLEAN DEFAULT false,
    child_name VARCHAR(255),
    child_birth_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Платежи (payments)
```sql
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    payment_link VARCHAR(255),
    expires_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',
    client_id INTEGER REFERENCES clients(id),
    training_id INTEGER REFERENCES trainings(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Расписание (schedules)
```sql
CREATE TABLE schedules (
    id SERIAL PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    weekdays INTEGER[] NOT NULL,
    simulator_id INTEGER NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    auto_schedule BOOLEAN DEFAULT false,
    auto_schedule_day INTEGER,
    auto_schedule_time TIME,
    timezone VARCHAR(50) DEFAULT 'Asia/Yekaterinburg',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Необходимые доработки

### 1. Система уведомлений
- Добавить таблицу для уведомлений
```sql
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    user_type VARCHAR(20) NOT NULL, -- client/trainer/admin
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL, -- info/warning/error
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2. Система сертификатов
- Добавить таблицу для сертификатов
```sql
CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    certificate_number VARCHAR(50) UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    client_id INTEGER REFERENCES clients(id),
    expiry_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP
);
```

### 3. Доработка страниц

#### Страница тренеров
- Добавить фильтрацию по статусу (активные/уволенные)
  ```javascript
  // Пример реализации фильтрации
  const filterTrainers = (status) => {
    const url = new URL('/api/trainers');
    url.searchParams.append('status', status);
    return fetch(url).then(res => res.json());
  };
  ```
- Добавить поиск по имени
  ```javascript
  // Пример реализации поиска
  const searchTrainers = (query) => {
    const url = new URL('/api/trainers/search');
    url.searchParams.append('q', query);
    return fetch(url).then(res => res.json());
  };
  ```
- Добавить сортировку по опыту работы
  ```javascript
  // Пример реализации сортировки
  const sortTrainers = (field, order) => {
    const url = new URL('/api/trainers');
    url.searchParams.append('sort', field);
    url.searchParams.append('order', order);
    return fetch(url).then(res => res.json());
  };
  ```

#### Страница клиентов
- Добавить фильтрацию по возрасту
  ```sql
  -- SQL для фильтрации по возрасту
  SELECT * FROM clients 
  WHERE EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) BETWEEN $1 AND $2;
  ```
- Добавить поиск по имени и телефону
  ```sql
  -- SQL для поиска
  SELECT * FROM clients 
  WHERE full_name ILIKE $1 OR phone LIKE $2;
  ```
- Добавить историю тренировок клиента
  ```sql
  -- SQL для истории тренировок
  SELECT t.*, tp.status
  FROM trainings t
  JOIN training_participants tp ON t.id = tp.training_id
  WHERE tp.client_id = $1
  ORDER BY t.date DESC, t.start_time DESC;
  ```

#### Страница расписания
- Добавить календарь на месяц
  ```javascript
  // Пример компонента календаря
  const Calendar = {
    init() {
      this.loadMonthData();
      this.bindEvents();
    },
    
    async loadMonthData(year, month) {
      const url = new URL('/api/schedule/month');
      url.searchParams.append('year', year);
      url.searchParams.append('month', month);
      const data = await fetch(url).then(res => res.json());
      this.renderCalendar(data);
    }
  };
  ```
- Добавить фильтрацию по тренажерам
  ```javascript
  // Пример фильтрации по тренажерам
  const filterBySimulator = (simulatorId) => {
    const url = new URL('/api/schedule/simulator');
    url.searchParams.append('simulator_id', simulatorId);
    return fetch(url).then(res => res.json());
  };
  ```
- Добавить статистику загруженности
  ```sql
  -- SQL для статистики загруженности
  SELECT 
    date,
    COUNT(*) as total_trainings,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    AVG(participants_count::float / max_participants) as occupancy_rate
  FROM trainings
  WHERE date BETWEEN $1 AND $2
  GROUP BY date
  ORDER BY date;
  ```

#### Страница финансов
- Добавить фильтрацию по периоду
  ```sql
  -- SQL для фильтрации платежей по периоду
  SELECT * FROM payments
  WHERE created_at BETWEEN $1 AND $2;
  ```
- Добавить статистику по типам оплат
  ```sql
  -- SQL для статистики платежей
  SELECT 
    DATE_TRUNC('month', created_at) as month,
    COUNT(*) as total_payments,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount
  FROM payments
  WHERE created_at BETWEEN $1 AND $2
  GROUP BY DATE_TRUNC('month', created_at)
  ORDER BY month;
  ```
- Добавить экспорт в Excel
  ```javascript
  // Пример функции экспорта
  const exportToExcel = async (filters) => {
    const response = await fetch('/api/finance/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(filters)
    });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'finance-report.xlsx';
    a.click();
  };
  ```

## План следующих действий

1. Создание системы уведомлений
   - Создать таблицу notifications
   - Разработать API для работы с уведомлениями
   - Интегрировать уведомления в интерфейс

2. Разработка системы сертификатов
   - Создать таблицу certificates
   - Разработать интерфейс управления сертификатами
   - Интегрировать сертификаты в систему оплаты

3. Улучшение пользовательского интерфейса
   - Добавить фильтры и поиск на все основные страницы
   - Улучшить отображение статистики
   - Добавить интерактивный календарь

4. Оптимизация производительности
   - Добавить индексы в базу данных
   - Оптимизировать запросы
   - Реализовать кэширование данных

5. Тестирование
   - Написать unit-тесты
   - Провести нагрузочное тестирование
   - Проверить безопасность

## Текущие проблемы и риски

1. Безопасность
   - Необходимо реализовать систему ролей и прав доступа
   - Добавить защиту от SQL-инъекций
   - Реализовать логирование действий пользователей

2. Масштабируемость
   - Подготовить систему к увеличению нагрузки
   - Оптимизировать работу с базой данных
   - Реализовать систему кэширования

3. Интеграция
   - Необходимо интегрировать платежную систему
   - Добавить интеграцию с календарями (Google Calendar, iCal)
   - Реализовать API для мобильного приложения

# Ski-instruktor - Система управления горнолыжными тренажерами

## Функциональность

### Управление группами
- Создание новых групп с названием и описанием
- Просмотр списка всех групп
- Редактирование существующих групп
- Удаление групп
- Интеграция с системой создания тренировок

#### Страницы
1. **Управление группами** (`groups.html`)
   - Список всех групп с названием и описанием
   - Кнопка создания новой группы
   - Возможность редактирования и удаления групп
   - Навигация к админ-панели

2. **Создание/редактирование группы** (`create-group.html`)
   - Форма для ввода названия и описания группы
   - Валидация обязательных полей
   - Возврат к списку групп

#### API Endpoints
- `GET /api/groups` - получение списка всех групп
- `POST /api/groups` - создание новой группы
- `GET /api/groups/:id` - получение группы по ID
- `PUT /api/groups/:id` - обновление группы
- `DELETE /api/groups/:id` - удаление группы

#### База данных
Таблица `groups`:
- `id` (SERIAL PRIMARY KEY)
- `name` (VARCHAR(100) NOT NULL)
- `description` (TEXT)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

# План интеграции Telegram бота с системой бронирования

## Фон и мотивация
Необходимо создать Telegram бота для удобного управления бронированиями и личным кабинетом клиентов. Бот должен интегрироваться с существующей системой бронирования и предоставлять пользователям удобный интерфейс для управления своими записями.

## Ключевые задачи и анализ
1. Интеграция с существующей базой данных
   - Использование существующих таблиц clients, children, wallets
   - Добавление новых полей для Telegram (telegram_id, username, nickname)
   - Создание уникальных номеров кошельков

2. Разработка пользовательского интерфейса бота
   - Создание интуитивно понятного меню
   - Реализация процесса регистрации
   - Разработка системы управления бронированиями

3. Интеграция с существующим API
   - Использование существующих эндпоинтов для бронирований
   - Создание новых эндпоинтов для работы с Telegram

## Разбивка задач

### 1. Настройка проекта и базы данных
- [ ] Создать новый файл `src/bot/index.js` для основного кода бота
- [ ] Установить необходимые зависимости (node-telegram-bot-api, dotenv)
- [ ] Создать конфигурационный файл для бота
- [ ] Добавить новые поля в таблицу clients для Telegram данных
- [ ] Создать функцию генерации уникальных номеров кошельков

### 2. Разработка базовой структуры бота
- [ ] Реализовать обработку команды /start
- [ ] Создать систему регистрации новых пользователей
- [ ] Разработать основное меню бота
- [ ] Реализовать обработку callback-запросов

### 3. Регистрация и авторизация
- [ ] Создать пошаговую форму регистрации
- [ ] Реализовать валидацию введенных данных
- [ ] Добавить обработку данных ребенка
- [ ] Реализовать сохранение Telegram данных

### 4. Основной функционал
- [ ] Реализовать раздел "Записаться на тренировку"
- [ ] Разработать просмотр существующих записей
- [ ] Создать раздел "Личная информация"
- [ ] Реализовать функционал подарочных сертификатов
- [ ] Разработать систему управления кошельком

### 5. Интеграция с API
- [ ] Создать новые эндпоинты для работы с Telegram
- [ ] Интегрировать существующие эндпоинты бронирования
- [ ] Реализовать обработку ошибок и уведомлений

## Текущий статус
- Начальная стадия планирования
- Анализ существующей структуры проекта
- Определение необходимых изменений в базе данных

## Обратная связь и запросы на помощь
- Требуется подтверждение структуры базы данных
- Необходимо уточнить формат номеров кошельков
- Требуется информация о существующих API эндпоинтах

## Уроки
- Пока нет

## Следующие шаги
1. Создать базовую структуру проекта для бота
2. Настроить подключение к базе данных
3. Реализовать базовый функционал регистрации

# План реализации: Автоматическая обработка СМС-уведомлений о пополнении кошелька

## Фон и мотивация
Необходимо исправить текущие проблемы с обработкой СМС-уведомлений о пополнении кошельков через СБП. Система перестала корректно обрабатывать новые форматы СМС от разных банков, что привело к непоступлению средств на кошельки клиентов.

## Ключевые задачи и анализ
1. Анализ текущих проблем:
   - Ошибка 401 (Unauthorized) при отправке СМС от MacroDroid
   - Несоответствие форматов СМС от разных банков
   - Проблемы с подключением к серверу (SocketTimeoutException)
   - Отсутствие подробного логирования для диагностики

2. Необходимые изменения:
   - Обновление парсера для поддержки новых форматов СМС
   - Исправление проблем с аутентификацией
   - Улучшение обработки ошибок и логирования
   - Оптимизация работы с базой данных

## Форматы СМС (текущие)
1. Альфабанк:
```
СЧЁТ3009 04.06.25 зачислен перевод по СБП 10р из Альфа-Банк от МАРАТ АШРАТОВИЧ М. Сообщение: 5722-3651-4275-8011
```

2. ВТБ:
```
СЧЁТ3009 17:57 Перевод из ВТБ +10р от ДАНИЛА Т. «0663-3723-7335-9647»
```

3. Другие банки:
```
СЧЁТ3009 18:27 Перевод 10р от Марина Т. «4779-4841-5840-9362»
```

## Разбивка задач

### 1. Исправление проблем с подключением
- [ ] Проверить настройки аутентификации в MacroDroid
- [ ] Обновить конфигурацию сервера для корректной обработки запросов
- [ ] Добавить проверку доступности сервера
- [ ] Реализовать механизм повторных попыток при ошибках подключения

### 2. Обновление парсера СМС
- [ ] Создать таблицу для логирования СМС:
  ```sql
  CREATE TABLE IF NOT EXISTS sms_log (
      id SERIAL PRIMARY KEY,
      sms_text TEXT NOT NULL,
      parsed_data JSONB,
      error_type VARCHAR(50),
      error_details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP,
      processing_status VARCHAR(20) DEFAULT 'pending'
  );
  
  -- Индексы для оптимизации запросов
  CREATE INDEX IF NOT EXISTS idx_sms_log_created_at ON sms_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_sms_log_processing_status ON sms_log(processing_status);
  
  ```
- [ ] Создать универсальную функцию парсинга
  ```javascript
  function parseSmsUniversal(text) {
      // Нормализация текста
      const normalizedText = text
          .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ') // Замена всех видов пробелов
          .replace(/["'«»]/g, '"') // Нормализация кавычек
          .replace(/\s+/g, ' ') // Нормализация пробелов
          .trim();

      // Поиск суммы (основной приоритет)
      const amountPatterns = [
          // Основной паттерн - число перед буквой р (русской или английской)
          // Поддерживает числа с пробелами как разделителями тысяч
          /(\+?(?:\d{1,3}(?:\s\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?))\s*[рp](?:\.|\b)/i,
          // Дополнительные паттерны (на всякий случай)
          /(\+?(?:\d{1,3}(?:\s\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?))\s*(?:руб|рубль|рублей|₽)/i
      ];

      // Поиск номера кошелька
      const walletPatterns = [
          // После ключевых слов
          /(?:сообщение|номер|кошелек|счет|карта|перевод)[:]\s*([\d\-]{16,23})/i,
          // В кавычках
          /["]([\d\-]{16,23})["]/,
          // Просто последовательность цифр с разделителями
          /(\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4})/,
          // Любая последовательность из 16+ цифр
          /(\d{16,})/
      ];

      // Поиск суммы (основной приоритет)
      let amount = null;
      for (const pattern of amountPatterns) {
          const match = normalizedText.match(pattern);
          if (match) {
              // Нормализация числа (удаляем пробелы и заменяем запятую на точку)
              amount = parseFloat(match[1].replace(/\s/g, '').replace(',', '.').replace('+', ''));
              if (!isNaN(amount)) {
                  break;
              }
          }
      }

      // Поиск номера кошелька
      let walletNumber = null;
      for (const pattern of walletPatterns) {
          const match = normalizedText.match(pattern);
          if (match) {
              // Очистка номера от всех нецифровых символов
              walletNumber = match[1].replace(/[^\d]/g, '');
              // Проверка длины номера
              if (walletNumber.length >= 16) {
                  walletNumber = walletNumber.slice(0, 16); // Берем только первые 16 цифр
                  break;
              }
          }
      }

      // Логирование процесса парсинга
      console.log('Парсинг СМС:', {
          original_text: text,
          normalized_text: normalizedText,
          found_amount: amount,
          found_wallet: walletNumber,
          timestamp: new Date().toISOString()
      });

      // Валидация результатов
      if (!amount) {
          console.log('Не удалось найти сумму в СМС:', {
              text: normalizedText,
              error: 'Сумма не найдена'
          });
          return null;
      }

      if (!walletNumber) {
          console.log('Не удалось найти номер кошелька в СМС:', {
              text: normalizedText,
              error: 'Номер кошелька не найден'
          });
          return null;
      }

      return {
          amount,
          walletNumber,
          originalText: text,
          parsedAt: new Date().toISOString()
      };
  }

  // Функция для тестирования парсера
  function testSmsParser() {
      const testCases = [
          // Текущие форматы
          'СЧЁТ3009 04.06.25 зачислен перевод по СБП 10р из Альфа-Банк от МАРАТ АШРАТОВИЧ М. Сообщение: 5722-3651-4275-8011',
          'СЧЁТ3009 17:57 Перевод из ВТБ +10р от ДАНИЛА Т. «0663-3723-7335-9647»',
          'СЧЁТ3009 18:27 Перевод 10р от Марина Т. «4779-4841-5840-9362»',
          
          // Тесты сумм с разными форматами буквы "р"
          'Перевод 1000р на кошелек 1234-5678-9012-3456',
          'Перевод 1000p на кошелек 1234-5678-9012-3456',
          'Перевод 1000р. на кошелек 1234-5678-9012-3456',
          'Перевод 1000p. на кошелек 1234-5678-9012-3456',
          'Перевод +1000р на кошелек 1234-5678-9012-3456',
          'Перевод 1000.00р на кошелек 1234-5678-9012-3456',
          'Перевод 1000,00р на кошелек 1234-5678-9012-3456',
          
          // Тесты с числами, содержащими пробелы
          'СЧЁТ3009 07:20 Перевод 10 000р от Марина Т.',
          'Перевод 1 000 000р на кошелек 1234-5678-9012-3456',
          'Перевод +10 000.50р на кошелек 1234-5678-9012-3456',
          'Перевод 1 234 567,89р на кошелек 1234-5678-9012-3456',
          
          // Тесты с дополнительными форматами (на всякий случай)
          'Перевод 1000 руб на кошелек 1234-5678-9012-3456',
          'Перевод 1000 рублей на кошелек 1234-5678-9012-3456',
          'Перевод 1000₽ на кошелек 1234-5678-9012-3456',
          
          // Некорректные форматы
          'Перевод выполнен успешно', // Нет суммы и номера
          'Пополнение на кошелек 1234-5678-9012-3456', // Нет суммы
          'Перевод 1000 на кошелек 1234-5678-9012-3456', // Нет буквы "р"
          'Перевод р1000 на кошелек 1234-5678-9012-3456', // Буква "р" перед суммой
          'Перевод на сумму 1000р на номер 1234-5678-9012-3456-7890' // Номер длиннее 16 цифр
      ];

      console.log('Тестирование парсера СМС:');
      testCases.forEach((sms, index) => {
          console.log(`\nТест #${index + 1}:`);
          console.log('СМС:', sms);
          const result = parseSmsUniversal(sms);
          console.log('Результат:', result);
      });
  }
  ```
- [ ] Добавить сохранение необработанных СМС в базу данных:
  ```sql
  CREATE TABLE IF NOT EXISTS sms_log (
      id SERIAL PRIMARY KEY,
      sms_text TEXT NOT NULL,
      parsed_data JSONB,
      error_type VARCHAR(50),
      error_details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP,
      processing_status VARCHAR(20) DEFAULT 'pending'
  );
  ```
- [ ] Реализовать периодический анализ необработанных СМС для выявления новых форматов
- [ ] Добавить уведомления администратору о новых форматах СМС

### 3. Улучшение обработки ошибок
- [ ] Добавить детальное логирование:
  ```javascript
  console.log('Входящее СМС:', {
      raw_text: sms_text,
      normalized_text: normalizedText,
      parsed_data: parsed,
      timestamp: new Date().toISOString()
  });
  ```
- [ ] Реализовать сохранение необработанных СМС:
  ```sql
  CREATE TABLE IF NOT EXISTS unprocessed_sms (
      id SERIAL PRIMARY KEY,
      sms_text TEXT NOT NULL,
      error_type VARCHAR(50),
      error_details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```
- [ ] Добавить уведомления администратору о проблемах с обработкой

### 4. Оптимизация работы с базой данных
- [ ] Добавить индексы для оптимизации запросов:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_wallets_wallet_number ON wallets(wallet_number);
  CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON transactions(wallet_id);
  ```
- [ ] Реализовать транзакционную обработку операций
- [ ] Добавить кэширование часто используемых данных

### 5. Обновление MacroDroid
- [ ] Проверить и обновить настройки HTTP-запроса:
  ```
  POST /api/sms/process
  Content-Type: application/json
  Authorization: Bearer {token}
  
  {
      "sms_text": "{текст_смс}"
  }
  ```
- [ ] Добавить обработку ошибок и повторные попытки
- [ ] Реализовать уведомления о проблемах с отправкой

## Критерии успеха
1. Система корректно обрабатывает все форматы СМС
2. Решены проблемы с аутентификацией (ошибка 401)
3. Устранены проблемы с подключением
4. Реализовано подробное логирование
5. Оптимизирована работа с базой данных
6. Администратор получает уведомления о проблемах

## Текущий статус / Отслеживание прогресса
- [ ] Начало работы над исправлениями
- [ ] Выявлены проблемы с аутентификацией и форматами СМС
- [ ] Подготовлен план обновления парсера

## Обратная связь или запросы на помощь
- Требуется подтверждение новых форматов СМС
- Необходимо уточнить настройки аутентификации в MacroDroid
- Нужно проверить доступность сервера

## Уроки
- Важно регулярно проверять поддержку новых форматов СМС
- Необходимо реализовать подробное логирование для быстрой диагностики проблем
- Следует добавить механизм уведомлений о проблемах с обработкой

## Рекомендации по хранению бэкапов

## Процесс релиза

### Чек-лист перед релизом
1. Тестирование
   - [ ] Все тесты проходят успешно
   - [ ] Проверена работа всех основных функций
   - [ ] Проверена работа системы бэкапов
   - [ ] Проверена работа восстановления из бэкапа

2. Документация
   - [ ] README.md обновлен
   - [ ] Документация по API актуальна
   - [ ] Документация по развертыванию актуальна
   - [ ] Документация по бэкапам актуальна

3. Безопасность
   - [ ] Проверены права доступа
   - [ ] Проверены переменные окружения
   - [ ] Проверены настройки бэкапов
   - [ ] Проверены настройки базы данных

4. Производительность
   - [ ] Проверена скорость загрузки страниц
   - [ ] Проверена работа с базой данных
   - [ ] Проверена работа системы бэкапов

### Процесс создания релиза
1. Подготовка
   - Переключиться на ветку develop
   - Убедиться, что все изменения закоммичены
   - Проверить чек-лист перед релизом

2. Создание релиза
   - Создать тег с версией (например, v1.0.0)
   - Добавить описание изменений
   - Отправить тег в удаленный репозиторий

3. Развертывание
   - Остановить приложение
   - Создать бэкап базы данных
   - Обновить код на сервере
   - Применить миграции базы данных
   - Запустить приложение
   - Проверить работоспособность

### Процедура отката
1. Если проблемы с кодом:
   - Переключиться на предыдущий тег
   - Восстановить базу данных из бэкапа
   - Перезапустить приложение

2. Если проблемы с базой данных:
   - Остановить приложение
   - Восстановить базу из последнего рабочего бэкапа
   - Перезапустить приложение

### Текущий статус
- [x] Настроена система контроля версий
- [x] Создана ветка develop
- [x] Создан тег v1.0.0
- [ ] Настроен удаленный репозиторий
- [ ] Настроена защита ветки master
- [ ] Настроен процесс CI/CD

### Следующие шаги
1. Настроить удаленный репозиторий
2. Настроить защиту ветки master
3. Настроить автоматические тесты
4. Настроить процесс CI/CD 