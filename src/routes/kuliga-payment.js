const express = require('express');
const { pool } = require('../db');
const PaymentProviderFactory = require('../services/payment/paymentProvider');

const router = express.Router();

/**
 * Логирование вебхука в БД
 * @param {object} data - Данные для логирования
 * @returns {Promise<number|null>} ID лога или null
 */
async function logWebhook(data) {
    try {
        const result = await pool.query(
            `INSERT INTO webhook_logs 
             (provider, webhook_type, payment_id, order_id, booking_id, status, amount, 
              payment_method, raw_payload, headers, signature_valid, processed, error_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT ON CONSTRAINT idx_webhook_logs_unique_event DO UPDATE 
             SET processed = $12, processed_at = CURRENT_TIMESTAMP, error_message = $13
             RETURNING id`,
            [
                data.provider,
                data.webhookType,
                data.paymentId,
                data.orderId,
                data.bookingId,
                data.status,
                data.amount,
                data.paymentMethod,
                JSON.stringify(data.rawPayload),
                JSON.stringify(data.headers),
                data.signatureValid,
                data.processed,
                data.errorMessage
            ]
        );
        return result.rows[0]?.id || null;
    } catch (error) {
        // Если таблица не существует, просто логируем в консоль
        console.warn('⚠️ Не удалось записать webhook в БД:', error.message);
        return null;
    }
}

// Обработка GET запроса для проверки доступности (если банк использует GET для проверки)
router.get('/callback', (req, res) => {
    console.log('🔍 GET запрос на /callback (проверка доступности)');
    res.status(200).send('OK');
});

router.post(
    '/callback',
    // Принимаем любой Content-Type, включая text/plain
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req, res) => {
        const headers = req.headers || {};
        const rawBody = Buffer.isBuffer(req.body)
            ? req.body.toString('utf8')
            : typeof req.body === 'string'
                ? req.body
                : '';

        const startTime = Date.now();
        const contentLength = Number(headers['content-length'] || 0);
        const rawLength = rawBody.length;
        const userAgent = (headers['user-agent'] || headers['User-Agent'] || '').toLowerCase();
        const contentType = headers['content-type'] || headers['Content-Type'] || '';

        // Проверяем, является ли rawBody JWT токеном (Точка Банк отправляет вебхуки как JWT)
        // JWT формат: header.payload.signature (три части, разделенные точками)
        const trimmedBody = rawBody.trim();
        const isJWT = trimmedBody && trimmedBody.split('.').length === 3 && trimmedBody.startsWith('eyJ');
        
        let payload = {};
        let jwtToken = null;

        if (isJWT) {
            // Это JWT токен - декодируем без проверки подписи (проверим позже)
            jwtToken = rawBody.trim();
            try {
                const jwt = require('jsonwebtoken');
                // Декодируем без проверки подписи, чтобы извлечь payload
                payload = jwt.decode(jwtToken, { complete: false });
                if (!payload) {
                    throw new Error('Не удалось декодировать JWT');
                }
                console.log('✅ Распознан JWT токен, payload декодирован');
            } catch (err) {
                console.error('❌ Ошибка декодирования JWT:', err.message);
                return res.status(400).send('Invalid JWT format');
            }
        } else {
            // Пытаемся распарсить как JSON
            try {
                payload = rawBody ? JSON.parse(rawBody) : {};
            } catch (err) {
                console.warn('⚠️ Не удалось распарсить webhook как JSON, rawBody сохранён', {
                    error: err.message
                });
            }
        }

        console.log(`🔔 Получен webhook:`, {
            method: 'POST',
            headers: Object.keys(headers),
            payloadKeys: Object.keys(payload),
            userAgent,
            contentType,
            contentLength,
            rawLength,
            isJWT: !!isJWT
        });

        // Логируем первые 500 символов rawBody для отладки
        if (rawLength > 0 && Object.keys(payload).length === 0 && !isJWT) {
            console.log('⚠️ Payload не распарсился, rawBody (первые 500 символов):', rawBody.substring(0, 500));
        }

    try {
        // Обработка тестового вебхука от банка при регистрации
        // Тестовый — только если действительно пустое тело (rawLength === 0)
        const isParsedEmpty = !payload || Object.keys(payload).length === 0;
        const isTrulyEmpty = rawLength === 0 || contentLength === 0;
        const isTestWebhook =
            isTrulyEmpty ||
            (isParsedEmpty && (userAgent.includes('tochka') || userAgent.includes('curl') || userAgent.includes('postman')));

        if (isTestWebhook) {
            console.log('✅ Получен тестовый вебхук от банка (проверка доступности URL)');
            console.log('   Payload:', rawBody || '{}');
            console.log('   User-Agent:', userAgent);
            // Отвечаем 200 OK для успешной проверки доступности
            return res.status(200).send('OK');
        }

        // Определяем провайдера по структуре payload
        const providerName = PaymentProviderFactory.detectProviderFromWebhook(payload);
        const provider = PaymentProviderFactory.create(providerName);

        // Проверяем подпись webhook
        // Для JWT токенов проверяем подпись самого токена, для JSON - через verifyWebhookSignature
        let signatureValid = false;
        if (isJWT && jwtToken) {
            // Для JWT проверяем подпись токена напрямую
            signatureValid = provider.verifyJWT(jwtToken);
            if (!signatureValid) {
                console.error('❌ Некорректная подпись JWT токена');
                console.error('   JWT (первые 200 символов):', jwtToken.substring(0, 200));
            }
        } else {
            // Для JSON проверяем через стандартный метод
            signatureValid = provider.verifyWebhookSignature(payload, headers);
        }
        
        if (!signatureValid) {
            console.error(`❌ Некорректная подпись ${providerName} webhook`);
            console.error('   Payload:', JSON.stringify(payload, null, 2));
            console.error('   Headers (authorization):', headers['authorization'] || headers['Authorization'] || 'отсутствует');
            
            // Логируем неудачную попытку
            await logWebhook({
                provider: providerName,
                webhookType: payload.webhookType || 'unknown',
                paymentId: payload.paymentId || payload.payment_id,
                orderId: payload.orderId || payload.order_id,
                bookingId: null,
                status: payload.status,
                amount: null,
                paymentMethod: null,
                rawPayload: payload,
                headers: headers,
                signatureValid: false,
                processed: false,
                errorMessage: 'Invalid signature'
            });
            
            return res.status(400).send('Invalid signature');
        }

        // Парсим данные webhook
        const webhookData = provider.parseWebhookData(payload);
        let { orderId, paymentId, status, amount, paymentMethod, webhookType } = webhookData;
        
        // Если orderId не определён (например, для СБП), пытаемся найти транзакцию по paymentId
        if (!orderId && paymentId) {
            console.warn(`⚠️ orderId не определён в webhook, ищем транзакцию по paymentId: ${paymentId}`);
            const txResult = await pool.query(
                `SELECT id, provider_order_id FROM kuliga_transactions 
                 WHERE provider_payment_id = $1 OR provider_order_id LIKE $2
                 ORDER BY id DESC LIMIT 1`,
                [paymentId, `%${paymentId}%`]
            );
            
            if (txResult.rows.length && txResult.rows[0].provider_order_id) {
                orderId = txResult.rows[0].provider_order_id;
                console.log(`✅ Найден orderId из транзакции: ${orderId}`);
            } else {
                // Пробуем найти по operationId в самом payload
                const operationId = payload.operationId || payload.operation_id;
                if (operationId) {
                    const txByOpId = await pool.query(
                        `SELECT id, provider_order_id FROM kuliga_transactions 
                         WHERE provider_payment_id = $1 ORDER BY id DESC LIMIT 1`,
                        [operationId]
                    );
                    if (txByOpId.rows.length && txByOpId.rows[0].provider_order_id) {
                        orderId = txByOpId.rows[0].provider_order_id;
                        console.log(`✅ Найден orderId по operationId: ${orderId}`);
                    }
                }
            }
        }
        
        console.log(`✅ Webhook валиден:`, {
            provider: providerName,
            webhookType,
            orderId,
            paymentId,
            status
        });
        
        // Временное логирование для отладки СБП
        if (!orderId) {
            console.error('❌ orderId не определён после всех попыток, полный payload:', JSON.stringify(payload, null, 2));
        }

        // Поддерживаем форматы:
        // - gornostyle72-winter-{id} - для бронирований
        // - gornostyle72-wallet-{id} - для пополнения кошелька
        // - kuliga-tx-{id} - старый формат транзакций
        // - kuliga-{id} - очень старый формат (booking_id)
        if (!orderId || (!orderId.startsWith('gornostyle72-winter-') && 
                         !orderId.startsWith('gornostyle72-wallet-') && 
                         !orderId.startsWith('kuliga-tx-') && 
                         !orderId.startsWith('kuliga-'))) {
            console.warn(`⚠️ Получен callback ${providerName} с неподдерживаемым OrderId:`, orderId);
            
            // Логируем неподдерживаемый webhook
            await logWebhook({
                provider: providerName,
                webhookType,
                paymentId,
                orderId,
                bookingId: null,
                status,
                amount,
                paymentMethod,
                rawPayload: payload,
                headers,
                signatureValid: true,
                processed: false,
                errorMessage: 'Unsupported orderId format'
            });
            
            return res.status(200).send('OK');
        }

        // НОВАЯ ЛОГИКА: orderId = gornostyle72-winter-{transactionId} (или старый формат kuliga-tx-{transactionId})
        // Находим транзакцию, проверяем есть ли booking_id
        // Если нет - создаём бронирование из provider_raw_data
        let transactionId;
        if (orderId.startsWith('gornostyle72-winter-')) {
            // Новый формат: gornostyle72-winter-{transactionId} - для бронирований
            transactionId = Number(orderId.replace('gornostyle72-winter-', ''));
        } else if (orderId.startsWith('gornostyle72-wallet-')) {
            // Формат: gornostyle72-wallet-{transactionId} - для пополнения кошелька
            transactionId = Number(orderId.replace('gornostyle72-wallet-', ''));
        } else if (orderId.startsWith('kuliga-tx-')) {
            // Старый формат: kuliga-tx-{transactionId}
            transactionId = Number(orderId.replace('kuliga-tx-', ''));
        } else if (orderId.startsWith('kuliga-')) {
            // Очень старый формат: kuliga-{bookingId} - ищем транзакцию по booking_id
            const oldBookingId = Number(orderId.replace('kuliga-', ''));
            const txResult = await pool.query(
                `SELECT id FROM kuliga_transactions WHERE booking_id = $1 LIMIT 1`,
                [oldBookingId]
            );
            if (!txResult.rows.length) {
                console.warn(`⚠️ Транзакция для booking #${oldBookingId} не найдена`);
                return res.status(200).send('OK');
            }
            transactionId = txResult.rows[0].id;
        } else {
            console.warn(`⚠️ Неизвестный формат orderId: ${orderId}`);
            return res.status(200).send('OK');
        }
        let bookingId = null;
        let errorMessage = null;
        let processed = false;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Находим транзакцию
            const transactionResult = await client.query(
                `SELECT id, booking_id, client_id, amount, status as tx_status, type, provider_raw_data
                 FROM kuliga_transactions
                 WHERE id = $1
                 FOR UPDATE`,
                [transactionId]
            );
            
            // Логируем provider_raw_data для отладки
            if (transactionResult.rows.length > 0) {
                const rawDataFromDb = transactionResult.rows[0].provider_raw_data;
                console.log(`🔍 [Webhook] provider_raw_data из БД (тип: ${typeof rawDataFromDb}):`, 
                    typeof rawDataFromDb === 'string' ? rawDataFromDb.substring(0, 300) : JSON.stringify(rawDataFromDb).substring(0, 300));
            }

            if (!transactionResult.rows.length) {
                await client.query('ROLLBACK');
                errorMessage = `Транзакция #${transactionId} не найдена`;
                console.error(`⚠️ ${errorMessage}`);
                
                // Логируем
                await logWebhook({
                    provider: providerName,
                    webhookType,
                    paymentId,
                    orderId,
                    bookingId: null,
                    status,
                    amount,
                    paymentMethod,
                    rawPayload: payload,
                    headers,
                    signatureValid: true,
                    processed: false,
                    errorMessage
                });
                
                return res.status(200).send('OK');
            }

            const transaction = transactionResult.rows[0];
            bookingId = transaction.booking_id;
            const transactionType = transaction.type || 'payment';

            // Определяем статус платежа
            const isSuccess = status === 'SUCCESS';
            const isFailed = status === 'FAILED';
            const isRefunded = status === 'REFUNDED';
            const isPending = status === 'PENDING';

            // Проверяем, является ли это пополнением кошелька
            // Пополнение кошелька: booking_id = NULL и есть walletRefillData в provider_raw_data
            let isWalletRefill = false;
            if (!bookingId) {
                try {
                    const rawData = typeof transaction.provider_raw_data === 'string' 
                        ? JSON.parse(transaction.provider_raw_data) 
                        : transaction.provider_raw_data;
                    isWalletRefill = !!(rawData && rawData.walletRefillData);
                } catch (e) {
                    // Игнорируем ошибки парсинга
                }
            }

            console.log(`📝 Обрабатываем вебхук для transaction #${transactionId}:`, {
                transactionType,
                isWalletRefill,
                bookingId,
                paymentStatus: status,
                isSuccess,
                isFailed,
                isRefunded
            });

            // ОБРАБОТКА ПОПОЛНЕНИЯ КОШЕЛЬКА
            if (isWalletRefill) {
                if (isSuccess) {
                    console.log(`💰 Пополнение кошелька успешно (transaction #${transactionId})`);
                    
                    // Извлекаем данные пополнения
                    let rawData = {};
                    try {
                        if (typeof transaction.provider_raw_data === 'string') {
                            rawData = JSON.parse(transaction.provider_raw_data);
                        } else if (transaction.provider_raw_data) {
                            rawData = transaction.provider_raw_data;
                        }
                    } catch (parseError) {
                        console.error(`❌ [Webhook] Ошибка парсинга provider_raw_data для пополнения кошелька:`, parseError);
                        rawData = {};
                    }
                    
                    const walletRefillData = rawData.walletRefillData;
                    
                    if (!walletRefillData || !walletRefillData.client_id) {
                        await client.query('ROLLBACK');
                        errorMessage = `Данные пополнения кошелька не найдены в транзакции #${transactionId}`;
                        console.error(`⚠️ ${errorMessage}`);
                        
                        await logWebhook({
                            provider: providerName,
                            webhookType,
                            paymentId,
                            orderId,
                            bookingId: null,
                            status,
                            amount,
                            paymentMethod,
                            rawPayload: payload,
                            headers,
                            signatureValid: true,
                            processed: false,
                            errorMessage
                        });
                        
                        return res.status(200).send('OK');
                    }
                    
                    // Пополняем баланс кошелька
                    await client.query(
                        `UPDATE wallets 
                         SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
                         WHERE client_id = $2`,
                        [transaction.amount, walletRefillData.client_id]
                    );
                    
                    // Получаем wallet_id для создания транзакции
                    const walletResult = await client.query(
                        'SELECT id FROM wallets WHERE client_id = $1',
                        [walletRefillData.client_id]
                    );
                    
                    if (walletResult.rows.length > 0) {
                        const walletId = walletResult.rows[0].id;
                        
                        // Создаем запись в transactions
                        await client.query(
                            `INSERT INTO transactions (wallet_id, amount, type, description, created_at)
                             VALUES ($1, $2, 'refill', $3, CURRENT_TIMESTAMP)`,
                            [walletId, transaction.amount, `Пополнение через интернет-эквайринг`]
                        );
                    }
                    
                    // Обновляем статус транзакции
                    await client.query(
                        `UPDATE kuliga_transactions 
                         SET status = 'completed', updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [transactionId]
                    );
                    
                    await client.query('COMMIT');
                    
                    // Отправляем уведомление клиенту в Telegram
                    try {
                        const clientResult = await pool.query(
                            'SELECT telegram_id, full_name FROM clients WHERE id = $1',
                            [walletRefillData.client_id]
                        );
                        
                        if (clientResult.rows.length > 0 && clientResult.rows[0].telegram_id) {
                            const { telegram_id, full_name } = clientResult.rows[0];
                            
                            // Получаем новый баланс
                            const balanceResult = await pool.query(
                                'SELECT balance FROM wallets WHERE client_id = $1',
                                [walletRefillData.client_id]
                            );
                            const newBalance = parseFloat(balanceResult.rows[0]?.balance || 0);
                            
                            const bot = require('../bot/client-bot').bot;
                            await bot.sendMessage(
                                telegram_id,
                                `✅ <b>Кошелек успешно пополнен!</b>\n\n` +
                                `💰 Сумма пополнения: ${transaction.amount.toFixed(2)} ₽\n` +
                                `💵 Новый баланс: ${newBalance.toFixed(2)} ₽\n\n` +
                                `Спасибо за пополнение! Теперь вы можете использовать средства для покупки сертификатов и оплаты тренировок.`,
                                { parse_mode: 'HTML' }
                            );
                            
                            console.log(`✅ Уведомление о пополнении кошелька отправлено клиенту ${full_name} (telegram_id: ${telegram_id})`);
                        }
                    } catch (notifyError) {
                        console.error('❌ Ошибка при отправке уведомления о пополнении кошелька:', notifyError);
                        // Не прерываем выполнение, так как основная операция успешна
                    }
                    
                    processed = true;
                    console.log(`✅ Пополнение кошелька обработано успешно (transaction #${transactionId})`);
                    
                } else if (isFailed || isRefunded) {
                    // Обновляем статус транзакции на failed
                    await client.query(
                        `UPDATE kuliga_transactions 
                         SET status = 'failed', updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [transactionId]
                    );
                    
                    await client.query('COMMIT');
                    processed = true;
                    console.log(`❌ Пополнение кошелька не удалось (transaction #${transactionId})`);
                }
                
                // Логируем webhook
                await logWebhook({
                    provider: providerName,
                    webhookType,
                    paymentId,
                    orderId,
                    bookingId: null,
                    status,
                    amount,
                    paymentMethod,
                    rawPayload: payload,
                    headers,
                    signatureValid: true,
                    processed,
                    errorMessage: null
                });
                
                return res.status(200).send('OK');
            }

            // НОВАЯ ЛОГИКА: Если оплата успешна и бронирование ещё не создано - создаём его
            if (isSuccess && !bookingId) {
                console.log(`🔨 Создаём бронирование для успешного платежа (transaction #${transactionId})`);
                
                // Извлекаем данные бронирования из provider_raw_data
                // provider_raw_data может быть строкой (JSON) или объектом
                let rawData = {};
                try {
                    if (typeof transaction.provider_raw_data === 'string') {
                        rawData = JSON.parse(transaction.provider_raw_data);
                    } else if (transaction.provider_raw_data) {
                        rawData = transaction.provider_raw_data;
                    }
                } catch (parseError) {
                    console.error(`❌ [Webhook] Ошибка парсинга provider_raw_data для транзакции #${transactionId}:`, parseError);
                    rawData = {};
                }
                
                const bookingData = rawData.bookingData;
                
                // Логируем данные для отладки
                console.log(`🔍 [Webhook] Извлечение bookingData из транзакции #${transactionId}:`);
                console.log(`   - provider_raw_data тип: ${typeof transaction.provider_raw_data}`);
                console.log(`   - rawData существует: ${!!rawData}`);
                console.log(`   - rawData ключи: ${rawData ? Object.keys(rawData).join(', ') : 'нет'}`);
                console.log(`   - bookingData существует: ${!!bookingData}`);
                if (bookingData) {
                    console.log(`   ✅ bookingData найден:`);
                    console.log(`      - client_id: ${bookingData.client_id}`);
                    console.log(`      - client_email: ${bookingData.client_email || 'ОТСУТСТВУЕТ'}`);
                    console.log(`      - client_name: ${bookingData.client_name || 'ОТСУТСТВУЕТ'}`);
                    console.log(`      - booking_type: ${bookingData.booking_type}`);
                    console.log(`      - group_training_id: ${bookingData.group_training_id || 'ОТСУТСТВУЕТ'}`);
                    console.log(`      - program_id: ${bookingData.program_id || 'ОТСУТСТВУЕТ'}`);
                    console.log(`      - program_name: ${bookingData.program_name || 'ОТСУТСТВУЕТ'}`);
                    console.log(`      - participants_count: ${bookingData.participants_count || 'ОТСУТСТВУЕТ'}`);
                } else {
                    console.error(`❌ [Webhook] bookingData отсутствует в rawData!`);
                    console.error(`   rawData содержимое:`, JSON.stringify(rawData).substring(0, 1000));
                    console.error(`   provider_raw_data (первые 500 символов):`, 
                        typeof transaction.provider_raw_data === 'string' 
                            ? transaction.provider_raw_data.substring(0, 500)
                            : JSON.stringify(transaction.provider_raw_data).substring(0, 500));
                }
                
                if (!bookingData) {
                    await client.query('ROLLBACK');
                    errorMessage = `Данные бронирования не найдены в транзакции #${transactionId}`;
                    console.error(`⚠️ ${errorMessage}`);
                    
                    await logWebhook({
                        provider: providerName,
                        webhookType,
                        paymentId,
                        orderId,
                        bookingId: null,
                        status,
                        amount,
                        paymentMethod,
                        rawPayload: payload,
                        headers,
                        signatureValid: true,
                        processed: false,
                        errorMessage
                    });
                    
                    return res.status(200).send('OK');
                }
                
                // Разделяем логику для индивидуальных и групповых бронирований
                if (bookingData.booking_type === 'individual') {
                    // ИНДИВИДУАЛЬНОЕ БРОНИРОВАНИЕ: Проверяем статус слота
                    // Может быть 'hold' (наш hold) или 'available' (hold истёк или снят фоновой джобой)
                    const slotCheck = await client.query(
                        `SELECT status, hold_transaction_id FROM kuliga_schedule_slots WHERE id = $1 FOR UPDATE`,
                        [bookingData.slot_id]
                    );
                    
                    if (!slotCheck.rows.length) {
                        await client.query('ROLLBACK');
                        errorMessage = `Слот #${bookingData.slot_id} не существует`;
                        console.error(`⚠️ ${errorMessage}`);
                        
                        await logWebhook({
                            provider: providerName,
                            webhookType,
                            paymentId,
                            orderId,
                            bookingId: null,
                            status,
                            amount,
                            paymentMethod,
                            rawPayload: payload,
                            headers,
                            signatureValid: true,
                            processed: false,
                            errorMessage
                        });
                        
                        return res.status(200).send('OK');
                    }
                    
                    const slotStatus = slotCheck.rows[0].status;
                    const slotHoldTransactionId = slotCheck.rows[0].hold_transaction_id;
                    
                    // Проверяем: слот должен быть либо 'hold' с нашим transaction_id, либо 'available'
                    if (slotStatus === 'hold' && slotHoldTransactionId !== transactionId) {
                        // Hold держит другая транзакция - конфликт!
                        await client.query('ROLLBACK');
                        errorMessage = `Слот #${bookingData.slot_id} заблокирован другой транзакцией (#${slotHoldTransactionId})`;
                        console.error(`⚠️ ${errorMessage}`);
                        
                        await logWebhook({
                            provider: providerName,
                            webhookType,
                            paymentId,
                            orderId,
                            bookingId: null,
                            status,
                            amount,
                            paymentMethod,
                            rawPayload: payload,
                            headers,
                            signatureValid: true,
                            processed: false,
                            errorMessage
                        });
                        
                        return res.status(200).send('OK');
                    }
                    
                    if (slotStatus !== 'hold' && slotStatus !== 'available') {
                        // Слот уже занят (booked, group, blocked)
                        await client.query('ROLLBACK');
                        errorMessage = `Слот #${bookingData.slot_id} уже занят (статус: ${slotStatus})`;
                        console.error(`⚠️ ${errorMessage}`);
                        
                        await logWebhook({
                            provider: providerName,
                            webhookType,
                            paymentId,
                            orderId,
                            bookingId: null,
                            status,
                            amount,
                            paymentMethod,
                            rawPayload: payload,
                            headers,
                            signatureValid: true,
                            processed: false,
                            errorMessage
                        });
                        
                        return res.status(200).send('OK');
                    }
                    
                    // Резервируем слот (hold → booked или available → booked)
                    await client.query(
                        `UPDATE kuliga_schedule_slots
                         SET status = 'booked',
                             hold_until = NULL,
                             hold_transaction_id = NULL,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [bookingData.slot_id]
                    );
                    
                    console.log(`🔓 Слот #${bookingData.slot_id}: ${slotStatus} → booked`);
                    
                } else if (bookingData.booking_type === 'group') {
                    let groupTrainingId = bookingData.group_training_id;
                    
                    // Если это "своя группа" (group_training_id === null), создаем новую групповую тренировку
                    if (!groupTrainingId && bookingData.is_own_group) {
                        console.log(`🔨 Создание новой групповой тренировки для "своей группы" (transaction #${transactionId})`);
                        
                        // Проверяем, не занят ли слот другой групповой тренировкой
                        if (bookingData.slot_id) {
                            const existingTrainingCheck = await client.query(
                                `SELECT id, status, current_participants, max_participants
                                 FROM kuliga_group_trainings
                                 WHERE slot_id = $1
                                   AND date = $2
                                   AND start_time = $3
                                   AND status IN ('open', 'confirmed')
                                 FOR UPDATE`,
                                [bookingData.slot_id, bookingData.date, bookingData.start_time]
                            );
                            
                            if (existingTrainingCheck.rows.length > 0) {
                                // Слот уже занят групповой тренировкой - используем существующую
                                const existingTraining = existingTrainingCheck.rows[0];
                                groupTrainingId = existingTraining.id;
                                
                                // Проверяем, есть ли свободные места
                                const freePlaces = existingTraining.max_participants - existingTraining.current_participants;
                                if (freePlaces < bookingData.participants_count) {
                                    await client.query('ROLLBACK');
                                    errorMessage = `В этой групповой тренировке недостаточно свободных мест (доступно: ${freePlaces}, требуется: ${bookingData.participants_count})`;
                                    console.error(`⚠️ ${errorMessage}`);
                                    
                                    await logWebhook({
                                        provider: providerName,
                                        webhookType,
                                        paymentId,
                                        orderId,
                                        bookingId: null,
                                        status,
                                        amount,
                                        paymentMethod,
                                        rawPayload: payload,
                                        headers,
                                        signatureValid: true,
                                        processed: false,
                                        errorMessage
                                    });
                                    
                                    return res.status(200).send('OK');
                                }
                                
                                console.log(`✅ Используем существующую групповую тренировку #${groupTrainingId}`);
                            } else {
                                // Создаем новую закрытую групповую тренировку
                                const participantsCount = bookingData.participants_count || 1;
                                const maxParticipants = Math.max(participantsCount, 4); // Минимум 4 места
                                
                                const groupTrainingResult = await client.query(
                                    `INSERT INTO kuliga_group_trainings (
                                        instructor_id, slot_id, date, start_time, end_time,
                                        sport_type, level, description, price_per_person,
                                        min_participants, max_participants, current_participants,
                                        status, is_private, location
                                    ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8, $9, $10, 'confirmed', TRUE, $11)
                                    RETURNING id`,
                                    [
                                        bookingData.instructor_id || null,
                                        bookingData.slot_id,
                                        bookingData.date,
                                        bookingData.start_time,
                                        bookingData.end_time,
                                        bookingData.sport_type,
                                        bookingData.price_per_person || 0,
                                        participantsCount,
                                        maxParticipants,
                                        participantsCount,
                                        bookingData.location || 'kuliga'
                                    ]
                                );
                                
                                groupTrainingId = groupTrainingResult.rows[0].id;
                                
                                // Обновляем статус слота
                                await client.query(
                                    `UPDATE kuliga_schedule_slots
                                     SET status = 'group', updated_at = CURRENT_TIMESTAMP
                                     WHERE id = $1`,
                                    [bookingData.slot_id]
                                );
                                
                                console.log(`✅ Создана новая закрытая групповая тренировка #${groupTrainingId} для слота #${bookingData.slot_id}`);
                            }
                        } else {
                            await client.query('ROLLBACK');
                            errorMessage = `Для "своей группы" требуется slot_id`;
                            console.error(`⚠️ ${errorMessage}`);
                            
                            await logWebhook({
                                provider: providerName,
                                webhookType,
                                paymentId,
                                orderId,
                                bookingId: null,
                                status,
                                amount,
                                paymentMethod,
                                rawPayload: payload,
                                headers,
                                signatureValid: true,
                                processed: false,
                                errorMessage
                            });
                            
                            return res.status(200).send('OK');
                        }
                        
                        // Обновляем bookingData с созданным group_training_id
                        bookingData.group_training_id = groupTrainingId;
                    }
                    
                    // ГРУППОВОЕ БРОНИРОВАНИЕ: Проверяем доступность мест в групповой тренировке
                    // ВАЖНО: Пересчитываем current_participants из реальных подтверждённых бронирований
                    const groupTrainingCheck = await client.query(
                        `SELECT 
                                kgt.id, 
                                COALESCE((
                                    SELECT SUM(kb.participants_count)
                                    FROM kuliga_bookings kb
                                    WHERE kb.group_training_id = kgt.id AND kb.status = 'confirmed'
                                ), 0)::INTEGER as current_participants,
                                kgt.max_participants, 
                                kgt.status, 
                                kgt.instructor_id
                         FROM kuliga_group_trainings kgt
                         WHERE kgt.id = $1
                         FOR UPDATE`,
                        [groupTrainingId]
                    );
                    
                    if (!groupTrainingCheck.rows.length) {
                        await client.query('ROLLBACK');
                        errorMessage = `Групповая тренировка #${bookingData.group_training_id} не найдена`;
                        console.error(`⚠️ ${errorMessage}`);
                        
                        // Возвращаем временно забронированные места
                        await pool.query(
                            `UPDATE kuliga_group_trainings
                             SET current_participants = GREATEST(0, current_participants - $1),
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = $2`,
                            [bookingData.participants_count, bookingData.group_training_id]
                        );
                        
                        await logWebhook({
                            provider: providerName,
                            webhookType,
                            paymentId,
                            orderId,
                            bookingId: null,
                            status,
                            amount,
                            paymentMethod,
                            rawPayload: payload,
                            headers,
                            signatureValid: true,
                            processed: false,
                            errorMessage
                        });
                        
                        return res.status(200).send('OK');
                    }
                    
                    const groupTraining = groupTrainingCheck.rows[0];
                    
                    // Проверяем статус тренировки
                    if (groupTraining.status !== 'open' && groupTraining.status !== 'confirmed') {
                        await client.query('ROLLBACK');
                        errorMessage = `Групповая тренировка #${bookingData.group_training_id} недоступна для бронирования (статус: ${groupTraining.status})`;
                        console.error(`⚠️ ${errorMessage}`);
                        
                        // Возвращаем временно забронированные места
                        await pool.query(
                            `UPDATE kuliga_group_trainings
                             SET current_participants = GREATEST(0, current_participants - $1),
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = $2`,
                            [bookingData.participants_count, bookingData.group_training_id]
                        );
                        
                        await logWebhook({
                            provider: providerName,
                            webhookType,
                            paymentId,
                            orderId,
                            bookingId: null,
                            status,
                            amount,
                            paymentMethod,
                            rawPayload: payload,
                            headers,
                            signatureValid: true,
                            processed: false,
                            errorMessage
                        });
                        
                        return res.status(200).send('OK');
                    }
                    
                    // Проверяем доступность мест (используем пересчитанное current_participants + временное резервирование)
                    // Учитываем, что места уже временно забронированы (current_participants в таблице увеличен)
                    // Но мы проверяем по реальному количеству confirmed бронирований
                    const realCurrentParticipants = groupTraining.current_participants;
                    const participantsToAdd = Number(bookingData.participants_count) || 1;
                    
                    if (realCurrentParticipants + participantsToAdd > groupTraining.max_participants) {
                        await client.query('ROLLBACK');
                        errorMessage = `Недостаточно мест в групповой тренировке #${bookingData.group_training_id} (занято: ${realCurrentParticipants}/${groupTraining.max_participants}, требуется: ${participantsToAdd})`;
                        console.error(`⚠️ ${errorMessage}`);
                        
                        // Возвращаем временно забронированные места
                        await pool.query(
                            `UPDATE kuliga_group_trainings
                             SET current_participants = GREATEST(0, current_participants - $1),
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = $2`,
                            [participantsToAdd, bookingData.group_training_id]
                        );
                        
                        await logWebhook({
                            provider: providerName,
                            webhookType,
                            paymentId,
                            orderId,
                            bookingId: null,
                            status,
                            amount,
                            paymentMethod,
                            rawPayload: payload,
                            headers,
                            signatureValid: true,
                            processed: false,
                            errorMessage
                        });
                        
                        return res.status(200).send('OK');
                    }
                    
                    // Места уже забронированы временно, счетчик уже увеличен - ничего дополнительно делать не нужно
                    console.log(`✅ Места в групповой тренировке #${bookingData.group_training_id} подтверждены (transaction #${transactionId})`);
                }
                
                // Обработка частичной оплаты (если есть разница)
                if (bookingData.is_partial_payment && bookingData.price_difference) {
                    console.log(`💰 Обработка частичной оплаты: разница ${bookingData.price_difference} ₽, текущий баланс ${bookingData.current_balance} ₽`);
                    
                    // Получаем wallet_id клиента
                    const walletResult = await client.query(
                        `SELECT w.id FROM wallets w WHERE w.client_id = $1`,
                        [bookingData.client_id]
                    );
                    
                    if (walletResult.rows.length > 0) {
                        const walletId = walletResult.rows[0].id;
                        
                        // Зачисляем разницу на кошелек
                        await client.query(
                            `UPDATE wallets 
                             SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
                             WHERE id = $2`,
                            [bookingData.price_difference, walletId]
                        );
                        
                        // Создаем транзакцию пополнения для разницы
                        await client.query(
                            `INSERT INTO transactions (wallet_id, amount, type, description)
                             VALUES ($1, $2, 'refill', $3)`,
                            [
                                walletId,
                                bookingData.price_difference,
                                `Пополнение кошелька (доплата за тренировку)`
                            ]
                        );
                        
                        console.log(`✅ Зачислено ${bookingData.price_difference} ₽ на кошелек клиента #${bookingData.client_id}`);
                    }
                }
                
                // Списываем полную сумму с кошелька (если это оплата из бота)
                if (rawData.source === 'bot') {
                    const walletResult = await client.query(
                        `SELECT w.id FROM wallets w WHERE w.client_id = $1`,
                        [bookingData.client_id]
                    );
                    
                    if (walletResult.rows.length > 0) {
                        const walletId = walletResult.rows[0].id;
                        const fullPrice = bookingData.price_total;
                        
                        // Списываем полную сумму с кошелька
                        await client.query(
                            `UPDATE wallets 
                             SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP 
                             WHERE id = $2`,
                            [fullPrice, walletId]
                        );
                        
                        // Создаем транзакцию списания
                        const description = `Групповая тренировка Кулига: ${bookingData.sport_type === 'ski' ? 'лыжи' : 'сноуборд'} ${bookingData.date}, ${String(bookingData.start_time).substring(0, 5)}`;
                        await client.query(
                            `INSERT INTO transactions (wallet_id, amount, type, description)
                             VALUES ($1, $2, 'payment', $3)`,
                            [walletId, -fullPrice, description]
                        );
                        
                        console.log(`✅ Списано ${fullPrice} ₽ с кошелька клиента #${bookingData.client_id}`);
                    }
                }
                
                // Создаём бронирование
                console.log(`🔨 Параметры для создания бронирования (transaction #${transactionId}):`, {
                    client_id: bookingData.client_id,
                    booking_type: bookingData.booking_type,
                    group_training_id: bookingData.group_training_id,
                    instructor_id: bookingData.instructor_id,
                    slot_id: bookingData.slot_id,
                    date: bookingData.date,
                    start_time: bookingData.start_time,
                    end_time: bookingData.end_time,
                    sport_type: bookingData.sport_type,
                    participants_count: bookingData.participants_count,
                    location: bookingData.location
                });
                
                // Формируем запрос INSERT в зависимости от типа бронирования
                let insertQuery, insertParams;
                
                if (bookingData.booking_type === 'individual') {
                    insertQuery = `INSERT INTO kuliga_bookings (
                        client_id,
                        booking_type,
                        instructor_id,
                        slot_id,
                        date,
                        start_time,
                        end_time,
                        sport_type,
                        participants_count,
                        participants_names,
                        participants_birth_years,
                        price_total,
                        price_per_person,
                        price_id,
                        notification_method,
                        payer_rides,
                        location,
                        status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'confirmed')
                    RETURNING id`;
                    
                    insertParams = [
                        bookingData.client_id,
                        bookingData.booking_type,
                        bookingData.instructor_id,
                        bookingData.slot_id,
                        bookingData.date,
                        bookingData.start_time,
                        bookingData.end_time,
                        bookingData.sport_type,
                        bookingData.participants_count,
                        bookingData.participants_names,
                        bookingData.participants_birth_years,
                        bookingData.price_total,
                        bookingData.price_per_person,
                        bookingData.price_id,
                        bookingData.notification_method,
                        bookingData.payer_rides,
                        bookingData.location
                    ];
                } else if (bookingData.booking_type === 'group') {
                    insertQuery = `INSERT INTO kuliga_bookings (
                        client_id,
                        booking_type,
                        group_training_id,
                        date,
                        start_time,
                        end_time,
                        sport_type,
                        participants_count,
                        participants_names,
                        price_total,
                        price_per_person,
                        location,
                        status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed')
                    RETURNING id`;
                    
                    insertParams = [
                        bookingData.client_id,
                        bookingData.booking_type,
                        bookingData.group_training_id,
                        bookingData.date,
                        bookingData.start_time,
                        bookingData.end_time,
                        bookingData.sport_type,
                        bookingData.participants_count,
                        bookingData.participants_names,
                        bookingData.price_total,
                        bookingData.price_per_person,
                        bookingData.location
                    ];
                } else {
                    throw new Error(`Неизвестный тип бронирования: ${bookingData.booking_type}`);
                }
                
                const newBookingResult = await client.query(insertQuery, insertParams);
                
                if (!newBookingResult.rows || !newBookingResult.rows[0]) {
                    throw new Error('INSERT INTO kuliga_bookings не вернул id');
                }
                
                bookingId = newBookingResult.rows[0].id;
                console.log(`✅ Бронирование #${bookingId} создано после успешной оплаты (transaction #${transactionId})`);
                
                // booking_id будет обновлен в основном запросе UPDATE транзакции ниже
                
                // Отправляем уведомления (асинхронно, после COMMIT)
                setImmediate(async () => {
                    try {
                        const { notifyAdminNaturalSlopeTrainingBooking } = require('../bot/admin-notify');
                        const { notifyInstructorKuligaTrainingBooking } = require('../bot/admin-notify');
                        
                        // Получаем данные инструктора (для индивидуальных или из групповой тренировки)
                        let instructorResult = null;
                        let instructorId = null;
                        
                        if (bookingData.booking_type === 'individual') {
                            // Для индивидуальных тренировок сначала пробуем получить instructor_id из bookingData
                            instructorId = bookingData.instructor_id;
                            
                            // Если instructor_id не в bookingData, получаем его из слота
                            if (!instructorId && bookingData.slot_id) {
                                console.log(`🔍 instructor_id не найден в bookingData, получаем из слота #${bookingData.slot_id}`);
                                const slotResult = await pool.query(
                                    'SELECT instructor_id FROM kuliga_schedule_slots WHERE id = $1',
                                    [bookingData.slot_id]
                                );
                                if (slotResult.rows.length && slotResult.rows[0].instructor_id) {
                                    instructorId = slotResult.rows[0].instructor_id;
                                    console.log(`✅ Получен instructor_id=${instructorId} из слота #${bookingData.slot_id}`);
                                }
                            }
                            
                            if (instructorId) {
                                instructorResult = await pool.query(
                                    'SELECT full_name, telegram_id, admin_percentage FROM kuliga_instructors WHERE id = $1',
                                    [instructorId]
                                );
                                if (instructorResult.rows.length === 0) {
                                    console.log(`⚠️ Инструктор с id=${instructorId} не найден в базе`);
                                    instructorResult = null;
                                }
                            } else {
                                console.log(`⚠️ instructor_id не найден для индивидуальной тренировки (slot_id=${bookingData.slot_id})`);
                            }
                        } else if (bookingData.booking_type === 'group' && bookingData.group_training_id) {
                            // Для групповых тренировок получаем инструктора из групповой тренировки
                            const groupTrainingResult = await pool.query(
                                `SELECT instructor_id FROM kuliga_group_trainings WHERE id = $1`,
                                [bookingData.group_training_id]
                            );
                            if (groupTrainingResult.rows.length && groupTrainingResult.rows[0].instructor_id) {
                                instructorId = groupTrainingResult.rows[0].instructor_id;
                                instructorResult = await pool.query(
                                    'SELECT full_name, telegram_id, admin_percentage FROM kuliga_instructors WHERE id = $1',
                                    [instructorId]
                                );
                                if (instructorResult.rows.length === 0) {
                                    console.log(`⚠️ Инструктор с id=${instructorId} не найден в базе`);
                                    instructorResult = null;
                                }
                            } else {
                                console.log(`⚠️ instructor_id не найден в групповой тренировке #${bookingData.group_training_id}`);
                            }
                        }
                        
                        // Формируем имя участника(ов)
                        const participantName = bookingData.participants_names && bookingData.participants_names.length > 0
                            ? bookingData.participants_names.join(', ')
                            : bookingData.client_name;
                        
                        // Уведомление администратору
                        // Для программ добавляем информацию о программе
                        const adminNotificationData = {
                            client_name: bookingData.client_name,
                            client_phone: bookingData.client_phone,
                            participant_name: participantName,
                            date: bookingData.date,
                            time: bookingData.start_time,
                            sport_type: bookingData.sport_type,
                            instructor_name: bookingData.instructor_name || (instructorResult?.rows[0]?.full_name) || 'Не назначен',
                            price: bookingData.price_total,
                            booking_source: 'website',
                            location: bookingData.location,
                            booking_type: bookingData.booking_type,
                            participants_count: bookingData.participants_count || 1
                        };
                        
                        // Если это программа, добавляем информацию о программе
                        if (bookingData.program_id || bookingData.program_name) {
                            adminNotificationData.program_name = bookingData.program_name || 'Программа';
                            console.log(`📋 [Webhook] Уведомление администратору о бронировании программы: ${adminNotificationData.program_name}`);
                        }
                        
                        await notifyAdminNaturalSlopeTrainingBooking(adminNotificationData);
                        
                        // Уведомление инструктору (если он назначен)
                        if (instructorResult && instructorResult.rows.length > 0) {
                            const instructor = instructorResult.rows[0];
                            if (instructor.telegram_id) {
                                console.log(`📤 Отправка уведомления инструктору ${instructor.full_name} (telegram_id=${instructor.telegram_id})`);
                                await notifyInstructorKuligaTrainingBooking({
                                    booking_type: bookingData.booking_type,
                                    client_name: bookingData.client_name,
                                    participant_name: participantName,
                                    client_phone: bookingData.client_phone,
                                    instructor_name: instructor.full_name,
                                    instructor_telegram_id: instructor.telegram_id,
                                    admin_percentage: instructor.admin_percentage,
                                    date: bookingData.date,
                                    time: bookingData.start_time,
                                    price: bookingData.price_total,
                                    location: bookingData.location,
                                    participants_count: bookingData.participants_count || 1
                                });
                            } else {
                                console.log(`⚠️ Инструктор ${instructor.full_name} не зарегистрирован в Telegram (telegram_id отсутствует)`);
                            }
                        } else {
                            console.log(`⚠️ Уведомление инструктору не отправлено: инструктор не найден или не назначен`);
                        }

                        // Email уведомление клиенту (если есть email)
                        console.log(`📧 Проверка email для отправки: client_email=${bookingData.client_email}, валидный=${bookingData.client_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingData.client_email)}`);
                        if (bookingData.client_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingData.client_email)) {
                            try {
                                const EmailService = require('../services/emailService');
                                const emailTemplateService = require('../services/email-template-service');
                                const emailService = new EmailService();
                                
                                const htmlContent = await emailTemplateService.generateBookingConfirmationEmail({
                                    client_id: bookingData.client_id,
                                    client_name: bookingData.client_name,
                                    booking_type: bookingData.booking_type,
                                    date: bookingData.date,
                                    start_time: bookingData.start_time,
                                    end_time: bookingData.end_time,
                                    sport_type: bookingData.sport_type,
                                    location: bookingData.location,
                                    instructor_name: bookingData.instructor_name || (instructorResult?.rows[0]?.full_name) || null,
                                    participants_count: bookingData.participants_count || 1,
                                    price_total: bookingData.price_total,
                                    price_per_person: bookingData.price_per_person || null
                                });

                                const dateFormatted = emailTemplateService.formatDate(bookingData.date);
                                const subject = `✅ Подтверждение записи на тренировку - ${dateFormatted}`;
                                
                                const emailResult = await emailService.sendEmail(bookingData.client_email, subject, htmlContent);
                                if (emailResult.success) {
                                    console.log(`✅ Email уведомление отправлено клиенту ${bookingData.client_name} на ${bookingData.client_email}, messageId: ${emailResult.messageId || 'N/A'}`);
                                } else {
                                    console.error(`❌ Ошибка отправки email клиенту ${bookingData.client_name} на ${bookingData.client_email}: ${emailResult.error}`);
                                }
                            } catch (emailError) {
                                console.error('Ошибка отправки email клиенту:', emailError);
                                // Не прерываем выполнение, продолжаем работу
                            }
                        } else {
                            console.log(`⚠️ Email клиента не указан или невалиден для бронирования #${bookingId}`);
                        }

                        // Отправляем уведомление в Telegram клиенту, если платеж был из бота
                        if (rawData.source === 'bot') {
                            try {
                                const bot = require('../bot/client-bot').bot;
                                const clientResult = await pool.query(
                                    'SELECT telegram_id FROM clients WHERE id = $1',
                                    [bookingData.client_id]
                                );
                                
                                if (clientResult.rows.length > 0 && clientResult.rows[0].telegram_id) {
                                    const telegramId = clientResult.rows[0].telegram_id;
                                    
                                    // Форматируем дату и время
                                    const formatDate = (dateStr) => {
                                        const date = new Date(dateStr);
                                        const day = date.getDate().toString().padStart(2, '0');
                                        const month = (date.getMonth() + 1).toString().padStart(2, '0');
                                        const year = date.getFullYear();
                                        return `${day}.${month}.${year}`;
                                    };
                                    
                                    const formatTime = (timeStr) => {
                                        if (!timeStr) return '';
                                        const time = timeStr.toString();
                                        return time.substring(0, 5);
                                    };
                                    
                                    const dateFormatted = formatDate(bookingData.date);
                                    const timeFormatted = formatTime(bookingData.start_time);
                                    const sportText = bookingData.sport_type === 'ski' ? 'Лыжи' : 'Сноуборд';
                                    const bookingTypeText = bookingData.booking_type === 'individual' ? 'Индивидуальное занятие' : 'Групповое занятие';
                                    
                                    let message = `✅ <b>Тренировка успешно оплачена и забронирована!</b>\n\n`;
                                    message += `📅 Дата: ${dateFormatted}\n`;
                                    message += `⏰ Время: ${timeFormatted}\n`;
                                    message += `🎿 Тип: ${bookingTypeText}, ${sportText}\n`;
                                    message += `💰 Сумма: ${bookingData.price_total.toFixed(2)} ₽\n`;
                                    
                                    if (bookingData.participants_count > 1) {
                                        message += `👥 Участников: ${bookingData.participants_count}\n`;
                                    }
                                    
                                    message += `\n🎉 Ждем вас на тренировке!`;
                                    
                                    await bot.sendMessage(telegramId, message, { parse_mode: 'HTML' });
                                    console.log(`✅ Уведомление в Telegram отправлено клиенту (telegram_id: ${telegramId})`);
                                }
                            } catch (telegramError) {
                                console.error('❌ Ошибка при отправке уведомления в Telegram клиенту:', telegramError);
                                // Не прерываем выполнение
                            }
                        }
                    } catch (notifyError) {
                        console.error('Ошибка при отправке уведомлений после создания бронирования:', notifyError);
                    }
                });
            }
            
            // Если бронирование уже создано (повторный webhook), загружаем его
            let booking = null;
            if (bookingId) {
                try {
                    console.log(`🔍 Ищу бронирование #${bookingId} в транзакции (transaction #${transactionId})`);
                    const bookingResult = await client.query(
                        `SELECT id, booking_type, group_training_id, participants_count, status as booking_status
                         FROM kuliga_bookings
                         WHERE id = $1
                         FOR UPDATE`,
                        [bookingId]
                    );
                    
                    if (bookingResult.rows.length > 0) {
                        booking = bookingResult.rows[0];
                        console.log(`📝 Найдено существующее бронирование #${bookingId}:`, {
                            currentBookingStatus: booking.booking_status,
                            paymentStatus: status
                        });
                    } else {
                        console.warn(`⚠️ Бронирование #${bookingId} не найдено в БД после создания (transaction #${transactionId})`);
                    }
                } catch (bookingSelectError) {
                    console.error(`❌ Ошибка при поиске бронирования #${bookingId} (transaction #${transactionId}):`, bookingSelectError);
                    // Продолжаем выполнение, так как это не критично
                }
            }

            // Обновляем транзакцию (по transactionId, а не по booking_id)
            // КРИТИЧНО: сохраняем bookingData при обновлении provider_raw_data
            let updatedRawData = payload;
            
            // Всегда пытаемся сохранить bookingData из существующих данных
            try {
                let existingRawData = {};
                if (transaction.provider_raw_data) {
                    if (typeof transaction.provider_raw_data === 'string') {
                        existingRawData = JSON.parse(transaction.provider_raw_data);
                    } else {
                        existingRawData = transaction.provider_raw_data;
                    }
                }
                
                console.log(`🔍 [Webhook] Проверка сохранения bookingData:`, {
                    hasExistingRawData: !!transaction.provider_raw_data,
                    hasBookingData: !!existingRawData.bookingData,
                    bookingDataClientId: existingRawData.bookingData?.client_id,
                    bookingDataClientEmail: existingRawData.bookingData?.client_email
                });
                
                // Сохраняем bookingData, если он был
                if (existingRawData.bookingData) {
                    updatedRawData = {
                        ...payload,
                        bookingData: existingRawData.bookingData // КРИТИЧНО: сохраняем bookingData
                    };
                    console.log(`✅ [Webhook] bookingData сохранен в updatedRawData: client_id=${existingRawData.bookingData.client_id}`);
                } else {
                    console.error(`❌ [Webhook] bookingData отсутствует в existingRawData! existingRawData:`, JSON.stringify(existingRawData).substring(0, 500));
                }
            } catch (e) {
                console.error(`❌ [Webhook] Ошибка при сохранении bookingData для транзакции #${transactionId}:`, e.message, e.stack);
            }
            
            console.log(`🔄 Обновляю транзакцию #${transactionId} (bookingId: ${bookingId || 'null'})`);
            
            // Для jsonb типа нужно передавать объект или валидный JSON
            // Проверяем, что updatedRawData является объектом
            if (typeof updatedRawData !== 'object' || updatedRawData === null) {
                console.error(`❌ updatedRawData не является объектом для транзакции #${transactionId}:`, typeof updatedRawData);
                throw new Error(`updatedRawData должен быть объектом, получен: ${typeof updatedRawData}`);
            }
            
            let txUpdateResult;
            try {
                console.log(`💾 Выполняю UPDATE транзакции #${transactionId}...`);
                
                // ФИНАЛЬНАЯ ПРОВЕРКА: убеждаемся, что bookingData сохранен
                if (!updatedRawData.bookingData && transaction.provider_raw_data) {
                    console.warn(`⚠️ [Webhook] bookingData отсутствует в updatedRawData, пытаемся восстановить из transaction.provider_raw_data`);
                    try {
                        let existingRawData = {};
                        if (typeof transaction.provider_raw_data === 'string') {
                            existingRawData = JSON.parse(transaction.provider_raw_data);
                        } else {
                            existingRawData = transaction.provider_raw_data;
                        }
                        if (existingRawData.bookingData) {
                            updatedRawData.bookingData = existingRawData.bookingData;
                            console.log(`✅ [Webhook] bookingData восстановлен: client_id=${existingRawData.bookingData.client_id}`);
                        }
                    } catch (e) {
                        console.error(`❌ [Webhook] Не удалось восстановить bookingData:`, e.message);
                    }
                }
                
                const jsonString = JSON.stringify(updatedRawData);
                console.log(`📦 provider_raw_data будет сохранен как jsonb, размер: ${jsonString.length} байт`);
                console.log(`📦 updatedRawData содержит bookingData: ${!!updatedRawData.bookingData}`);
                if (updatedRawData.bookingData) {
                    console.log(`📦 bookingData.client_id: ${updatedRawData.bookingData.client_id}`);
                    console.log(`📦 bookingData.client_email: ${updatedRawData.bookingData.client_email || 'ОТСУТСТВУЕТ'}`);
                }
                
                // Для jsonb типа передаем JSON строку, PostgreSQL автоматически преобразует в jsonb
                // Не используем явное приведение ::jsonb, чтобы избежать проблем
                txUpdateResult = await client.query(
                    `UPDATE kuliga_transactions
                     SET provider_status = $1::character varying(100),
                         provider_payment_id = $2::character varying(255),
                         provider_order_id = $3::character varying(255),
                         payment_method = COALESCE($4::character varying(50), payment_method),
                         provider_raw_data = $5::jsonb,
                         booking_id = COALESCE($7, booking_id),
                         status = CASE
                             WHEN $1::text = 'SUCCESS' THEN 'completed'::character varying(20)
                             WHEN $1::text = 'FAILED' THEN 'failed'::character varying(20)
                             WHEN $1::text = 'REFUNDED' THEN 'cancelled'::character varying(20)
                             WHEN $1::text = 'PENDING' THEN 'pending'::character varying(20)
                             ELSE status
                         END,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $6
                     RETURNING id, status, booking_id`,
                    [
                        status,
                        paymentId,
                        orderId,
                        paymentMethod || 'card',
                        jsonString, // Передаем JSON строку, PostgreSQL автоматически преобразует в jsonb
                        transactionId,
                        bookingId || null // Обновляем booking_id, если бронирование было создано
                    ]
                );
                console.log(`✅ UPDATE транзакции #${transactionId} выполнен успешно, результат:`, {
                    rows: txUpdateResult.rows.length,
                    id: txUpdateResult.rows[0]?.id,
                    status: txUpdateResult.rows[0]?.status,
                    booking_id: txUpdateResult.rows[0]?.booking_id
                });
            } catch (updateError) {
                console.error(`❌ Ошибка при UPDATE транзакции #${transactionId}:`, updateError);
                console.error(`   Сообщение:`, updateError.message);
                console.error(`   Код:`, updateError.code);
                console.error(`   Детали:`, updateError.detail);
                console.error(`   Позиция:`, updateError.position);
                console.error(`   Внутренний запрос:`, updateError.internalQuery);
                console.error(`   Stack trace:`, updateError.stack);
                throw updateError; // Пробрасываем ошибку дальше, чтобы вызвать ROLLBACK
            }

            if (txUpdateResult.rows.length === 0) {
                console.warn(`⚠️ Транзакция #${transactionId} не найдена`);
            } else {
                console.log(`✅ Транзакция #${transactionId} обновлена: status=${txUpdateResult.rows[0].status}`);
            }

            // Обновляем статус бронирования (если оно существует)
            if (booking) {
                console.log(`📝 Обновляю статус бронирования #${bookingId} (текущий статус: ${booking.booking_status}, isSuccess: ${isSuccess})`);
                if (isSuccess && booking.booking_status !== 'confirmed') {
                    await client.query(
                        `UPDATE kuliga_bookings
                         SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [bookingId]
                    );
                    console.log(`✅ Бронирование #${bookingId} подтверждено`);
                } else if (isFailed && booking.booking_status !== 'cancelled') {
                    await client.query(
                        `UPDATE kuliga_bookings
                         SET status = 'cancelled', 
                             cancellation_reason = 'Платеж отклонен банком', 
                             cancelled_at = CURRENT_TIMESTAMP,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [bookingId]
                    );
                    
                    // Освобождаем слот или возвращаем места в групповой тренировке
                    const rawData = transaction.provider_raw_data || {};
                    const bookingData = rawData.bookingData;
                    if (bookingData) {
                        if (bookingData.slot_id) {
                            // Индивидуальное бронирование: освобождаем слот
                            await client.query(
                                `UPDATE kuliga_schedule_slots
                                 SET status = 'available', updated_at = CURRENT_TIMESTAMP
                                 WHERE id = $1`,
                                [bookingData.slot_id]
                            );
                            console.log(`🔓 Слот #${bookingData.slot_id} освобожден (платеж не прошел)`);
                        } else if (bookingData.group_training_id && bookingData.participants_count) {
                            // Групповое бронирование: возвращаем места
                            await client.query(
                                `UPDATE kuliga_group_trainings
                                 SET current_participants = current_participants - $1,
                                     updated_at = CURRENT_TIMESTAMP
                                 WHERE id = $2`,
                                [bookingData.participants_count, bookingData.group_training_id]
                            );
                            console.log(`🔓 Возвращено ${bookingData.participants_count} мест в групповой тренировке #${bookingData.group_training_id} (платеж не прошел)`);
                        }
                    }
                    
                    console.log(`❌ Бронирование #${bookingId} отменено (платеж не прошел)`);
                    
                    // Отправляем email уведомление об отмене (асинхронно)
                    setImmediate(async () => {
                        try {
                            const rawData = transaction.provider_raw_data || {};
                            const bookingData = rawData.bookingData;
                            
                            if (bookingData && bookingData.client_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingData.client_email)) {
                                const EmailService = require('../services/emailService');
                                const emailTemplateService = require('../services/email-template-service');
                                const emailService = new EmailService();
                                
                                const htmlContent = await emailTemplateService.generateBookingCancellationEmail({
                                    client_name: bookingData.client_name,
                                    booking_type: bookingData.booking_type,
                                    date: bookingData.date,
                                    start_time: bookingData.start_time,
                                    end_time: bookingData.end_time,
                                    sport_type: bookingData.sport_type,
                                    location: bookingData.location,
                                    cancellation_reason: 'Платеж отклонен банком',
                                    refund_info: null
                                });

                                const dateFormatted = emailTemplateService.formatDate(bookingData.date);
                                const subject = `❌ Отмена тренировки - ${dateFormatted}`;
                                
                                const emailResult = await emailService.sendEmail(bookingData.client_email, subject, htmlContent);
                                if (emailResult.success) {
                                    console.log(`✅ Email уведомление об отмене отправлено клиенту ${bookingData.client_name} на ${bookingData.client_email}, messageId: ${emailResult.messageId || 'N/A'}`);
                                } else {
                                    console.error(`❌ Ошибка отправки email об отмене клиенту ${bookingData.client_name} на ${bookingData.client_email}: ${emailResult.error}`);
                                }
                            }
                        } catch (emailError) {
                            console.error('Ошибка отправки email об отмене клиенту:', emailError);
                        }
                    });
                } else if (isRefunded && booking.booking_status !== 'refunded') {
                    await client.query(
                        `UPDATE kuliga_bookings
                         SET status = 'refunded', 
                             cancellation_reason = 'Возврат средств', 
                             cancelled_at = CURRENT_TIMESTAMP,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [bookingId]
                    );
                    
                    // Освобождаем слот или возвращаем места в групповой тренировке
                    const rawData = transaction.provider_raw_data || {};
                    const bookingData = rawData.bookingData;
                    if (bookingData) {
                        if (bookingData.slot_id) {
                            // Индивидуальное бронирование: освобождаем слот
                            await client.query(
                                `UPDATE kuliga_schedule_slots
                                 SET status = 'available', updated_at = CURRENT_TIMESTAMP
                                 WHERE id = $1`,
                                [bookingData.slot_id]
                            );
                            console.log(`🔓 Слот #${bookingData.slot_id} освобожден (возврат средств)`);
                        } else if (bookingData.group_training_id && bookingData.participants_count) {
                            // Групповое бронирование: возвращаем места
                            await client.query(
                                `UPDATE kuliga_group_trainings
                                 SET current_participants = current_participants - $1,
                                     updated_at = CURRENT_TIMESTAMP
                                 WHERE id = $2`,
                                [bookingData.participants_count, bookingData.group_training_id]
                            );
                            console.log(`🔓 Возвращено ${bookingData.participants_count} мест в групповой тренировке #${bookingData.group_training_id} (возврат средств)`);
                        }
                    }
                    
                    console.log(`💰 Бронирование #${bookingId} возвращено (refund)`);
                    
                    // Отправляем email уведомление о возврате (асинхронно)
                    setImmediate(async () => {
                        try {
                            const rawData = transaction.provider_raw_data || {};
                            const bookingData = rawData.bookingData;
                            
                            if (bookingData && bookingData.client_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingData.client_email)) {
                                const EmailService = require('../services/emailService');
                                const emailTemplateService = require('../services/email-template-service');
                                const emailService = new EmailService();
                                
                                const htmlContent = await emailTemplateService.generateBookingCancellationEmail({
                                    client_name: bookingData.client_name,
                                    booking_type: bookingData.booking_type,
                                    date: bookingData.date,
                                    start_time: bookingData.start_time,
                                    end_time: bookingData.end_time,
                                    sport_type: bookingData.sport_type,
                                    location: bookingData.location,
                                    cancellation_reason: 'Возврат средств',
                                    refund_info: `Средства в размере ${bookingData.price_total || 0} ₽ будут возвращены на карту в течение 3-5 рабочих дней`
                                });

                                const dateFormatted = emailTemplateService.formatDate(bookingData.date);
                                const subject = `💰 Возврат средств - ${dateFormatted}`;
                                
                                const emailResult = await emailService.sendEmail(bookingData.client_email, subject, htmlContent);
                                if (emailResult.success) {
                                    console.log(`✅ Email уведомление о возврате отправлено клиенту ${bookingData.client_name} на ${bookingData.client_email}, messageId: ${emailResult.messageId || 'N/A'}`);
                                } else {
                                    console.error(`❌ Ошибка отправки email о возврате клиенту ${bookingData.client_name} на ${bookingData.client_email}: ${emailResult.error}`);
                                }
                            }
                        } catch (emailError) {
                            console.error('Ошибка отправки email о возврате клиенту:', emailError);
                        }
                    });
                }
            } else if (isFailed) {
                // Если платёж провалился и бронирования нет - снимаем hold со слота или возвращаем места
                console.log(`❌ Платёж провалился, бронирование не создано`);
                
                const rawData = transaction.provider_raw_data || {};
                const bookingData = rawData.bookingData;
                if (bookingData) {
                    if (bookingData.slot_id) {
                        // Индивидуальное бронирование: снимаем hold со слота
                        await client.query(
                            `UPDATE kuliga_schedule_slots
                             SET status = 'available',
                                 hold_until = NULL,
                                 hold_transaction_id = NULL,
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = $1 AND hold_transaction_id = $2`,
                            [bookingData.slot_id, transactionId]
                        );
                        console.log(`🔓 Hold снят со слота #${bookingData.slot_id} (платёж провалился)`);
                    } else if (bookingData.group_training_id && bookingData.participants_count) {
                        // Групповое бронирование: возвращаем места
                        await client.query(
                            `UPDATE kuliga_group_trainings
                             SET current_participants = current_participants - $1,
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = $2`,
                            [bookingData.participants_count, bookingData.group_training_id]
                        );
                        console.log(`🔓 Возвращено ${bookingData.participants_count} мест в групповой тренировке #${bookingData.group_training_id} (платёж провалился)`);
                    }
                }
            }

            console.log(`💾 Выполняю COMMIT для транзакции #${transactionId} (bookingId: ${bookingId || 'null'})`);
            await client.query('COMMIT');
            processed = true;
            
            console.log(`✅ Webhook успешно обработан за ${Date.now() - startTime}ms (transaction #${transactionId}, bookingId: ${bookingId || 'null'})`);

        } catch (error) {
            await client.query('ROLLBACK');
            errorMessage = error.message;
            console.error(`❌ Ошибка обработки webhook для transaction #${transactionId} (bookingId: ${bookingId || 'null'}):`, error);
            console.error(`   Stack trace:`, error.stack);
        } finally {
            client.release();
        }

        // Логируем результат
        await logWebhook({
            provider: providerName,
            webhookType,
            paymentId,
            orderId,
            bookingId,
            status,
            amount,
            paymentMethod,
            rawPayload: payload,
            headers,
            signatureValid: true,
            processed,
            errorMessage
        });

        // Всегда отвечаем 200, даже если была ошибка обработки
        // (чтобы банк не слал повторно)
        res.status(200).send('OK');
        
    } catch (error) {
        console.error('❌ Критическая ошибка обработки webhook:', error);
        
        // Логируем критическую ошибку
        try {
            await logWebhook({
                provider: 'unknown',
                webhookType: payload.webhookType || 'unknown',
                paymentId: payload.paymentId,
                orderId: payload.orderId,
                bookingId: null,
                status: payload.status,
                amount: null,
                paymentMethod: null,
                rawPayload: payload,
                headers,
                signatureValid: false,
                processed: false,
                errorMessage: error.message
            });
        } catch (logError) {
            console.error('❌ Не удалось залогировать ошибку:', logError.message);
        }
        
        // При критической ошибке отвечаем 500, чтобы банк повторил попытку
        res.status(500).send('ERROR');
    }
});

/**
 * Тестовый endpoint для ручной отправки webhook'а (только для разработки)
 * Используется для тестирования после реальной оплаты на localhost
 * 
 * Вариант 1: Указать transactionId (рекомендуется)
 * curl -X POST http://localhost:8080/api/kuliga/payment/test-webhook \
 *   -H "Content-Type: application/json" \
 *   -d '{"transactionId": 123, "status": "SUCCESS"}'
 * 
 * Вариант 2: Указать orderId напрямую
 * curl -X POST http://localhost:8080/api/kuliga/payment/test-webhook \
 *   -H "Content-Type: application/json" \
 *   -d '{"orderId": "gornostyle72-wallet-123", "status": "SUCCESS"}'
 */
router.post('/test-webhook', async (req, res) => {
    // Разрешаем только в development режиме
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Test endpoint disabled in production' });
    }

    try {
        const { transactionId, orderId, status = 'SUCCESS', paymentMethod = 'card' } = req.body;

        let finalOrderId = orderId;
        let finalPaymentId = null;
        let finalAmount = null;

        // Если указан transactionId, получаем данные из БД
        if (transactionId) {
            const txResult = await pool.query(
                `SELECT id, amount, provider_payment_id, provider_order_id, type
                 FROM kuliga_transactions
                 WHERE id = $1`,
                [transactionId]
            );

            if (!txResult.rows.length) {
                return res.status(404).json({ error: `Транзакция #${transactionId} не найдена` });
            }

            const tx = txResult.rows[0];
            finalOrderId = tx.provider_order_id || `gornostyle72-wallet-${transactionId}`;
            finalPaymentId = tx.provider_payment_id || `test-payment-${transactionId}`;
            finalAmount = tx.amount;

            console.log(`🧪 [Test Webhook] Найдена транзакция #${transactionId}:`, {
                orderId: finalOrderId,
                paymentId: finalPaymentId,
                amount: finalAmount,
                type: tx.type
            });
        } else if (!orderId) {
            return res.status(400).json({ 
                error: 'Необходимо указать либо transactionId, либо orderId',
                example: {
                    transactionId: 123,
                    status: 'SUCCESS'
                }
            });
        }

        // Формируем payload в формате Точка Банк (JWT формат не нужен для теста)
        const mockPayload = {
            orderId: finalOrderId,
            paymentId: finalPaymentId || `test-${Date.now()}`,
            operationId: finalPaymentId || `test-op-${Date.now()}`,
            status: status,
            amount: finalAmount || 0,
            paymentMethod: paymentMethod,
            mock: true
        };

        console.log('🧪 [Test Webhook] Отправляю webhook:', mockPayload);

        // Создаем фиктивный запрос для обработчика webhook
        const mockReq = {
            body: Buffer.from(JSON.stringify(mockPayload)),
            headers: {
                'content-type': 'application/json',
                'x-test-webhook': 'true'
            }
        };

        // Создаем фиктивный response объект
        let responseSent = false;
        const mockRes = {
            status: (code) => ({
                send: (data) => {
                    if (!responseSent) {
                        responseSent = true;
                        console.log(`🧪 [Test Webhook] Response: ${code}`, data);
                        res.status(code).send(data);
                    }
                },
                json: (data) => {
                    if (!responseSent) {
                        responseSent = true;
                        console.log(`🧪 [Test Webhook] Response: ${code}`, data);
                        res.status(code).json(data);
                    }
                }
            }),
            send: (data) => {
                if (!responseSent) {
                    responseSent = true;
                    console.log(`🧪 [Test Webhook] Response: 200`, data);
                    res.status(200).send(data);
                }
            },
            json: (data) => {
                if (!responseSent) {
                    responseSent = true;
                    console.log(`🧪 [Test Webhook] Response: 200`, data);
                    res.status(200).json(data);
                }
            }
        };

        // Вызываем основной обработчик webhook напрямую
        const callbackHandler = router.stack.find(
            layer => layer.route && 
                     layer.route.path === '/callback' && 
                     layer.route.methods.post
        );

        if (callbackHandler && callbackHandler.route) {
            // Вызываем middleware обработчика
            const handler = callbackHandler.route.stack[0].handle;
            await handler(mockReq, mockRes);
            
            // Если обработчик не отправил ответ, отправляем свой
            if (!responseSent) {
                res.status(200).json({
                    success: true,
                    message: 'Test webhook processed',
                    orderId: finalOrderId,
                    status
                });
            }
        } else {
            console.error('⚠️ [Test Webhook] Не удалось найти обработчик /callback');
            res.status(500).json({ error: 'Handler not found' });
        }

    } catch (error) {
        console.error('❌ [Test Webhook] Ошибка:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

module.exports = router;
