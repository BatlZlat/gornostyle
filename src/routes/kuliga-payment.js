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

        // НОВАЯ ЛОГИКА: orderId = kuliga-tx-{transactionId}
        // Находим транзакцию, проверяем есть ли booking_id
        // Если нет - создаём бронирование из provider_raw_data
        const transactionId = Number(orderId.replace('kuliga-tx-', ''));
        let bookingId = null;
        let errorMessage = null;
        let processed = false;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Находим транзакцию
            const transactionResult = await client.query(
                `SELECT id, booking_id, client_id, amount, status as tx_status, provider_raw_data
                 FROM kuliga_transactions
                 WHERE id = $1
                 FOR UPDATE`,
                [transactionId]
            );

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

            // Определяем статус платежа
            const isSuccess = status === 'SUCCESS';
            const isFailed = status === 'FAILED';
            const isRefunded = status === 'REFUNDED';
            const isPending = status === 'PENDING';

            console.log(`📝 Обрабатываем вебхук для transaction #${transactionId}:`, {
                bookingId,
                paymentStatus: status,
                isSuccess,
                isFailed,
                isRefunded
            });

            // НОВАЯ ЛОГИКА: Если оплата успешна и бронирование ещё не создано - создаём его
            if (isSuccess && !bookingId) {
                console.log(`🔨 Создаём бронирование для успешного платежа (transaction #${transactionId})`);
                
                // Извлекаем данные бронирования из provider_raw_data
                const rawData = transaction.provider_raw_data || {};
                const bookingData = rawData.bookingData;
                
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
                
                // Проверяем статус слота
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
                
                // Создаём бронирование
                const newBookingResult = await client.query(
                    `INSERT INTO kuliga_bookings (
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
                    RETURNING id`,
                    [
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
                    ]
                );
                
                bookingId = newBookingResult.rows[0].id;
                console.log(`✅ Бронирование #${bookingId} создано после успешной оплаты`);
                
                // Обновляем транзакцию - добавляем booking_id
                await client.query(
                    `UPDATE kuliga_transactions
                     SET booking_id = $1
                     WHERE id = $2`,
                    [bookingId, transactionId]
                );
                
                // Отправляем уведомления (асинхронно)
                setImmediate(async () => {
                    try {
                        const { notifyAdminNaturalSlopeTrainingBooking } = require('../bot/notifications/kuliga-notifications');
                        const { notifyInstructorKuligaTrainingBooking } = require('../bot/notifications/instructor-notifications');
                        
                        // Получаем данные инструктора
                        const instructorResult = await pool.query(
                            'SELECT full_name, telegram_id, admin_percentage FROM kuliga_instructors WHERE id = $1',
                            [bookingData.instructor_id]
                        );
                        
                        // Уведомление администратору
                        await notifyAdminNaturalSlopeTrainingBooking({
                            client_name: bookingData.client_name,
                            client_phone: bookingData.client_phone,
                            participant_name: bookingData.participants_names[0] || bookingData.client_name,
                            date: bookingData.date,
                            time: bookingData.start_time,
                            sport_type: bookingData.sport_type,
                            instructor_name: bookingData.instructor_name,
                            price: bookingData.price_total,
                            booking_source: 'website',
                            location: bookingData.location
                        });
                        
                        // Уведомление инструктору
                        if (instructorResult.rows.length > 0) {
                            const instructor = instructorResult.rows[0];
                            await notifyInstructorKuligaTrainingBooking({
                                booking_type: 'individual',
                                client_name: bookingData.client_name,
                                participant_name: bookingData.participants_names[0] || bookingData.client_name,
                                client_phone: bookingData.client_phone,
                                instructor_name: instructor.full_name,
                                instructor_telegram_id: instructor.telegram_id,
                                admin_percentage: instructor.admin_percentage,
                                date: bookingData.date,
                                time: bookingData.start_time,
                                price: bookingData.price_total,
                                location: bookingData.location
                            });
                        }
                    } catch (notifyError) {
                        console.error('Ошибка при отправке уведомлений после создания бронирования:', notifyError);
                    }
                });
            }
            
            // Если бронирование уже создано (повторный webhook), загружаем его
            let booking = null;
            if (bookingId) {
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
                }
            }

            // Обновляем транзакцию (по transactionId, а не по booking_id)
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
                 WHERE id = $6
                 RETURNING id, status`,
                [
                    status,
                    paymentId,
                    orderId,
                    paymentMethod || 'card',
                    JSON.stringify(payload),
                    transactionId
                ]
            );

            if (txUpdateResult.rows.length === 0) {
                console.warn(`⚠️ Транзакция #${transactionId} не найдена`);
            } else {
                console.log(`✅ Транзакция #${transactionId} обновлена: status=${txUpdateResult.rows[0].status}`);
            }

            // Обновляем статус бронирования (если оно существует)
            if (booking) {
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
                    
                    // Освобождаем слот
                    const rawData = transaction.provider_raw_data || {};
                    const bookingData = rawData.bookingData;
                    if (bookingData && bookingData.slot_id) {
                        await client.query(
                            `UPDATE kuliga_schedule_slots
                             SET status = 'available', updated_at = CURRENT_TIMESTAMP
                             WHERE id = $1`,
                            [bookingData.slot_id]
                        );
                    }
                    
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
                    
                    // Освобождаем слот
                    const rawData = transaction.provider_raw_data || {};
                    const bookingData = rawData.bookingData;
                    if (bookingData && bookingData.slot_id) {
                        await client.query(
                            `UPDATE kuliga_schedule_slots
                             SET status = 'available', updated_at = CURRENT_TIMESTAMP
                             WHERE id = $1`,
                            [bookingData.slot_id]
                        );
                    }
                    
                    console.log(`💰 Бронирование #${bookingId} возвращено (refund)`);
                }
            } else if (isFailed) {
                // Если платёж провалился и бронирования нет - снимаем hold со слота
                console.log(`❌ Платёж провалился, бронирование не создано`);
                
                // Снимаем hold со слота (если он был)
                const rawData = transaction.provider_raw_data || {};
                const bookingData = rawData.bookingData;
                if (bookingData && bookingData.slot_id) {
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
                }
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
