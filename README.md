# Горностайл72 - Система управления горнолыжными тренажерами

Telegram-бот и веб-сайт для управления горнолыжной школой, записью на тренировки, администрированием.

## 🚀 Быстрый старт

### Предварительные требования
- Node.js (версия 16 или выше)
- PostgreSQL (версия 12 или выше)
- npm или yarn

### Установка и настройка

1. **Клонируйте репозиторий:**
   ```bash
   git clone <repository-url>
   cd gornostyle
   ```

2. **Установите зависимости:**
   ```bash
   npm install
   ```

3. **Создайте файл `.env` в корне проекта:**
   ```bash
   cp .env.example .env  # если есть пример
   # или создайте вручную
   ```

4. **Настройте переменные окружения в `.env`:**
   ```env
   # Основные настройки
   PORT=8080
   NODE_ENV=development
   
   # База данных
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=skisimulator
   DB_USER=your_username
   DB_PASSWORD=your_password
   
   # Telegram боты
   TELEGRAM_BOT_TOKEN=your_bot_token
   ADMIN_BOT_TOKEN=your_admin_bot_token
   BOT_USERNAME=your_bot_username
   TELEGRAM_GROUP=https://t.me/your_group
   
   # Администрация
   ADMIN_LOGIN_HASH=your_login_hash
   ADMIN_PASSWORD_HASH=your_password_hash
   JWT_SECRET=your_jwt_secret
   
   # Контакты
   ADMIN_PHONE=+7-xxx-xxx-xx-xx
   CONTACT_EMAIL=info@gornostyle72.ru
   ADMIN_TELEGRAM_USERNAME=@admin_username
   
   # Социальные сети
   VK_GROUP=https://vk.com/your_group
   
   # Аналитика
   YANDEX_METRIKA_ID=your_metrika_id
   GOOGLE_ANALYTICS_ID=your_ga_id
   
   # Платежи
   PAYMENT_LINK=your_payment_link
   
   # Макродроид (опционально)
   MACRODROID_TOKEN=your_macrodroid_token
   ```

5. **Инициализируйте базу данных:**
   ```bash
   npm run init-db
   ```

6. **Запустите миграции:**
   ```bash
   npm run migrate
   ```

## 🏃‍♂️ Команды запуска

### Локальная разработка

**Обычный запуск:**
```bash
npm start
```

**Режим разработки с автоперезагрузкой:**
```bash
npm run dev
```

### Продакшн (сервер)

**Запуск через PM2:**
```bash
# Установите PM2 глобально (если не установлен)
npm install -g pm2

# Запуск
npm run pm2:start

# Перезапуск
npm run pm2:restart

# Остановка
npm run pm2:stop

# Просмотр логов
npm run pm2:logs
```

**Обычный запуск на сервере:**
```bash
npm start
```

## 📋 Доступные скрипты

| Команда | Описание |
|---------|----------|
| `npm start` | Запуск приложения |
| `npm run dev` | Запуск в режиме разработки с nodemon |
| `npm run init-db` | Инициализация базы данных |
| `npm run migrate` | Запуск миграций БД |
| `npm run pm2:start` | Запуск через PM2 |
| `npm run pm2:restart` | Перезапуск через PM2 |
| `npm run pm2:stop` | Остановка через PM2 |
| `npm run pm2:logs` | Просмотр логов PM2 |

## 🌐 Доступ к приложению

После запуска приложение будет доступно по адресу:
- **Локально**: http://localhost:8080
- **Сервер**: http://your-server-ip:8080

## 📁 Структура проекта

```
gornostyle/
├── src/                    # Серверная часть
│   ├── app.js             # Основной файл приложения
│   ├── bot/               # Telegram боты
│   ├── routes/            # API маршруты
│   ├── models/            # Модели данных
│   ├── db/                # Настройки БД
│   └── scripts/           # Скрипты
├── public/                # Статические файлы
│   ├── css/              # Стили
│   ├── js/               # JavaScript
│   └── images/           # Изображения
├── views/                 # EJS шаблоны
├── docs/                  # Документация
└── scripts/               # Вспомогательные скрипты
```

## 🔧 Основные функции

- **Telegram бот**: Запись на тренировки, управление профилем
- **Веб-сайт**: Информационные страницы, админ-панель
- **Админ-панель**: Управление тренировками, клиентами, тренерами
- **Финансы**: Управление балансами, транзакциями
- **Медиа**: Загрузка и оптимизация фото/видео

## 🐛 Устранение неполадок

### Проблемы с базой данных
```bash
# Проверьте подключение к БД
npm run init-db

# Запустите миграции
npm run migrate
```

### Проблемы с портом
Если порт 8080 занят, измените `PORT` в файле `.env`:
```env
PORT=3000  # или любой другой свободный порт
```

### Проблемы с PM2
```bash
# Очистите логи PM2
pm2 flush

# Перезапустите приложение
npm run pm2:restart
```

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи: `npm run pm2:logs`
2. Убедитесь, что все переменные окружения настроены
3. Проверьте подключение к базе данных

## 📄 Лицензия

MIT License