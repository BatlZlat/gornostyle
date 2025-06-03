# Проект Ski-instruktor

## Текущий статус
- Выполнен переход с модальных окон на отдельные страницы
- Созданы базовые страницы для всех основных функций
- Реализованы основные JavaScript обработчики

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
Необходимо автоматизировать процесс обработки СМС-уведомлений о пополнении кошельков через СБП. Это позволит:
- Автоматически зачислять средства на кошельки клиентов
- Вести учет транзакций
- Уведомлять администратора о пополнениях

## Ключевые задачи и анализ
1. Парсинг СМС от разных банков
2. Извлечение номера кошелька и суммы
3. Обновление баланса в базе данных
4. Создание записи о транзакции
5. Отправка уведомления администратору

## Форматы СМС
1. Сбербанк:
```
СЧЁТ3009 21:17 Перевод 10р от Марина Т. «4779-4841-5840-9362»
```

2. Другие банки:
```
СЧЁТ3009 21:51 Перевод из Т‑Банк +10р от МАРИНА Т. «4779-4841-5840-9362»
СЧЁТ3009 22:14 Перевод из ВТБ +10р от ДАНИЛА Т. «0743-5806-9762-1296»
```

3. Альфабанк (новый формат, поддержка добавлена):
```
СЧЁТ3009 25.05.25 зачислен перевод по СБП 10р из Альфа-Банк от МАРАТ АШРАТОВИЧ М. Сообщение: 4857-4961-3108-9823.
```

## Разбивка задач

### 1. Создание API эндпоинта для обработки СМС
- [ ] Создать новый маршрут `/api/sms/process`
- [ ] Реализовать валидацию входящих данных
- [ ] Добавить обработку ошибок:
  - Если кошелек не найден:
    ```
    ❌ Платеж не обработан
    
    💵 Сумма: {amount} руб.
    📝 Номер кошелька: {wallet_number}
    📅 Дата: {date}
    ⏰ Время: {time}
    
    ⚠️ Автор платежа не найден. Деньги не зачислены.
    ```
    - Сохранить информацию в таблицу failed_payments:
    ```sql
    INSERT INTO failed_payments (
        amount, 
        wallet_number, 
        sms_text, 
        error_type
    ) VALUES (
        $1, 
        $2, 
        $3, 
        'wallet_not_found'
    );
    ```
  - Если формат СМС не соответствует ожидаемому - игнорировать
  - Если регулярное выражение не находит совпадений - игнорировать

### 2. Реализация парсинга СМС
- [x] Добавлена поддержка формата Альфабанка: номер кошелька ищется после 'Сообщение:'
- [ ] Создать функцию для извлечения суммы:
  - Найти число перед "р"
  - Удалить "+" если есть
- [ ] Реализовать тесты для разных форматов

### 3. Обновление базы данных
- [ ] Создать функцию для обновления баланса кошелька:
  ```sql
  WITH wallet_update AS (
    UPDATE wallets 
    SET balance = balance + $1,
        last_updated = CURRENT_TIMESTAMP
    WHERE wallet_number = $2
    RETURNING client_id, id
  )
  SELECT 
    CASE 
      WHEN client_id IS NULL THEN false
      ELSE true
    END as success,
    client_id,
    id as wallet_id
  FROM wallet_update;
  ```
- [ ] Создать функцию для добавления записи о транзакции:
  ```sql
  INSERT INTO transactions (wallet_id, amount, type, description)
  VALUES ($1, $2, 'refill', 'Пополнение через СБП');
  ```
- [ ] Реализовать транзакционную обработку

### 4. Интеграция с админ-ботом
- [ ] Добавить функцию уведомления о пополнении:
  ```
  💰 Пополнение кошелька
  
  👤 ФИО: {client_name}
  💵 Сумма: {amount} руб.
  📝 Номер кошелька: {wallet_number}
  📅 Дата: {date}
  ⏰ Время: {time}
  ```
- [ ] Добавить функцию уведомления о неудачном платеже:
  ```
  ❌ Платеж не обработан
  
  💵 Сумма: {amount} руб.
  📝 Номер кошелька: {wallet_number}
  📅 Дата: {date}
  ⏰ Время: {time}
  
  ⚠️ Автор платежа не найден. Деньги не зачислены.
  ```
- [ ] Добавить обработку ошибок при отправке

### 5. Настройка MacroDroid
- [ ] Создать триггер для СМС от номера 900
- [ ] Настроить регулярное выражение для парсинга:
  ```
  СЧЁТ3009.*Перевод.*?(\d+)р.*?«(\d{4}-\d{4}-\d{4}-\d{4})»
  ```
- [ ] Настроить HTTP-запрос к API:
  ```
  POST /api/sms/process
  Content-Type: application/json
  
  {
    "amount": "10",
    "wallet_number": "4779484158409362"
  }
  ```

### 6. API для ручной обработки неудачных платежей
- [ ] Создать маршруты для работы с неудачными платежами:
  ```sql
  -- Получение списка неудачных платежей
  SELECT 
    fp.*,
    a.full_name as processed_by_name
  FROM failed_payments fp
  LEFT JOIN administrators a ON fp.processed_by = a.id
  WHERE fp.processed = false
  ORDER BY fp.created_at DESC;
  ```
- [ ] Реализовать эндпоинты:
  - `GET /api/failed-payments` - получение списка неудачных платежей
    - Параметры:
      - `page` - номер страницы
      - `limit` - количество записей на странице
      - `processed` - фильтр по статусу обработки
      - `date_from` - фильтр по дате создания
      - `date_to` - фильтр по дате создания
  - `POST /api/failed-payments/:id/process` - обработка платежа
    - Тело запроса:
      ```json
      {
        "wallet_number": "4779484158409362", // новый номер кошелька
        "admin_id": 1 // ID администратора
      }
      ```
    - Действия:
      1. Обновить баланс кошелька
      2. Создать запись о транзакции
      3. Отметить платеж как обработанный
      4. Отправить уведомление администратору об успешной обработке
  - `GET /api/failed-payments/:id` - получение деталей платежа
  - `GET /api/failed-payments/stats` - получение статистики
    - Количество неудачных платежей
    - Сумма неудачных платежей
    - Среднее время обработки
    - Количество обработанных платежей

- [ ] Добавить валидацию:
  - Проверка существования кошелька
  - Проверка прав администратора
  - Валидация формата номера кошелька

- [ ] Реализовать уведомления:
  ```
  ✅ Платеж успешно обработан
  
  💵 Сумма: {amount} руб.
  📝 Старый номер кошелька: {old_wallet_number}
  📝 Новый номер кошелька: {new_wallet_number}
  👤 Обработал: {admin_name}
  📅 Дата: {date}
  ⏰ Время: {time}
  ```

## Критерии успеха
- Система корректно обрабатывает СМС разных форматов
- Баланс кошелька обновляется автоматически
- Создаются записи о транзакциях
- Администратор получает уведомления
- Обработка происходит в реальном времени
- Неудачные платежи сохраняются для последующей обработки
- Администраторы могут просматривать и обрабатывать неудачные платежи
- Ведется статистика по неудачным платежам

## Текущий статус / Отслеживание прогресса
- [ ] Начало работы над проектом

## Обратная связь или запросы на помощь
- Требуется подтверждение формата уведомления при ошибке
- Необходимо уточнить, нужны ли дополнительные поля в статистике

## Уроки
- Пока нет 