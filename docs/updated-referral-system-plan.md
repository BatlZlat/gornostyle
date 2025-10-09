# Обновленный план реализации реферальной системы

## Ключевые изменения

### 1. Использование существующей кнопки "Поделиться ботом"
- ✅ Не создаем новую кнопку
- ✅ Обновляем существующую функцию `handleShareBotCommand`
- ✅ Добавляем генерацию реферальных ссылок

### 2. Защита от читерства
- ✅ Бонус начисляется только после пополнения баланса И записи на тренировку
- ✅ Статусы: `pending` → `registered` → `deposited` → `trained` → `completed`
- ✅ Один реферал на клиента (UNIQUE constraint)

### 3. Обновленная структура таблиц

```sql
-- Таблица реферальных транзакций
CREATE TABLE referral_transactions (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER REFERENCES clients(id),
    referee_id INTEGER REFERENCES clients(id),
    referral_code VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'registered', 'deposited', 'trained', 'completed', 'cancelled')),
    referrer_bonus DECIMAL(10,2) DEFAULT 500.00,
    referee_bonus DECIMAL(10,2) DEFAULT 500.00,
    registration_date TIMESTAMP,
    deposit_date TIMESTAMP,
    first_training_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(referee_id) -- Один реферал на клиента
);
```

## Логика работы

### 1. Генерация реферальной ссылки
```javascript
// При регистрации клиента генерируем уникальный код
async function generateReferralCode(clientId) {
    const code = `REF${clientId.toString().padStart(6, '0')}`;
    
    // Обновляем код в таблице клиентов
    await pool.query(
        'UPDATE clients SET referral_code = $1 WHERE id = $2',
        [code, clientId]
    );
    
    return code;
}
```

### 2. Обновление функции "Поделиться ботом"
```javascript
async function handleShareBotCommand(msg) {
    const chatId = msg.chat.id;
    const client = await getClientByTelegramId(msg.from.id.toString());
    
    if (!client) {
        return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
    }
    
    // Генерируем реферальную ссылку
    const referralCode = client.referral_code || await generateReferralCode(client.id);
    const referralLink = `https://t.me/gornostyle_bot?start=ref_${referralCode}`;
    
    // Получаем статистику рефералов
    const referralStats = await pool.query(
        `SELECT 
            COUNT(*) as total_referrals,
            SUM(CASE WHEN status = 'completed' THEN referrer_bonus ELSE 0 END) as total_earnings
         FROM referral_transactions 
         WHERE referrer_id = $1`,
        [client.id]
    );
    
    const stats = referralStats.rows[0];
    
    return bot.sendMessage(chatId,
        '📤 *Поделитесь ботом с друзьями!*\n\n' +
        '🔗 *Ваша реферальная ссылка:*\n' +
        `${referralLink}\n\n` +
        '💰 *Вы получите 500₽ за каждого друга, который:*\n' +
        '• Зарегистрируется по вашей ссылке\n' +
        '• Пополнит баланс\n' +
        '• Запишется на первую тренировку\n\n' +
        '🎁 *Ваш друг тоже получит 500₽ бонус!*\n\n' +
        '📊 *Ваша статистика:*\n' +
        `👥 Приглашено друзей: ${stats.total_referrals || 0}\n` +
        `💰 Заработано бонусов: ${stats.total_earnings || 0}₽`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['🔙 Назад в меню']
                ],
                resize_keyboard: true
            }
        }
    );
}
```

### 3. Обработка реферальной регистрации
```javascript
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const startParam = msg.text.split(' ')[1]; // ref_REF000123
    
    if (startParam && startParam.startsWith('ref_')) {
        const referralCode = startParam.replace('ref_', '');
        await handleReferralRegistration(msg, referralCode);
    } else {
        await handleNormalRegistration(msg);
    }
});

async function handleReferralRegistration(msg, referralCode) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    
    // Проверяем, что клиент еще не зарегистрирован
    const existingClient = await getClientByTelegramId(telegramId);
    if (existingClient) {
        return bot.sendMessage(chatId, 'Вы уже зарегистрированы в системе!');
    }
    
    // Находим реферера по коду
    const referrer = await pool.query(
        'SELECT id FROM clients WHERE referral_code = $1',
        [referralCode]
    );
    
    if (referrer.rows.length === 0) {
        return bot.sendMessage(chatId, 'Неверная реферальная ссылка!');
    }
    
    const referrerId = referrer.rows[0].id;
    
    // Регистрируем нового клиента
    const newClient = await registerClient(msg, referrerId);
    
    // Создаем запись о реферальной транзакции
    await pool.query(
        `INSERT INTO referral_transactions (referrer_id, referee_id, referral_code, status, registration_date) 
         VALUES ($1, $2, $3, 'registered', CURRENT_TIMESTAMP)`,
        [referrerId, newClient.id, referralCode]
    );
    
    // Уведомляем о регистрации
    await bot.sendMessage(chatId, 
        '🎉 Добро пожаловать! Вы зарегистрированы по реферальной ссылке!\n\n' +
        '💰 Для получения бонуса 500₽ необходимо:\n' +
        '• Пополнить баланс\n' +
        '• Записаться на первую тренировку\n\n' +
        '🎁 После этого вы получите бонус!'
    );
}
```

### 4. Отслеживание пополнения баланса
```javascript
// В функции пополнения баланса
async function processWalletTopUp(walletId, amount) {
    // ... существующая логика пополнения ...
    
    // Проверяем реферальные транзакции
    const client = await getClientByWalletId(walletId);
    if (client) {
        await pool.query(
            `UPDATE referral_transactions 
             SET status = 'deposited', deposit_date = CURRENT_TIMESTAMP
             WHERE referee_id = $1 AND status = 'registered'`,
            [client.id]
        );
    }
}
```

### 5. Отслеживание первой тренировки
```javascript
// В функции записи на тренировку
async function processTrainingBooking(sessionId, clientId) {
    // ... существующая логика записи ...
    
    // Проверяем реферальные транзакции
    const referralTransaction = await pool.query(
        `SELECT * FROM referral_transactions 
         WHERE referee_id = $1 AND status = 'deposited'`,
        [clientId]
    );
    
    if (referralTransaction.rows.length > 0) {
        // Обновляем статус на 'completed' - это запустит триггер начисления бонусов
        await pool.query(
            `UPDATE referral_transactions 
             SET status = 'completed', first_training_date = CURRENT_TIMESTAMP
             WHERE referee_id = $1 AND status = 'deposited'`,
            [clientId]
        );
        
        // Уведомляем о начислении бонусов
        const transaction = referralTransaction.rows[0];
        await notifyReferralBonuses(transaction);
    }
}
```

### 6. Уведомления о бонусах
```javascript
async function notifyReferralBonuses(transaction) {
    // Уведомляем реферера
    const referrer = await getClientById(transaction.referrer_id);
    if (referrer.telegram_id) {
        await bot.sendMessage(referrer.telegram_id,
            '🎉 Ваш друг прошел первую тренировку!\n\n' +
            '💰 Вы получили 500₽ бонус за приглашение!\n' +
            '💳 Бонус зачислен на ваш баланс.'
        );
    }
    
    // Уведомляем реферала
    const referee = await getClientById(transaction.referee_id);
    if (referee.telegram_id) {
        await bot.sendMessage(referee.telegram_id,
            '🎉 Поздравляем с первой тренировкой!\n\n' +
            '💰 Вы получили 500₽ бонус за регистрацию по реферальной ссылке!\n' +
            '💳 Бонус зачислен на ваш баланс.'
        );
    }
}
```

## Антифрод меры

### 1. Технические ограничения
- Один реферал на клиента (UNIQUE constraint)
- Проверка уникальности IP-адресов
- Временные ограничения между регистрацией и начислением бонусов

### 2. Мониторинг
- Отслеживание подозрительных паттернов
- Возможность отмены подозрительных транзакций
- Логирование всех действий

### 3. Админ-панель
- Просмотр всех реферальных транзакций
- Возможность ручной отмены бонусов
- Статистика по реферальной программе

## Преимущества обновленной системы

### Для бизнеса:
- ✅ Защита от читерства
- ✅ Бонусы начисляются только за реальных клиентов
- ✅ Контроль качества рефералов
- ✅ Экономия на рекламе

### Для клиентов:
- ✅ Простота использования
- ✅ Прозрачность системы
- ✅ Гарантия получения бонусов
- ✅ Мотивация к активности

