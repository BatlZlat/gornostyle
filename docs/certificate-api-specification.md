# API спецификация для системы сертификатов

## Базовый URL
```
https://gornostyle72.ru/api/certificates
```

## Аутентификация
Все запросы требуют Bearer токен в заголовке Authorization:
```
Authorization: Bearer <admin_token>
```

## Endpoints

### 1. Создание сертификата

**POST** `/create`

Создает новый сертификат и списывает средства с кошелька покупателя.

#### Тело запроса
```json
{
    "nominal_value": 5000,
    "design_id": 1,
    "recipient_name": "Иван Иванов",
    "recipient_phone": "+7900123456",
    "message": "Поздравляю с днем рождения!"
}
```

#### Параметры
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `nominal_value` | decimal | Да | Номинал сертификата (500-50000) |
| `design_id` | integer | Да | ID дизайна сертификата |
| `recipient_name` | string | Нет | Имя получателя |
| `recipient_phone` | string | Нет | Телефон получателя |
| `message` | string | Нет | Сообщение для получателя |

#### Ответ при успехе (201)
```json
{
    "success": true,
    "message": "Сертификат успешно создан",
    "certificate": {
        "id": 123,
        "certificate_number": "123456",
        "nominal_value": 5000,
        "design_id": 1,
        "recipient_name": "Иван Иванов",
        "recipient_phone": "+7900123456",
        "message": "Поздравляю с днем рождения!",
        "status": "active",
        "expiry_date": "2025-12-31T23:59:59Z",
        "purchase_date": "2024-12-31T12:00:00Z",
        "certificate_url": "https://gornostyle72.ru/certificate/123456"
    }
}
```

#### Ответ при ошибке (400)
```json
{
    "success": false,
    "error": "Недостаточно средств на кошельке",
    "code": "INSUFFICIENT_FUNDS"
}
```

#### Возможные коды ошибок
- `INSUFFICIENT_FUNDS` - Недостаточно средств
- `INVALID_NOMINAL` - Неверный номинал
- `INVALID_DESIGN` - Неверный дизайн
- `WALLET_NOT_FOUND` - Кошелек не найден

---

### 2. Активация сертификата

**POST** `/activate`

Активирует сертификат и зачисляет средства на кошелек клиента.

#### Тело запроса
```json
{
    "certificate_number": "123456",
    "client_id": 456
}
```

#### Параметры
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `certificate_number` | string | Да | Номер сертификата (6 цифр) |
| `client_id` | integer | Да | ID клиента |

#### Ответ при успехе (200)
```json
{
    "success": true,
    "message": "Сертификат успешно активирован",
    "certificate": {
        "id": 123,
        "certificate_number": "123456",
        "nominal_value": 5000,
        "status": "used",
        "activation_date": "2024-12-31T15:30:00Z"
    },
    "wallet": {
        "balance": 15000,
        "amount_added": 5000
    }
}
```

#### Ответ при ошибке (400)
```json
{
    "success": false,
    "error": "Сертификат уже активирован",
    "code": "ALREADY_ACTIVATED"
}
```

#### Возможные коды ошибок
- `CERTIFICATE_NOT_FOUND` - Сертификат не найден
- `ALREADY_ACTIVATED` - Сертификат уже активирован
- `EXPIRED` - Сертификат просрочен
- `CLIENT_NOT_FOUND` - Клиент не найден
- `WALLET_NOT_FOUND` - Кошелек не найден

---

### 3. Получение информации о сертификате

**GET** `/:number`

Получает информацию о сертификате по номеру.

#### Параметры URL
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `number` | string | Да | Номер сертификата (6 цифр) |

#### Ответ при успехе (200)
```json
{
    "success": true,
    "certificate": {
        "id": 123,
        "certificate_number": "123456",
        "nominal_value": 5000,
        "design": {
            "id": 1,
            "name": "Классический",
            "image_url": "/images/certificates/classic.jpg"
        },
        "status": "active",
        "expiry_date": "2025-12-31T23:59:59Z",
        "purchase_date": "2024-12-31T12:00:00Z",
        "purchaser": {
            "id": 789,
            "name": "Петр Петров"
        },
        "recipient_name": "Иван Иванов",
        "recipient_phone": "+7900123456",
        "message": "Поздравляю с днем рождения!",
        "activated_by": null,
        "activation_date": null
    }
}
```

#### Ответ при ошибке (404)
```json
{
    "success": false,
    "error": "Сертификат не найден",
    "code": "CERTIFICATE_NOT_FOUND"
}
```

---

### 4. Получение дизайнов сертификатов

**GET** `/designs`

Получает список доступных дизайнов сертификатов.

#### Ответ при успехе (200)
```json
{
    "success": true,
    "designs": [
        {
            "id": 1,
            "name": "Классический",
            "image_url": "/images/certificates/classic.jpg",
            "template_url": "/templates/certificates/classic.html",
            "is_active": true
        },
        {
            "id": 2,
            "name": "Спортивный",
            "image_url": "/images/certificates/sport.jpg",
            "template_url": "/templates/certificates/sport.html",
            "is_active": true
        },
        {
            "id": 3,
            "name": "Праздничный",
            "image_url": "/images/certificates/party.jpg",
            "template_url": "/templates/certificates/party.html",
            "is_active": true
        },
        {
            "id": 4,
            "name": "Минималистичный",
            "image_url": "/images/certificates/minimal.jpg",
            "template_url": "/templates/certificates/minimal.html",
            "is_active": true
        }
    ]
}
```

---

### 5. Получение сертификатов клиента

**GET** `/client/:client_id`

Получает все сертификаты клиента (купленные и активированные).

#### Параметры URL
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `client_id` | integer | Да | ID клиента |

#### Query параметры
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `status` | string | Нет | Фильтр по статусу (active, used, expired) |
| `limit` | integer | Нет | Количество записей (по умолчанию 50) |
| `offset` | integer | Нет | Смещение (по умолчанию 0) |

#### Ответ при успехе (200)
```json
{
    "success": true,
    "certificates": [
        {
            "id": 123,
            "certificate_number": "123456",
            "nominal_value": 5000,
            "design": {
                "id": 1,
                "name": "Классический"
            },
            "status": "used",
            "purchase_date": "2024-12-31T12:00:00Z",
            "activation_date": "2024-12-31T15:30:00Z",
            "recipient_name": "Иван Иванов"
        }
    ],
    "pagination": {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "has_more": false
    }
}
```

---

### 6. Получение статистики сертификатов (Админ)

**GET** `/admin/statistics`

Получает статистику по сертификатам для администратора.

#### Query параметры
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string | Нет | Начальная дата (YYYY-MM-DD) |
| `end_date` | string | Нет | Конечная дата (YYYY-MM-DD) |

#### Ответ при успехе (200)
```json
{
    "success": true,
    "statistics": {
        "total_certificates": 150,
        "total_value": 750000,
        "active_certificates": 45,
        "used_certificates": 100,
        "expired_certificates": 5,
        "average_nominal": 5000,
        "popular_nominals": [
            {"nominal": 5000, "count": 50},
            {"nominal": 3000, "count": 30},
            {"nominal": 10000, "count": 25}
        ],
        "popular_designs": [
            {"design_id": 1, "design_name": "Классический", "count": 60},
            {"design_id": 2, "design_name": "Спортивный", "count": 40}
        ],
        "activation_rate": 66.67
    }
}
```

---

## Коды состояния HTTP

| Код | Описание |
|-----|----------|
| 200 | Успешный запрос |
| 201 | Ресурс создан |
| 400 | Ошибка в запросе |
| 401 | Не авторизован |
| 403 | Доступ запрещен |
| 404 | Ресурс не найден |
| 500 | Внутренняя ошибка сервера |

## Формат ошибок

Все ошибки возвращаются в следующем формате:

```json
{
    "success": false,
    "error": "Описание ошибки",
    "code": "ERROR_CODE",
    "details": {
        "field": "Дополнительная информация"
    }
}
```

## Лимиты и ограничения

- Максимальный номинал сертификата: 50 000 руб.
- Минимальный номинал сертификата: 500 руб.
- Срок действия сертификата: 1 год
- Максимальная длина сообщения: 500 символов
- Максимальная длина имени получателя: 100 символов

## Примеры использования

### Создание сертификата через curl
```bash
curl -X POST https://gornostyle72.ru/api/certificates/create \
  -H "Authorization: Bearer your_admin_token" \
  -H "Content-Type: application/json" \
  -d '{
    "nominal_value": 5000,
    "design_id": 1,
    "recipient_name": "Иван Иванов",
    "recipient_phone": "+7900123456",
    "message": "Поздравляю с днем рождения!"
  }'
```

### Активация сертификата через curl
```bash
curl -X POST https://gornostyle72.ru/api/certificates/activate \
  -H "Authorization: Bearer your_admin_token" \
  -H "Content-Type: application/json" \
  -d '{
    "certificate_number": "123456",
    "client_id": 456
  }'
```

### Получение информации о сертификате через curl
```bash
curl -X GET https://gornostyle72.ru/api/certificates/123456 \
  -H "Authorization: Bearer your_admin_token"
```
