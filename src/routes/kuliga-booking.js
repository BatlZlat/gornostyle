const express = require('express');
const moment = require('moment-timezone');
const { pool } = require('../db');
const { initPayment } = require('../services/kuligaPaymentService');
const { normalizePhone } = require('../utils/phone-normalizer');
const { 
    notifyAdminNaturalSlopeTrainingBooking, 
    notifyInstructorKuligaTrainingBooking 
} = require('../bot/admin-notify');

const router = express.Router();
const TIMEZONE = 'Asia/Yekaterinburg';

const formatDate = (date) => moment.tz(date, TIMEZONE).format('DD.MM.YYYY');
const formatTime = (time) => (time ? moment.tz(time, 'HH:mm:ss', TIMEZONE).format('HH:mm') : '');

const minutesBetween = (date, startTime, endTime) => {
    // Преобразуем date в строку формата YYYY-MM-DD
    const dateStr = moment(date).format('YYYY-MM-DD');
    const start = moment.tz(`${dateStr}T${startTime}`, 'YYYY-MM-DDTHH:mm:ss', TIMEZONE);
    const end = moment.tz(`${dateStr}T${endTime}`, 'YYYY-MM-DDTHH:mm:ss', TIMEZONE);
    return end.diff(start, 'minutes');
};

const isDateWithinRange = (dateString) => {
    const day = moment.tz(dateString, 'YYYY-MM-DD', TIMEZONE);
    if (!day.isValid()) return false;
    const today = moment.tz(TIMEZONE).startOf('day');
    const max = today.clone().add(14, 'days').endOf('day');
    return !day.isBefore(today) && !day.isAfter(max);
};

// МИГРАЦИЯ 033: Теперь используем таблицу clients вместо kuliga_clients
const upsertClient = async (client, trx) => {
    const phone = normalizePhone(client.phone);
    
    // Нормализуем телефон для поиска (убираем все кроме цифр и +)
    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
    
    // Ищем клиента в clients по нормализованному телефону
    const { rows } = await trx.query(
        `SELECT id, telegram_id, birth_date FROM clients 
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = $1 
         LIMIT 1`,
        [normalizedPhone]
    );

    if (rows.length) {
        // Клиент найден, обновляем email (если его нет) и birth_date (если был временным)
        const existingBirthDate = rows[0].birth_date;
        const isTemporaryBirthDate = existingBirthDate && new Date(existingBirthDate).getFullYear() === 1900;
        
        await trx.query(
            `UPDATE clients
             SET email = COALESCE(email, $1),
                 birth_date = CASE 
                     WHEN $2::date IS NOT NULL AND ($3::date IS NULL OR $3::date = '1900-01-01'::date) 
                     THEN $2::date 
                     ELSE birth_date 
                 END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [
                client.email || null, 
                client.birthDate || null,
                existingBirthDate ? existingBirthDate.toISOString().split('T')[0] : null,
                rows[0].id
            ]
        );
        return { id: rows[0].id, telegram_id: rows[0].telegram_id };
    }

    // Клиент не найден, создаем нового с датой рождения из формы или временной датой
    const insertResult = await trx.query(
        `INSERT INTO clients (full_name, phone, email, birth_date, created_at, updated_at)
         VALUES ($1, $2, $3, COALESCE($4::date, '1900-01-01'::date), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, telegram_id`,
        [client.fullName, phone, client.email || null, client.birthDate || null]
    );

    return { id: insertResult.rows[0].id, telegram_id: insertResult.rows[0].telegram_id };
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

const createGroupBooking = async (req, res) => {
    const {
        fullName,
        birthDate,
        phone,
        email,
        groupTrainingId,
        participantsCount = 1,
        participantsNames = [],
        consentConfirmed,
    } = req.body || {};

    if (!consentConfirmed) {
        return res.status(400).json({ success: false, error: 'Необходимо согласие на обработку персональных данных' });
    }

    if (!fullName || !birthDate || !phone) {
        return res.status(400).json({ success: false, error: 'Укажите ФИО, дату рождения и телефон' });
    }

    if (!groupTrainingId) {
        return res.status(400).json({ success: false, error: 'Не выбрано групповое занятие' });
    }

    const normalizedPhone = normalizePhone(phone);
    const safeCount = Math.max(1, Math.min(8, Number(participantsCount) || 1));

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

        const clientRecord = await upsertClient(
            { fullName: fullName.trim(), birthDate: birthDate, phone: normalizedPhone, email: email?.trim() },
            client
        );
        await ensurePrivacyConsent(clientRecord.id, client);

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
                clientRecord.id,
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

        const description =
            `Кулига: ${training.sport_type === 'ski' ? 'лыжи' : 'сноуборд'} ${formatDate(training.date)}, ${formatTime(training.start_time)}`;

        const transactionResult = await client.query(
            `INSERT INTO kuliga_transactions (client_id, booking_id, type, amount, status, description)
             VALUES ($1, $2, 'payment', $3, 'pending', $4)
             RETURNING id`,
            [clientRecord.id, bookingId, totalPrice, description]
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
                `UPDATE kulига_transactions
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
        console.error('Ошибка бронирования Кулиги (группа):', error);
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка при откате транзакции бронирования Кулиги (группа):', rollbackError);
        }
        return res.status(500).json({ success: false, error: error.message || 'Не удалось создать бронирование' });
    } finally {
        client.release();
    }
};

const createIndividualBooking = async (req, res) => {
    const {
        fullName,
        birthDate,
        phone,
        email,
        priceId,
        sportType,
        date,
        slotId,
        instructorId,
        participants = [],
        notification = {},
        payerParticipation = 'self',
        consentConfirmed,
    } = req.body || {};

    if (!consentConfirmed) {
        return res.status(400).json({ success: false, error: 'Необходимо согласие на обработку персональных данных' });
    }

    if (!fullName || !birthDate || !phone) {
        return res.status(400).json({ success: false, error: 'Укажите ФИО, дату рождения и телефон' });
    }

    if (!priceId) {
        return res.status(400).json({ success: false, error: 'Не выбран тариф тренировки' });
    }

    if (!date || !slotId || !instructorId) {
        return res.status(400).json({ success: false, error: 'Выберите дату и свободный слот для тренировки' });
    }

    if (!isDateWithinRange(date)) {
        return res.status(400).json({ success: false, error: 'Выбранная дата недоступна для бронирования' });
    }

    if (!Array.isArray(participants) || !participants.length) {
        return res.status(400).json({ success: false, error: 'Заполните данные участников тренировки' });
    }

    const notifyEmail = Boolean(notification.email);
    const notifyTelegram = Boolean(notification.telegram);

    if (!notifyEmail && !notifyTelegram) {
        return res.status(400).json({ success: false, error: 'Выберите способ уведомлений: email или Telegram' });
    }

    if (notifyEmail && !email) {
        return res.status(400).json({ success: false, error: 'Укажите email или отключите уведомления по email' });
    }

    const normalizedSport = sportType === 'snowboard' ? 'snowboard' : 'ski';
    const normalizedPhone = normalizePhone(phone);
    const participantsCount = participants.length;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const priceResult = await client.query(
            `SELECT id, type, duration, participants, price
             FROM winter_prices
             WHERE id = $1`,
            [priceId]
        );

        if (!priceResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Выбранный тариф не найден' });
        }

        const price = priceResult.rows[0];
        const baseParticipants = Math.max(1, Number(price.participants) || 1);
        const isGroupPrice = price.type !== 'individual';

        if (isGroupPrice && participantsCount > baseParticipants) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Количество участников превышает допустимое для выбранного тарифа' });
        }

        const pricePerPerson =
            price.type === 'individual'
                ? Number(price.price) || 0
                : (Number(price.price) || 0) / baseParticipants;
        const totalPrice = pricePerPerson * participantsCount;

        const participantsNames = [];
        const participantsBirthYears = [];
        const currentYear = moment.tz(TIMEZONE).year();

        participants.forEach((participant, index) => {
            const name = (participant.fullName || '').trim();
            const birthYear = Number(participant.birthYear);
            if (!name) {
                throw new Error(`Участник #${index + 1}: укажите ФИО`);
            }
            if (!Number.isInteger(birthYear)) {
                throw new Error(`Участник #${index + 1}: укажите корректный год рождения`);
            }
            if (birthYear < currentYear - 99 || birthYear > currentYear) {
                throw new Error(`Участник #${index + 1}: год рождения вне допустимого диапазона`);
            }
            participantsNames.push(name);
            participantsBirthYears.push(birthYear);
        });

        const clientRecord = await upsertClient(
            { fullName: fullName.trim(), birthDate: birthDate, phone: normalizedPhone, email: email?.trim() },
            client
        );

        // Если выбран Telegram, но клиент еще не зарегистрирован в боте - это не критично
        // Бот может быть запущен после оплаты, или клиент уже зарегистрирован
        // Не блокируем создание бронирования, просто логируем
        if (notifyTelegram && !clientRecord.telegram_id) {
            console.log(`⚠️ Клиент ${fullName} (${normalizedPhone}) выбрал Telegram уведомления, но еще не зарегистрирован в боте. Бронь создана, но уведомления в Telegram будут отправлены после регистрации в боте.`);
        }

        await ensurePrivacyConsent(clientRecord.id, client);

        const slotResult = await client.query(
            `SELECT s.id AS slot_id,
                    s.instructor_id,
                    s.date,
                    s.start_time,
                    s.end_time,
                    s.status,
                    i.full_name AS instructor_name,
                    i.sport_type AS instructor_sport_type,
                    i.is_active AS instructor_active
             FROM kuliga_schedule_slots s
             JOIN kuliga_instructors i ON i.id = s.instructor_id
             WHERE s.id = $1
               AND s.date = $2
             FOR UPDATE`,
            [slotId, date]
        );

        if (!slotResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Выбранный слот не найден' });
        }

        const slot = slotResult.rows[0];

        if (slot.status !== 'available') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Слот уже занят. Выберите другое время.' });
        }

        if (Number(slot.instructor_id) !== Number(instructorId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Слот привязан к другому инструктору' });
        }

        if (!slot.instructor_active) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Инструктор недоступен для бронирования' });
        }

        if (slot.instructor_sport_type !== 'both' && slot.instructor_sport_type !== normalizedSport) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Инструктор не проводит тренировки по выбранному виду спорта' });
        }

        const slotDuration = minutesBetween(slot.date, slot.start_time, slot.end_time);
        const requiredDuration = Number(price.duration) || 60;

        if (slotDuration < requiredDuration) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Длительность выбранного слота меньше требуемой по тарифу' });
        }

        await client.query(
            `UPDATE kuliga_schedule_slots
             SET status = 'booked', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [slot.slot_id]
        );

        const notificationMethod = notifyEmail && notifyTelegram ? 'both' : notifyTelegram ? 'telegram' : notifyEmail ? 'email' : 'none';
        const payerRides = payerParticipation !== 'other';

        const bookingResult = await client.query(
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
                status
            ) VALUES ($1, 'individual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending')
            RETURNING id`,
            [
                clientRecord.id,
                slot.instructor_id,
                slot.slot_id,
                slot.date,
                slot.start_time,
                slot.end_time,
                normalizedSport,
                participantsCount,
                participantsNames,
                participantsBirthYears,
                totalPrice,
                pricePerPerson,
                price.id,
                notificationMethod,
                payerRides,
            ]
        );

        const bookingId = bookingResult.rows[0].id;

        const description =
            `Кулига: ${normalizedSport === 'ski' ? 'лыжи' : 'сноуборд'} ${formatDate(slot.date)}, ${formatTime(slot.start_time)}`;

        const transactionResult = await client.query(
            `INSERT INTO kuliga_transactions (client_id, booking_id, type, amount, status, description)
             VALUES ($1, $2, 'payment', $3, 'pending', $4)
             RETURNING id`,
            [clientRecord.id, bookingId, totalPrice, description]
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
                        Name: `${price.type === 'individual' ? 'Индивидуальная' : 'Групповая'} тренировка (${participantsCount} чел.)`,
                        Price: Math.round(pricePerPerson * 100),
                        Quantity: participantsCount,
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
            await pool.query(
                `UPDATE kuliga_schedule_slots
                 SET status = 'available', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [slot.slot_id]
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

        // Отправляем уведомления (асинхронно, не блокируем ответ)
        setImmediate(async () => {
            try {
                // Получаем данные инструктора для уведомления
                const instructorResult = await pool.query(
                    'SELECT full_name, telegram_id, admin_percentage FROM kuliga_instructors WHERE id = $1',
                    [slot.instructor_id]
                );

                // Уведомление администратору
                await notifyAdminNaturalSlopeTrainingBooking({
                    client_name: fullName,
                    client_phone: normalizedPhone,
                    participant_name: participantsNames[0] || fullName,
                    date: slot.date,
                    time: slot.start_time,
                    sport_type: normalizedSport,
                    instructor_name: slot.instructor_name,
                    price: totalPrice,
                    booking_source: 'website'
                });

                // Уведомление инструктору
                if (instructorResult.rows.length > 0) {
                    const instructor = instructorResult.rows[0];
                    await notifyInstructorKuligaTrainingBooking({
                        booking_type: 'individual',
                        client_name: fullName,
                        participant_name: participantsNames[0] || fullName,
                        client_phone: normalizedPhone,
                        instructor_name: instructor.full_name,
                        instructor_telegram_id: instructor.telegram_id,
                        admin_percentage: instructor.admin_percentage,
                        date: slot.date,
                        time: slot.start_time,
                        price: totalPrice
                    });
                }
            } catch (notifyError) {
                console.error('Ошибка при отправке уведомлений о бронировании Кулиги:', notifyError);
            }
        });

        return res.json({ success: true, bookingId, paymentUrl: payment.paymentURL });
    } catch (error) {
        console.error('Ошибка бронирования Кулиги (индивидуальная):', error);
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка при откате транзакции бронирования Кулиги (индивидуальная):', rollbackError);
        }
        return res.status(500).json({ success: false, error: error.message || 'Не удалось создать бронирование' });
    } finally {
        client.release();
    }
};

router.get('/availability', async (req, res) => {
    const { date, sport = 'ski', duration = 60 } = req.query || {};

    if (!date) {
        return res.status(400).json({ success: false, error: 'Укажите дату' });
    }

    if (!isDateWithinRange(date)) {
        return res.status(400).json({ success: false, error: 'Дата вне допустимого диапазона' });
    }

    const normalizedSport = sport === 'snowboard' ? 'snowboard' : 'ski';
    const requiredDuration = Math.max(30, Math.min(180, parseInt(duration, 10) || 60));

    try {
        const { rows } = await pool.query(
            `SELECT s.id AS slot_id,
                    s.instructor_id,
                    s.date,
                    s.start_time,
                    s.end_time,
                    s.status,
                    i.full_name AS instructor_name,
                    i.sport_type AS instructor_sport_type,
                    i.photo_url AS instructor_photo_url,
                    i.description AS instructor_description,
                    i.is_active AS instructor_active
             FROM kuliga_schedule_slots s
             JOIN kuliga_instructors i ON i.id = s.instructor_id
             WHERE s.date = $1
               AND s.status = 'available'
               AND i.is_active = TRUE
               AND (i.sport_type = $2 OR i.sport_type = 'both')
             ORDER BY s.start_time ASC`,
            [date, normalizedSport]
        );

        const available = rows
            .filter((slot) => minutesBetween(date, slot.start_time, slot.end_time) >= requiredDuration)
            .map((slot) => ({
                slot_id: slot.slot_id,
                instructor_id: slot.instructor_id,
                date: slot.date,
                start_time: slot.start_time,
                end_time: slot.end_time,
                instructor_name: slot.instructor_name,
                instructor_sport_type: slot.instructor_sport_type,
                instructor_photo_url: slot.instructor_photo_url,
                instructor_description: slot.instructor_description,
            }));

        return res.json({ success: true, data: available });
    } catch (error) {
        console.error('Ошибка получения свободных слотов Кулиги:', error);
        return res.status(500).json({ success: false, error: 'Не удалось получить свободные слоты' });
    }
});

// Предварительная регистрация клиента при клике на ссылку бота (до оплаты)
router.post('/pre-register-client', async (req, res) => {
    const { fullName, birthDate, phone, email } = req.body || {};

    if (!fullName || !birthDate || !phone) {
        return res.status(400).json({ 
            success: false, 
            error: 'Укажите ФИО, дату рождения и телефон' 
        });
    }

    const normalizedPhone = normalizePhone(phone);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const clientRecord = await upsertClient(
            { 
                fullName: fullName.trim(), 
                birthDate: birthDate, 
                phone: normalizedPhone, 
                email: email?.trim() || null 
            },
            client
        );

        await client.query('COMMIT');

        return res.json({ 
            success: true, 
            message: 'Клиент предварительно зарегистрирован',
            clientId: clientRecord.id,
            hasTelegramId: !!clientRecord.telegram_id
        });
    } catch (error) {
        console.error('Ошибка предварительной регистрации клиента:', error);
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка при откате транзакции предварительной регистрации:', rollbackError);
        }
        return res.status(500).json({ 
            success: false, 
            error: error.message || 'Не удалось зарегистрировать клиента' 
        });
    } finally {
        client.release();
    }
});

router.post('/bookings', async (req, res) => {
    const bookingType = (req.body && req.body.bookingType) || 'group';

    if (bookingType === 'individual') {
        return createIndividualBooking(req, res);
    }

    if (bookingType === 'group') {
        return createGroupBooking(req, res);
    }

    return res.status(400).json({ success: false, error: 'Недопустимый тип бронирования' });
});

module.exports = router;

