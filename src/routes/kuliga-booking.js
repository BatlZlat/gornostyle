const express = require('express');
const moment = require('moment-timezone');
const { pool } = require('../db');
const { initPayment } = require('../services/kuligaPaymentService');

const router = express.Router();
const TIMEZONE = 'Asia/Yekaterinburg';

const formatDate = (date) => moment.tz(date, TIMEZONE).format('DD.MM.YYYY');
const formatTime = (time) => (time ? moment.tz(time, 'HH:mm:ss', TIMEZONE).format('HH:mm') : '');

const normalizePhone = (value = '') => value.replace(/[^0-9+]/g, '');

const upsertClient = async (client, trx) => {
    const phone = normalizePhone(client.phone);
    const { rows } = await trx.query(
        `SELECT id FROM kuliga_clients WHERE phone = $1 LIMIT 1`,
        [phone]
    );

    if (rows.length) {
        await trx.query(
            `UPDATE kuliga_clients
             SET full_name = $1,
                 email = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [client.fullName, client.email || null, rows[0].id]
        );
        return rows[0].id;
    }

    const insertResult = await trx.query(
        `INSERT INTO kuliga_clients (full_name, phone, email)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [client.fullName, phone, client.email || null]
    );

    return insertResult.rows[0].id;
};

const ensurePrivacyConsent = async (clientId, trx) => {
    const { rows } = await trx.query(
        `SELECT id FROM privacy_policies
         WHERE is_active = TRUE
         ORDER BY effective_date DESC
         LIMIT 1`
    );

    if (!rows.length) {
        return null;
    }

    const policyId = rows[0].id;

    await trx.query(
        `INSERT INTO privacy_consents (client_id, policy_id, consent_type, consented_at)
         VALUES ($1, $2, 'kuliga_booking', CURRENT_TIMESTAMP)
         ON CONFLICT (client_id, consent_type, policy_id) DO NOTHING`,
        [clientId, policyId]
    );

    return policyId;
};

router.post('/bookings', async (req, res) => {
    const {
        fullName,
        phone,
        email,
        bookingType = 'group',
        groupTrainingId,
        participantsCount = 1,
        participantsNames = [],
        consentConfirmed,
    } = req.body || {};

    if (!consentConfirmed) {
        return res.status(400).json({ success: false, error: 'Необходимо согласие на обработку персональных данных' });
    }

    if (!fullName || !phone) {
        return res.status(400).json({ success: false, error: 'Укажите ФИО и телефон' });
    }

    if (bookingType !== 'group') {
        return res.status(400).json({ success: false, error: 'Индивидуальные тренировки пока доступны через администратора' });
    }

    if (!groupTrainingId) {
        return res.status(400).json({ success: false, error: 'Не выбрано групповое занятие' });
    }

    const normalizedPhone = normalizePhone(phone);
    const safeCount = Math.max(1, Math.min(4, Number(participantsCount) || 1));

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const groupResult = await client.query(
            `SELECT id, instructor_id, slot_id, date, start_time, end_time, sport_type,
                    price_per_person, max_participants, current_participants, status
             FROM kuliga_group_trainings
             WHERE id = $1
             FOR UPDATE`,
            [groupTrainingId]
        );

        if (!groupResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Групповое занятие не найдено' });
        }

        const training = groupResult.rows[0];

        if (training.status !== 'open' && training.status !== 'confirmed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Запись на это занятие временно недоступна' });
        }

        if (training.current_participants + safeCount > training.max_participants) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Недостаточно мест в группе' });
        }

        const clientId = await upsertClient({ fullName: fullName.trim(), phone: normalizedPhone, email: email?.trim() }, client);
        await ensurePrivacyConsent(clientId, client);

        const namesArray = Array.from({ length: safeCount }, (_, index) => {
            if (index === 0) {
                return fullName.trim();
            }
            return (participantsNames[index] || participantsNames[index - 1] || '').toString().trim();
        }).filter(Boolean);

        const pricePerPerson = Number(training.price_per_person);
        const totalPrice = pricePerPerson * safeCount;

        const bookingResult = await client.query(
            `INSERT INTO kuliga_bookings (
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
                status
            ) VALUES ($1, 'group', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
            RETURNING id`,
            [
                clientId,
                training.id,
                training.date,
                training.start_time,
                training.end_time,
                training.sport_type,
                safeCount,
                namesArray,
                totalPrice,
                pricePerPerson,
            ]
        );

        const bookingId = bookingResult.rows[0].id;

        const description = `Кулига: ${training.sport_type === 'ski' ? 'лыжи' : 'сноуборд'} ${formatDate(training.date)}, ${formatTime(training.start_time)}`;

        const transactionResult = await client.query(
            `INSERT INTO kuliga_transactions (client_id, booking_id, type, amount, status, description)
             VALUES ($1, $2, 'payment', $3, 'pending', $4)
             RETURNING id`,
            [clientId, bookingId, totalPrice, description]
        );

        const transactionId = transactionResult.rows[0].id;

        await client.query('COMMIT');

        let payment;
        try {
            payment = await initPayment({
                orderId: `kuliga-${bookingId}`,
                amount: totalPrice,
                description,
                customerPhone: normalizedPhone,
                customerEmail: email?.trim() || undefined,
                items: [
                    {
                        Name: `Групповая тренировка (${safeCount} чел.)`,
                        Price: Math.round(pricePerPerson * 100),
                        Quantity: safeCount,
                        Amount: Math.round(totalPrice * 100),
                        Tax: 'none',
                        PaymentMethod: 'full_payment',
                        PaymentObject: 'service',
                    },
                ],
            });
        } catch (paymentError) {
            await pool.query(
                `UPDATE kuliga_transactions
                 SET status = 'failed', tinkoff_status = $1
                 WHERE id = $2`,
                [paymentError.message.slice(0, 120), transactionId]
            );
            await pool.query(
                `UPDATE kuliga_bookings
                 SET status = 'cancelled', cancellation_reason = 'Ошибка инициализации платежа', cancelled_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [bookingId]
            );
            throw paymentError;
        }

        await pool.query(
            `UPDATE kuliga_transactions
             SET tinkoff_payment_id = $1,
                 tinkoff_order_id = $2,
                 tinkoff_status = $3
             WHERE id = $4`,
            [payment.paymentId, `kuliga-${bookingId}`, payment.status, transactionId]
        );

        return res.json({ success: true, bookingId, paymentUrl: payment.paymentURL });
    } catch (error) {
        console.error('Ошибка бронирования Кулиги:', error);
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка при откате транзакции бронирования Кулиги:', rollbackError);
        }
        return res.status(500).json({ success: false, error: error.message || 'Не удалось создать бронирование' });
    } finally {
        client.release();
    }
});

module.exports = router;
