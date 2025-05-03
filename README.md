# Ski-instruktor - Система управления горнолыжными тренажерами

## Описание проекта
Ski-instruktor - это комплексная система для управления горнолыжными тренажерами и бронирования тренировок. Система включает в себя веб-интерфейс для администраторов и Telegram бота для клиентов.

## Основные функции

### Telegram бот (@Ski_Instruktor72_bot)
- Регистрация новых клиентов
- Бронирование тренировок
- Управление личным кабинетом
- Просмотр и управление записями
- Управление кошельком
- Работа с подарочными сертификатами

### Веб-интерфейс (админ-панель)
- Управление тренажерами
- Управление тренерами
- Управление группами
- Управление расписанием
- Управление ценами
- Просмотр статистики

## Установка и запуск

### Требования
- Node.js 14+
- PostgreSQL 12+
- Telegram Bot Token

### Установка зависимостей
```bash
npm install
```

### Настройка окружения
Создайте файл `.env` в корневой директории проекта:
```env
# Настройки базы данных
DB_HOST=your_host
DB_PORT=5432
DB_NAME=skisimulator
DB_USER=your_user
DB_PASSWORD=your_password

# Настройки сервера
PORT=3000

# Токен Telegram бота
TELEGRAM_BOT_TOKEN=your_bot_token
```

### Инициализация базы данных
```bash
npm run init-db
```

### Запуск сервера
```bash
npm run start
```

## Структура базы данных

### Таблица clients
```sql
CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    birth_date DATE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 5),
    telegram_id VARCHAR(100) UNIQUE,
    telegram_username VARCHAR(100),
    nickname VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Таблица children
```sql
CREATE TABLE children (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    birth_date DATE NOT NULL,
    sport_type VARCHAR(20),
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Таблица wallets
```sql
CREATE TABLE wallets (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    balance DECIMAL(10,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### Клиенты
- `GET /api/clients` - получение списка клиентов
- `POST /api/clients` - создание нового клиента
- `GET /api/clients/:id` - получение информации о клиенте
- `PUT /api/clients/:id` - обновление информации о клиенте

### Тренажеры
- `GET /api/simulators` - получение списка тренажеров
- `POST /api/simulators` - создание нового тренажера
- `PUT /api/simulators/:id` - обновление информации о тренажере

### Расписание
- `GET /api/schedule` - получение расписания
- `POST /api/schedule` - создание записи в расписании
- `PUT /api/schedule/:id` - обновление записи в расписании

## Разработка

### Структура проекта
```
src/
├── app.js              # Основной файл приложения
├── bot/               # Код Telegram бота
│   ├── index.js       # Основной файл бота
│   ├── handlers.js    # Обработчики команд
│   └── db-utils.js    # Утилиты для работы с БД
├── routes/            # Маршруты API
├── db/               # Настройки базы данных
└── scripts/          # Скрипты для инициализации
```

### Запуск в режиме разработки
```bash
npm run dev
```

## Лицензия
ISC 