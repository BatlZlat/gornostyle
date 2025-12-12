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

router.post('/callback', express.json(), async (req, res) => {
    const payload = req.body || {};
    const headers = req.headers || {};
    const startTime = Date.now();

    console.log(`🔔 Получен webhook:`, {
        method: 'POST',
        headers: Object.keys(headers),
        payloadKeys: Object.keys(payload),
        userAgent: headers['user-agent'] || headers['User-Agent'],
        contentType: headers['content-type'] || headers['Content-Type']
    });

    try {
        // Обработка тестового вебхука от банка при регистрации
        // Банк отправляет тестовый запрос для проверки доступности URL
        // В этом случае payload может быть пустым или иметь другую структуру
        const isEmptyPayload = !payload || Object.keys(payload).length === 0;
        const userAgent = (headers['user-agent'] || headers['User-Agent'] || '').toLowerCase();
        const isTestWebhook = isEmptyPayload || 
                              userAgent.includes('tochka') ||
                              userAgent.includes('curl') ||
                              userAgent.includes('postman');
        
        if (isTestWebhook) {
            console.log('✅ Получен тестовый вебхук от банка (проверка доступности URL)');
            console.log('   Payload:', JSON.stringify(payload));
            console.log('   User-Agent:', userAgent);
            // Отвечаем 200 OK для успешной проверки доступности
            return res.status(200).send('OK');
        }

        // Определяем провайдера по структуре payload
        const providerName = PaymentProviderFactory.detectProviderFromWebhook(payload);
        const provider = PaymentProviderFactory.create(providerName);

        // Проверяем подпись webhook (строго!)
        const signatureValid = provider.verifyWebhookSignature(payload, headers);
        
        if (!signatureValid) {
            console.error(`❌ Некорректная подпись ${providerName} webhook`);
            
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
        const { orderId, paymentId, status, amount, paymentMethod, webhookType } = webhookData;
        
        console.log(`✅ Webhook валиден:`, {
            provider: providerName,
            webhookType,
            orderId,
            paymentId,
            status
        });

        if (!orderId || !orderId.startsWith('kuliga-')) {
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

        const bookingId = Number(orderId.replace('kuliga-', ''));
        let errorMessage = null;
        let processed = false;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const bookingResult = await client.query(
                `SELECT id, booking_type, group_training_id, participants_count, status as booking_status
                 FROM kuliga_bookings
                 WHERE id = $1
                 FOR UPDATE`,
                [bookingId]
            );

            if (!bookingResult.rows.length) {
                await client.query('ROLLBACK');
                errorMessage = `Бронирование #${bookingId} не найдено`;
                console.error(`⚠️ ${errorMessage}`);
                
                // Логируем
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
                    processed: false,
                    errorMessage
                });
                
                return res.status(200).send('OK');
            }

            const booking = bookingResult.rows[0];

            // Определяем статус бронирования на основе статуса платежа
            const isSuccess = status === 'SUCCESS';
            const isFailed = status === 'FAILED';
            const isRefunded = status === 'REFUNDED';
            const isPending = status === 'PENDING';

            console.log(`📝 Обрабатываем вебхук для booking #${bookingId}:`, {
                currentBookingStatus: booking.booking_status,
                paymentStatus: status,
                isSuccess,
                isFailed,
                isRefunded
            });

            // Обновляем транзакцию
            const txUpdateResult = await client.query(
                `UPDATE kuliga_transactions
                 SET provider_status = $1,
                     provider_payment_id = $2,
                     provider_order_id = $3,
                     payment_method = COALESCE($4, payment_method),
                     provider_raw_data = $5,
                     status = CASE
                         WHEN $1 = 'SUCCESS' THEN 'completed'
                         WHEN $1 = 'FAILED' THEN 'failed'
                         WHEN $1 = 'REFUNDED' THEN 'cancelled'
                         WHEN $1 = 'PENDING' THEN 'pending'
                         ELSE status
                     END,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE booking_id = $6
                 RETURNING id, status`,
                [
                    status,
                    paymentId,
                    orderId,
                    paymentMethod || 'card',
                    JSON.stringify(payload),
                    bookingId
                ]
            );

            if (txUpdateResult.rows.length === 0) {
                console.warn(`⚠️ Транзакция для booking #${bookingId} не найдена`);
            } else {
                console.log(`✅ Транзакция обновлена: status=${txUpdateResult.rows[0].status}`);
            }

            // Обновляем статус бронирования
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
                console.log(`❌ Бронирование #${bookingId} отменено (платеж не прошел)`);
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
                console.log(`💰 Бронирование #${bookingId} возвращено (refund)`);
            }

            await client.query('COMMIT');
            processed = true;
            
            console.log(`✅ Webhook успешно обработан за ${Date.now() - startTime}ms`);

        } catch (error) {
            await client.query('ROLLBACK');
            errorMessage = error.message;
            console.error(`❌ Ошибка обработки webhook для booking #${bookingId}:`, error);
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

module.exports = router;
