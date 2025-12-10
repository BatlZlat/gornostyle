const express = require('express');
const { pool } = require('../db');
const PaymentProviderFactory = require('../services/payment/paymentProvider');

const router = express.Router();

router.post('/callback', express.json(), async (req, res) => {
    const payload = req.body || {};
    const headers = req.headers || {};

    try {
        // Определяем провайдера по структуре payload
        const providerName = PaymentProviderFactory.detectProviderFromWebhook(payload);
        const provider = PaymentProviderFactory.create(providerName);

        // Проверяем подпись webhook
        if (!provider.verifyWebhookSignature(payload, headers)) {
            console.error(`❌ Некорректная подпись ${providerName} webhook`);
            return res.status(400).send('Invalid signature');
        }

        // Парсим данные webhook
        const webhookData = provider.parseWebhookData(payload);
        const { orderId, paymentId, status, amount, paymentMethod } = webhookData;

        if (!orderId || !orderId.startsWith('kuliga-')) {
            console.warn(`⚠️ Получен callback ${providerName} с неподдерживаемым OrderId:`, orderId);
            return res.status(200).send('OK');
        }

        const bookingId = Number(orderId.replace('kuliga-', ''));

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const bookingResult = await client.query(
                `SELECT id, booking_type, group_training_id, participants_count
                 FROM kuliga_bookings
                 WHERE id = $1
                 FOR UPDATE`,
                [bookingId]
            );

            if (!bookingResult.rows.length) {
                await client.query('ROLLBACK');
                console.error('⚠️ Бронирование для callback не найдено', bookingId);
                return res.status(200).send('OK');
            }

            const booking = bookingResult.rows[0];

            // Определяем статус бронирования на основе статуса платежа
            // Точка Банк использует: SUCCESS, FAILED, PENDING, REFUNDED
            // Тинькофф использует: CONFIRMED, REJECTED, CANCELED, REFUNDED
            const isSuccess = status === 'SUCCESS' || status === 'CONFIRMED';
            const isFailed = status === 'FAILED' || status === 'REJECTED' || status === 'CANCELED';
            const isRefunded = status === 'REFUNDED';

            // Обновляем транзакцию с новыми полями
            await client.query(
                `UPDATE kuliga_transactions
                 SET provider_status = $1,
                     provider_payment_id = $2,
                     provider_order_id = $3,
                     payment_method = COALESCE($4, payment_method),
                     provider_raw_data = $5,
                     status = CASE
                         WHEN $1 IN ('SUCCESS', 'CONFIRMED') THEN 'completed'
                         WHEN $1 IN ('FAILED', 'REJECTED', 'CANCELED') THEN 'failed'
                         WHEN $1 = 'REFUNDED' THEN 'cancelled'
                         ELSE status
                     END
                 WHERE booking_id = $6`,
                [
                    status,
                    paymentId,
                    orderId,
                    paymentMethod || 'card',
                    JSON.stringify(payload),
                    bookingId
                ]
            );

            // Обновляем статус бронирования
            if (isSuccess) {
                await client.query(
                    `UPDATE kuliga_bookings
                     SET status = 'confirmed'
                     WHERE id = $1`,
                    [bookingId]
                );
            } else if (isFailed) {
                await client.query(
                    `UPDATE kuliga_bookings
                     SET status = 'cancelled', cancellation_reason = 'Отменено платежной системой', cancelled_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [bookingId]
                );
            } else if (isRefunded) {
                await client.query(
                    `UPDATE kuliga_bookings
                     SET status = 'refunded', cancellation_reason = 'Возврат платежа', cancelled_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [bookingId]
                );
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`Ошибка обработки callback ${providerName}:`, error);
        } finally {
            client.release();
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Ошибка обработки webhook:', error);
        res.status(500).send('ERROR');
    }
});

module.exports = router;
