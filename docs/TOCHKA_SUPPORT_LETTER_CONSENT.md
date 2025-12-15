# Сообщение для чата техподдержки Точка Банка

## Текст для отправки:

---

Здравствуйте!

Обращаюсь по вопросу интеграции интернет-эквайринга через API.

**Проблема:**
При попытке создать платеж через API получаю ошибку 403 "Forbidden by consent".

**Детали:**
- Endpoint: POST https://enter.tochka.com/uapi/acquiring/v1.0/payments
- Customer Code: 300764882
- Client ID: ef8bd6b197afa018bfe931f057f1a10c
- Сайт: https://gornostyle72.ru/instruktor-po-gornym-lyzham-snoubordy-tyumen

**Ошибка:**
```
HTTP 403: "Forbidden by consent"
{
  "code": "403",
  "message": "Что-то пошло не так",
  "Errors": [{
    "errorCode": "Something going wrong",
    "message": "Forbidden by consent"
  }]
}
```

**Результат проверки разрешений через API:**
- Найдено разрешений: 1
- Разрешение MakeAcquiringOperation: НЕ НАЙДЕНО

**Проблема с merchantId:**
- Вы дали MB0002168266 (13 символов) - это QR-код для СБП
- Но API требует минимум 15 символов: "Field merchantId : String should have at least 15 characters"
- В документации пример: "200000000001056" (15 символов)
- Попробовал убрать merchantId из запроса (он опционален), но все равно получаю ошибку 403 "Forbidden by consent"

**Текущий запрос (без merchantId):**
```json
{
  "Data": {
    "customerCode": "300764882",
    "amount": 10,
    "purpose": "Кулига: лыжи 13.12.2025, 12:00",
    "paymentMode": ["card"],
    "paymentLinkId": "kuliga-75",
    "redirectUrl": "https://gornostyle72.ru/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking/success",
    "failRedirectUrl": "https://gornostyle72.ru/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking/fail"
  }
}
```

**Вопросы:**

1. **Разрешение MakeAcquiringOperation:**
   - Как создать и подтвердить разрешение MakeAcquiringOperation для работы с интернет-эквайрингом через API?
   - Где в личном кабинете можно управлять разрешениями?
   - Нужно ли что-то дополнительно настроить в личном кабинете для работы API?

2. **MerchantId:**
   - Где найти правильный 15-символьный merchantId для API интернет-эквайринга?
   - MB0002168266 (13 символов) - это QR-код для СБП, но API требует 15 символов
   - Или merchantId опционален и можно работать без него? (пробовал без него - все равно 403)

3. **Что еще нужно настроить?**
   - ✅ Зарегистрирован webhook: https://gornostyle72.ru/api/kuliga/payment/callback
   - ✅ Настроены URL для редиректов (success/fail)
   - ✅ Сайт зарегистрирован в интернет-эквайринге
   - ✅ Получен JWT токен для авторизации

**Аккаунт:** Тебякин Д.Ю., ИП

Буду благодарен за помощь!

---

## Дополнительная информация (если спросят):

**Ссылки на документацию:**
- Create Payment Operation: https://developers.tochka.com/docs/tochka-api/api/create-payment-operation-acquiring-v-1-0-payments-post
- Работа с разрешениями: https://developers.tochka.com/docs/tochka-api/api/rabota-s-razresheniyami
- Необходимые разрешения: MakeAcquiringOperation (указано в документации)

**Проверка разрешений:**
```bash
GET https://enter.tochka.com/uapi/consent/v1.0/consents
Headers:
  Authorization: Bearer {JWT_TOKEN}
  customer-code: 300764882
```
Результат: найдено 1 разрешение, но MakeAcquiringOperation отсутствует.
