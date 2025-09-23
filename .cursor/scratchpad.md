# Переход с SendGrid на Mailgun для отправки email

## Background and Motivation

**Проблема:** SendGrid заблокировал аккаунт (статус "under review"), письма не доставляются:
- Обработано: 2 письма
- Доставлено: 0%
- Gmail: 0% доставлено

**Решение:** Переход на Mailgun как основной сервис отправки email:
- ✅ Бесплатно: 10,000 писем/месяц
- ✅ Очень надежный (Netflix, Uber, Spotify)
- ✅ Отличная доставляемость
- ✅ Простая интеграция

## Key Challenges and Analysis

### Текущая архитектура email отправки:
1. **EmailService** - основной сервис
2. **SendGridEmailService** - интеграция с SendGrid (заблокирована)
3. **SMTP fallback** - через Nodemailer (заблокирован провайдером)

### Проблемы:
1. **SendGrid заблокирован** - письма не доставляются
2. **SMTP порты заблокированы** провайдером Timeweb
3. **Timeweb Mail платный** - 100₽/месяц за ящик

### Цель:
Заменить SendGrid на Mailgun, сохранив существующую архитектуру и функциональность.

## High-level Task Breakdown

### Этап 1: Анализ текущей архитектуры
- [ ] Изучить EmailService и его зависимости
- [ ] Проанализировать SendGridEmailService
- [ ] Найти все места использования email отправки
- [ ] Понять структуру данных для email

### Этап 2: Создание MailgunEmailService
- [ ] Установить пакет @mailgun/mailgun-js
- [ ] Создать MailgunEmailService по аналогии с SendGridEmailService
- [ ] Реализовать метод sendCertificateEmail
- [ ] Добавить обработку ошибок и логирование

### Этап 3: Интеграция Mailgun в EmailService
- [ ] Закомментировать SendGrid код
- [ ] Добавить Mailgun как основной сервис
- [ ] Настроить fallback цепочку: Mailgun → SMTP
- [ ] Обновить переменные окружения

### Этап 4: Тестирование и деплой
- [ ] Протестировать локально
- [ ] Протестировать на сервере
- [ ] Убедиться в доставке писем
- [ ] Задеплоить изменения

## Current Status / Progress Tracking

### Completed ✅
- Выявлена проблема с SendGrid (аккаунт заблокирован)
- Проанализированы альтернативы (Resend выбран - работает с Россией)
- Временно отключен SendGrid в EmailService
- Установлен пакет resend
- Создан ResendEmailService
- Интегрирован Resend в EmailService как основной сервис
- Протестирована отправка через Resend (успешно!)
- Протестирована полная интеграция EmailService (успешно!)

### In Progress 🔄
- Подготовка к деплою

### Pending ⏳
- Деплой Resend интеграции на сервер

## Technical Implementation Plan

### Файлы для изменения:
- `src/services/emailService.js` - основной сервис
- `src/services/sendGridEmailService.js` - закомментировать
- `src/services/mailgunEmailService.js` - создать новый
- `package.json` - добавить @mailgun/mailgun-js
- `.env` - добавить переменные Mailgun

### Структура MailgunEmailService:
```javascript
class MailgunEmailService {
    constructor() {
        // Инициализация Mailgun API
    }
    
    async sendCertificateEmail(recipientEmail, certificateData) {
        // Отправка email с PDF вложением
    }
}
```

### Переменные окружения:
- MAILGUN_API_KEY
- MAILGUN_DOMAIN
- MAILGUN_FROM_EMAIL
- MAILGUN_FROM_NAME

## Executor's Feedback or Assistance Requests

**Готов к реализации:**
1. Создать MailgunEmailService
2. Интегрировать в EmailService
3. Протестировать отправку писем
4. Задеплоить на сервер

**Вопросы для уточнения:**
- Нужно ли сохранить SendGrid как fallback?
- Какие данные Mailgun нужно получить от пользователя?