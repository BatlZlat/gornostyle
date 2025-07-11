# 📊 Настройка аналитики для сайта Горностайл72

## Обзор

На сайте настроена поддержка двух систем аналитики:
- **Яндекс.Метрика** - для российских пользователей
- **Google Analytics** - для международной аудитории

## 🚀 Быстрая настройка

### 1. Яндекс.Метрика

1. Перейдите на [Яндекс.Метрика](https://metrika.yandex.ru/)
2. Создайте новый счётчик для сайта `gornostyle72.ru`
3. Скопируйте ID счётчика (например: `12345678`)
4. Добавьте в файл `.env`:
   ```
   YANDEX_METRIKA_ID=12345678
   ```

### 2. Google Analytics

1. Перейдите на [Google Analytics](https://analytics.google.com/)
2. Создайте новое свойство для сайта `gornostyle72.ru`
3. Скопируйте ID измерения (например: `G-XXXXXXXXXX`)
4. Добавьте в файл `.env`:
   ```
   GOOGLE_ANALYTICS_ID=G-XXXXXXXXXX
   ```

## 📋 Что отслеживается

### Яндекс.Метрика
- ✅ Посещения страниц
- ✅ Клики по ссылкам
- ✅ Точные отказы
- ✅ Вебвизор (запись действий пользователей)
- ✅ Карта кликов

### Google Analytics
- ✅ Посещения страниц
- ✅ Источники трафика
- ✅ Поведение пользователей
- ✅ Демографические данные
- ✅ Устройства и браузеры

## 🔧 Проверка настроек

Запустите скрипт проверки:
```bash
node scripts/check-analytics.js
```

## 📈 Полезные метрики для горнолыжного клуба

### Ключевые показатели
- **Посещения страницы цен** - интерес к услугам
- **Клики по контактам** - готовность к действию
- **Время на сайте** - вовлечённость
- **Источники трафика** - эффективность рекламы

### Рекомендуемые цели
1. **Заявки через Telegram** - отслеживание переходов в бот
2. **Звонки** - клики по номеру телефона
3. **Просмотр цен** - посещение страницы /prices
4. **Просмотр расписания** - посещение страницы /schedule

## 🛠️ Техническая информация

### Файлы
- `views/partials/analytics.ejs` - шаблон аналитики
- `src/app.js` - передача переменных в шаблоны
- `.env` - настройки ID счётчиков

### Подключение
Аналитика автоматически подключается ко всем страницам:
- Главная страница (`/`)
- Цены (`/prices`)
- Расписание (`/schedule`)

### Безопасность
- Аналитика загружается асинхронно
- Поддержка блокировщиков рекламы
- Соответствие GDPR (базовая настройка)

## 🔍 Отладка

### Проверка загрузки
1. Откройте инструменты разработчика (F12)
2. Перейдите на вкладку "Network"
3. Обновите страницу
4. Найдите запросы к `mc.yandex.ru` и `googletagmanager.com`

### Проверка данных
- **Яндекс.Метрика**: данные появляются через 2-3 часа
- **Google Analytics**: данные появляются через 24-48 часов

## 📞 Поддержка

При проблемах с настройкой:
1. Проверьте правильность ID счётчиков
2. Убедитесь, что файл `.env` обновлён
3. Перезапустите сервер после изменений
4. Очистите кэш браузера

## 🔗 Полезные ссылки

- [Яндекс.Метрика](https://metrika.yandex.ru/)
- [Google Analytics](https://analytics.google.com/)
- [Документация Яндекс.Метрики](https://yandex.ru/support/metrica/)
- [Документация Google Analytics](https://support.google.com/analytics/) 