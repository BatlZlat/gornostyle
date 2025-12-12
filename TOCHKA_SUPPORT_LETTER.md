# Письмо в техподдержку Точка Банк

Добрый день!

Подключен интернет-эквайринг для сайта. Нужна помощь с регистрацией вебхука через API.

**Проблема:** при попытке зарегистрировать вебхук через PUT-запрос Create Webhook получаю 404 Not Found.

**Что пробовал:**
- `PUT https://enter.tochka.com/api/create-webhook-webhook/v1.0/{clientId}`
- `PUT https://api.tochka.com/api/create-webhook-webhook/v1.0/{clientId}`
- Другие варианты endpoint'ов

**Вопросы:**
1. Какой точный URL для PUT-запроса Create Webhook?
2. Какой формат авторизации нужен? Использую `Authorization: Bearer {JWT_TOKEN}` — правильно?
3. Можно ли зарегистрировать вебхук через личный кабинет интернет-эквайринга?

**Данные:**
- Client ID: `ef8bd6b197afa018bfe931f057f1a10c`
- Тип вебхука: `acquiringInternetPayment`
- Callback URL: `https://gornostyle72.ru/api/kuliga/payment/callback`
- Зарегистрированный сайт в ЛК: `https://gornostyle72.ru/instruktor-po-gornym-lyzham-snoubordy-tyumen`

**Дополнительный вопрос:** В настройках интернет-эквайринга указан URL `https://gornostyle72.ru/instruktor-po-gornym-lyzham-snoubordy-tyumen`, а callback URL для вебхука — `https://gornostyle72.ru/api/kuliga/payment/callback`. Может ли это быть причиной проблемы? Нужно ли указывать полный URL сайта или достаточно домена?

Спасибо!


