# 🚀 Запуск проекта Горностайл72

## Разработка
```bash
npm run dev
```
Запускает приложение с nodemon на порту из .env (8080)

## Продакшн (PM2)
```bash
# Первый запуск
npm run pm2:start

# Перезапуск 
npm run pm2:restart
# или напрямую
pm2 restart gornostyle

# Логи
npm run pm2:logs

# Остановка
npm run pm2:stop
```

## Инициализация БД
```bash
npm run init-db
npm run migrate
```

---
**Важно:** Все настройки берутся из `.env` файла. Никаких дополнительных изменений в коде не требуется. 