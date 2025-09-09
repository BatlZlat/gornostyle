# Интеграция системы сертификатов с ботом

## Обзор интеграции

Система сертификатов интегрируется с существующим Telegram ботом для обеспечения seamless пользовательского опыта при покупке и активации сертификатов.

## Структура меню

### Главное меню (обновленное)
```
🏠 ГЛАВНОЕ МЕНЮ

🏔️ Записаться на тренировку
📅 Расписание тренировок
💰 Мой кошелек
🎁 СЕРТИФИКАТЫ          ← НОВОЕ
👤 Мой профиль
📞 Контакты
```

### Меню сертификатов
```
🎁 СЕРТИФИКАТЫ

💝 Подарить сертификат
🔑 Активировать сертификат
📋 Мои сертификаты
🔙 Назад в главное меню
```

## Пользовательские сценарии

### 1. Покупка сертификата

#### Шаг 1: Выбор номинала
```
💝 ПОДАРИТЬ СЕРТИФИКАТ

Выберите номинал сертификата:

💰 2 500 руб. - Индивидуальная 30 мин без тренера
💰 3 000 руб. - Индивидуальная 30 мин с тренером
💰 5 000 руб. - Индивидуальная 60 мин без тренера
💰 6 000 руб. - Индивидуальная 60 мин с тренером
💰 10 000 руб. - Групповые тренировки 3-4 чел
💰 15 000 руб. - Групповые тренировки 5-6 чел

💳 Произвольная сумма (500-50 000 руб.)
🔙 Назад
```

#### Шаг 2: Ввод произвольной суммы (если выбрано)
```
💳 ПРОИЗВОЛЬНАЯ СУММА

Введите сумму сертификата (от 500 до 50 000 руб.):

Пример: 7500

🔙 Назад
```

#### Шаг 3: Выбор дизайна
```
🎨 ВЫБЕРИТЕ ДИЗАЙН СЕРТИФИКАТА

1️⃣ Классический - элегантный, деловой стиль
2️⃣ Спортивный - динамичный, с лыжами
3️⃣ Праздничный - яркий, для особых случаев
4️⃣ Минималистичный - простой, современный

🔙 Назад
```

#### Шаг 4: Заполнение данных получателя
```
👤 ДАННЫЕ ПОЛУЧАТЕЛЯ

Введите имя получателя (необязательно):
Иван Иванов

Введите телефон получателя (необязательно):
+7900123456

Введите сообщение для получателя (необязательно):
Поздравляю с днем рождения!

🔙 Назад    ✅ Продолжить
```

#### Шаг 5: Подтверждение покупки
```
✅ ПОДТВЕРЖДЕНИЕ ПОКУПКИ

Номинал: 5 000 руб.
Дизайн: Классический
Получатель: Иван Иванов
Телефон: +7900123456
Сообщение: Поздравляю с днем рождения!

Стоимость: 5 000 руб.
Баланс кошелька: 15 000 руб.
Остаток после покупки: 10 000 руб.

❌ Отменить    ✅ Купить сертификат
```

#### Шаг 6: Результат покупки
```
🎉 СЕРТИФИКАТ УСПЕШНО СОЗДАН!

Номер сертификата: 123456
Номинал: 5 000 руб.
Дизайн: Классический
Получатель: Иван Иванов

🔗 Ссылка на сертификат:
https://gornostyle72.ru/certificate/123456

Вы можете:
📱 Отправить ссылку другу
🖨️ Распечатать сертификат
📋 Посмотреть мои сертификаты

🔙 В главное меню
```

### 2. Активация сертификата

#### Способ 1: Через бот
```
🔑 АКТИВИРОВАТЬ СЕРТИФИКАТ

Введите номер сертификата (6 цифр):

Пример: 123456

🔙 Назад
```

#### Способ 2: Через ссылку
Пользователь переходит по ссылке `https://gornostyle72.ru/certificate/123456` и нажимает кнопку "Активировать в боте".

#### Результат активации
```
✅ СЕРТИФИКАТ АКТИВИРОВАН!

Номер: 123456
Номинал: 5 000 руб.
Зачислено на кошелек: 5 000 руб.
Новый баланс: 20 000 руб.

Теперь вы можете записаться на тренировки!

🏔️ Записаться на тренировку
🔙 В главное меню
```

### 3. Просмотр сертификатов

```
📋 МОИ СЕРТИФИКАТЫ

🛒 КУПЛЕННЫЕ СЕРТИФИКАТЫ:
• #123456 - 5 000 руб. - Классический
  Получатель: Иван Иванов
  Статус: Активирован ✅
  Дата активации: 31.12.2024

• #789012 - 3 000 руб. - Спортивный
  Получатель: Мария Петрова
  Статус: Активен ⏳
  Срок действия: до 31.12.2025

🔑 АКТИВИРОВАННЫЕ СЕРТИФИКАТЫ:
• #345678 - 10 000 руб. - Праздничный
  От: Петр Сидоров
  Дата активации: 25.12.2024

🔙 Назад
```

## Техническая реализация

### 1. Обновление главного меню

```javascript
// В src/bot/client-bot.js
function showMainMenu(chatId) {
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['🏔️ Записаться на тренировку'],
                ['📅 Расписание тренировок'],
                ['💰 Мой кошелек'],
                ['🎁 СЕРТИФИКАТЫ'], // НОВОЕ
                ['👤 Мой профиль'],
                ['📞 Контакты']
            ],
            resize_keyboard: true
        }
    };
    
    bot.sendMessage(chatId, '🏠 ГЛАВНОЕ МЕНЮ', keyboard);
}
```

### 2. Обработчик меню сертификатов

```javascript
// В src/bot/client-bot.js
async function handleCertificateMenu(chatId, messageText) {
    switch(messageText) {
        case '💝 Подарить сертификат':
            await showNominalSelection(chatId);
            break;
        case '🔑 Активировать сертификат':
            await showCertificateActivation(chatId);
            break;
        case '📋 Мои сертификаты':
            await showUserCertificates(chatId);
            break;
        case '🔙 Назад':
            showMainMenu(chatId);
            break;
    }
}
```

### 3. Выбор номинала

```javascript
async function showNominalSelection(chatId) {
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['💰 2 500 руб.', '💰 3 000 руб.'],
                ['💰 5 000 руб.', '💰 6 000 руб.'],
                ['💰 10 000 руб.', '💰 15 000 руб.'],
                ['💳 Произвольная сумма'],
                ['🔙 Назад']
            ],
            resize_keyboard: true
        }
    };
    
    const message = `💝 ПОДАРИТЬ СЕРТИФИКАТ

Выберите номинал сертификата:

💰 2 500 руб. - Индивидуальная 30 мин без тренера
💰 3 000 руб. - Индивидуальная 30 мин с тренером
💰 5 000 руб. - Индивидуальная 60 мин без тренера
💰 6 000 руб. - Индивидуальная 60 мин с тренером
💰 10 000 руб. - Групповые тренировки 3-4 чел
💰 15 000 руб. - Групповые тренировки 5-6 чел

💳 Произвольная сумма (500-50 000 руб.)`;
    
    bot.sendMessage(chatId, message, keyboard);
}
```

### 4. Выбор дизайна

```javascript
async function showDesignSelection(chatId, nominalValue) {
    // Получаем доступные дизайны через API
    const designs = await getCertificateDesigns();
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: designs.map(design => [{
                text: `${design.name} - ${design.nominalValue} руб.`,
                callback_data: `cert_design_${design.id}_${nominalValue}`
            }])
        }
    };
    
    const message = `🎨 ВЫБЕРИТЕ ДИЗАЙН СЕРТИФИКАТА

Номинал: ${nominalValue} руб.

Доступные дизайны:`;
    
    bot.sendMessage(chatId, message, keyboard);
}
```

### 5. Заполнение данных получателя

```javascript
async function showRecipientForm(chatId, designId, nominalValue) {
    // Сохраняем состояние для последующей обработки
    userStates[chatId] = {
        state: 'certificate_recipient',
        data: { designId, nominalValue }
    };
    
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['🔙 Назад']
            ],
            resize_keyboard: true
        }
    };
    
    const message = `👤 ДАННЫЕ ПОЛУЧАТЕЛЯ

Введите имя получателя (необязательно):
Иван Иванов

Введите телефон получателя (необязательно):
+7900123456

Введите сообщение для получателя (необязательно):
Поздравляю с днем рождения!

🔙 Назад    ✅ Продолжить`;
    
    bot.sendMessage(chatId, message, keyboard);
}
```

### 6. Создание сертификата

```javascript
async function createCertificate(chatId, certificateData) {
    try {
        // Проверяем баланс кошелька
        const wallet = await getWalletByClientId(certificateData.clientId);
        if (wallet.balance < certificateData.nominalValue) {
            bot.sendMessage(chatId, '❌ Недостаточно средств на кошельке');
            return;
        }
        
        // Создаем сертификат через API
        const response = await fetch('/api/certificates/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_TOKEN}`
            },
            body: JSON.stringify(certificateData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            await showCertificateResult(chatId, result.certificate);
        } else {
            bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`);
        }
    } catch (error) {
        console.error('Ошибка создания сертификата:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при создании сертификата');
    }
}
```

### 7. Активация сертификата

```javascript
async function activateCertificate(chatId, certificateNumber) {
    try {
        const response = await fetch('/api/certificates/activate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_TOKEN}`
            },
            body: JSON.stringify({
                certificate_number: certificateNumber,
                client_id: getClientIdByChatId(chatId)
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            await showActivationResult(chatId, result);
        } else {
            bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`);
        }
    } catch (error) {
        console.error('Ошибка активации сертификата:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при активации сертификата');
    }
}
```

## Состояния пользователя

### Новые состояния для сертификатов
```javascript
const CERTIFICATE_STATES = {
    NOMINAL_SELECTION: 'certificate_nominal',
    CUSTOM_AMOUNT: 'certificate_custom_amount',
    DESIGN_SELECTION: 'certificate_design',
    RECIPIENT_FORM: 'certificate_recipient',
    CONFIRMATION: 'certificate_confirmation',
    ACTIVATION: 'certificate_activation'
};
```

### Обработка состояний
```javascript
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const userState = userStates[chatId];
    
    if (userState && userState.state.startsWith('certificate_')) {
        await handleCertificateState(msg, userState);
        return;
    }
    
    // Остальная логика...
}

async function handleCertificateState(msg, userState) {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    switch(userState.state) {
        case 'certificate_custom_amount':
            await handleCustomAmount(chatId, text, userState.data);
            break;
        case 'certificate_recipient':
            await handleRecipientData(chatId, text, userState.data);
            break;
        case 'certificate_activation':
            await handleActivationInput(chatId, text);
            break;
    }
}
```

## Интеграция с существующей системой

### 1. Использование существующих функций
- `getWalletByClientId()` - для проверки баланса
- `updateWalletBalance()` - для списания средств
- `createTransaction()` - для записи транзакций
- `notifyAdmin()` - для уведомлений

### 2. Новые функции
- `getCertificateDesigns()` - получение дизайнов
- `createCertificate()` - создание сертификата
- `activateCertificate()` - активация сертификата
- `getUserCertificates()` - получение сертификатов пользователя

### 3. Обновление существующих функций
- Добавить кнопку "Сертификаты" в главное меню
- Обновить обработчики текстовых сообщений
- Добавить новые состояния пользователя

## Обработка ошибок

### Типичные ошибки и их обработка
```javascript
const CERTIFICATE_ERRORS = {
    INSUFFICIENT_FUNDS: 'Недостаточно средств на кошельке',
    INVALID_NOMINAL: 'Неверный номинал сертификата',
    INVALID_DESIGN: 'Неверный дизайн сертификата',
    CERTIFICATE_NOT_FOUND: 'Сертификат не найден',
    ALREADY_ACTIVATED: 'Сертификат уже активирован',
    EXPIRED: 'Сертификат просрочен'
};

function getErrorMessage(errorCode) {
    return CERTIFICATE_ERRORS[errorCode] || 'Произошла неизвестная ошибка';
}
```

## Тестирование

### Тестовые сценарии
1. **Покупка сертификата с быстрым выбором номинала**
2. **Покупка сертификата с произвольной суммой**
3. **Активация сертификата через бот**
4. **Активация сертификата через ссылку**
5. **Просмотр списка сертификатов**
6. **Обработка ошибок (недостаточно средств, неверный номер)**

### Тестовые данные
```javascript
const TEST_CERTIFICATES = {
    valid: '123456',
    expired: '999999',
    already_used: '888888',
    not_found: '000000'
};

const TEST_NOMINALS = [2500, 3000, 5000, 6000, 10000, 15000];
const TEST_CUSTOM_AMOUNTS = [500, 1000, 25000, 50000];
```

## Заключение

Интеграция системы сертификатов с ботом обеспечивает удобный и интуитивный интерфейс для покупки и активации сертификатов. Использование существующей инфраструктуры минимизирует сложность реализации и обеспечивает совместимость с текущей системой.
