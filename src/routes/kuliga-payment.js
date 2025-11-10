const express = require('express');
const { pool } = require('../db');
const { generateToken } = require('../services/kuligaPaymentService');

const router = express.Router();

router.post('/callback', express.json(), async (req, res) => {
    const payload = req.body || {};

    try {
        const token = payload.Token;
        const expectedToken = generateToken({ ...payload });

        if (!token || token !== expectedToken) {
            console.error('❌ Некорректная подпись Tinkoff webhook');
            return res.status(400).send('Invalid token');
        }

        const orderId = payload.OrderId;
        if (!orderId || !orderId.startsWith('kuliga-')) {
            console.warn('⚠️ Получен callback Tinkoff с неподдерживаемым OrderId:', orderId);
            return res.status(200).send('OK');
        }

        const bookingId = Number(orderId.replace('kuliga-', ''));
        const paymentId = payload.PaymentId;
        const status = payload.Status;

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

            if (status === 'CONFIRMED') {
                await client.query(
                    `UPDATE kuliga_transactions
                     SET status = 'completed', tinkoff_status = $1, tinkoff_payment_id = $2
                     WHERE booking_id = $3`,
                    [status, paymentId, bookingId]
                );

                await client.query(
                    `UPDATE kuliga_bookings
                     SET status = 'confirmed'
                     WHERE id = $1`,
                    [bookingId]
                );
            } else if (status === 'REJECTED' || status === 'CANCELED') {
                await client.query(
                    `UPDATE kuliga_transactions
                     SET status = 'failed', tinkoff_status = $1, tinkoff_payment_id = $2
                     WHERE booking_id = $3`,
                    [status, paymentId, bookingId]
                );

                await client.query(
                    `UPDATE kuliga_bookings
                     SET status = 'cancelled', cancellation_reason = $1, cancelled_at = CURRENT_TIMESTAMP
                     WHERE id = $2`,
                    ['Отменено платежной системой', bookingId]
                );
            } else if (status === 'REFUNDED') {
                await client.query(
                    `UPDATE kuliga_transactions
                     SET status = 'cancelled', tinkoff_status = $1, tinkoff_payment_id = $2
                     WHERE booking_id = $3`,
                    [status, paymentId, bookingId]
                );

                await client.query(
                    `UPDATE kuliga_bookings
                     SET status = 'refunded', cancellation_reason = 'Возврат платежа', cancelled_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [bookingId]
                );
            } else {
                await client.query(
                    `UPDATE kuliga_transactions
                     SET tinkoff_status = $1, tinkoff_payment_id = $2
                     WHERE booking_id = $3`,
                    [status, paymentId, bookingId]
                );
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Ошибка обработки callback Tinkoff:', error);
        } finally {
            client.release();
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Ошибка Tinkoff webhook:', error);
        res.status(500).send('ERROR');
    }
});

module.exports = router;
