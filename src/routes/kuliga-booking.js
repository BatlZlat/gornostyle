const express = require('express');
const moment = require('moment-timezone');
const { pool } = require('../db');
const PaymentProviderFactory = require('../services/payment/paymentProvider');
const { normalizePhone } = require('../utils/phone-normalizer');
const { isValidLocation } = require('../utils/location-mapper');
const { 
    notifyAdminNaturalSlopeTrainingBooking, 
    notifyInstructorKuligaTrainingBooking 
} = require('../bot/admin-notify');

const router = express.Router();
const TIMEZONE = 'Asia/Yekaterinburg';

const formatDate = (date) => moment.tz(date, TIMEZONE).format('DD.MM.YYYY');
const formatTime = (time) => (time ? moment.tz(time, 'HH:mm:ss', TIMEZONE).format('HH:mm') : '');

/**
 * Форматирует название платежа для чека
 * @param {Object} params
 * @param {string} params.bookingType - 'individual' или 'group'
 * @param {string} params.location - 'kuliga' или 'vorona'
 * @param {string} params.sportType - 'ski' или 'snowboard'
 * @param {string} params.date - Дата тренировки
 * @param {string} params.time - Время тренировки
 * @param {string} params.programName - Название программы (опционально, для групповых)
 * @returns {string} - Форматированное название
 */
const formatPaymentDescription = ({ bookingType, location, sportType, date, time, programName }) => {
    const bookingTypeText = bookingType === 'individual' ? 'Индивидуальное занятие' : 'Групповое занятие';
    const locationText = location === 'vorona' ? 'Воронинские горки' : 'Кулига Клаб';
    const sportText = sportType === 'ski' ? 'Лыжи' : 'Сноуборд';
    const dateFormatted = formatDate(date);
    const timeFormatted = formatTime(time);
    
    if (programName) {
        return `Горностайл72, ${bookingTypeText}, ${locationText}, ${sportText}, ${programName}, ${dateFormatted} ${timeFormatted}`;
    }
    
    return `Горностайл72, ${bookingTypeText}, ${locationText}, ${sportText}, ${dateFormatted} ${timeFormatted}`;
};

// Нормализуем ФИО: приводим к нижнему регистру, убираем лишние пробелы
const normalizeFullName = (name = '') =>
    name
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

// Преобразование текстового уровня тренировки в числовой
const convertLevelToNumber = (level) => {
    if (level === null || level === undefined) return null;
    if (typeof level === 'number') return level;
    const levelMap = {
        beginner: 1,
        intermediate: 2,
        advanced: 3,
    };
    const normalized = level.toString().trim().toLowerCase();
    if (levelMap[normalized]) return levelMap[normalized];
    const parsed = parseInt(normalized, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Ищет ребенка по ФИО родителя с гибкими правилами сопоставления
 * - точное совпадение всего ФИО
 * - совпадение по подмножеству слов (Имя + Фамилия, Имя + Отчество и т.п.)
 * - учитываем год рождения, если передан (допускаем ±1 год)
 */
const findChildByFullName = async (parentId, fullName, birthYear, trx) => {
    const normalizedSearch = normalizeFullName(fullName);
    if (!normalizedSearch) return null;

    const { rows } = await trx.query(
        `SELECT id, full_name, birth_date, skill_level
         FROM children
         WHERE parent_id = $1`,
        [parentId]
    );

    let bestMatch = null;
    let bestScore = -1;

    const searchTokens = normalizedSearch.split(' ').filter(Boolean);

    rows.forEach((child) => {
        const childNameNorm = normalizeFullName(child.full_name);
        const childTokens = childNameNorm.split(' ').filter(Boolean);

        // Проверяем, что все токены из запроса содержатся в имени ребенка
        const allTokensMatch = searchTokens.every((token) => childTokens.includes(token));

        // Оцениваем степень совпадения (больше токенов — лучше)
        const tokenScore = allTokensMatch ? searchTokens.length : 0;

        // Проверяем год рождения, если указан
        let birthYearScore = 0;
        if (birthYear && child.birth_date) {
            const childYear = moment(child.birth_date).year();
            if (Math.abs(childYear - birthYear) <= 1) {
                birthYearScore = 1;
            }
        }

        const totalScore = tokenScore + birthYearScore;

        if (allTokensMatch && totalScore > bestScore) {
            bestScore = totalScore;
            bestMatch = child;
        }
    });

    return bestMatch;
};

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

// Генерация уникального реферального кода
const generateUniqueReferralCode = async (trx) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!isUnique && attempts < maxAttempts) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        // Проверяем уникальность
        const result = await trx.query(
            'SELECT COUNT(*) FROM clients WHERE referral_code = $1',
            [code]
        );
        
        isUnique = parseInt(result.rows[0].count) === 0;
        attempts++;
    }

    if (!isUnique) {
        throw new Error('Не удалось сгенерировать уникальный реферальный код');
    }

    return code;
};

// Генерация уникального номера кошелька
const generateUniqueWalletNumber = async (trx) => {
    const generateNumber = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
    let walletNumber, isUnique = false, attempts = 0;
    while (!isUnique && attempts < 10) {
        walletNumber = generateNumber();
        const result = await trx.query('SELECT COUNT(*) FROM wallets WHERE wallet_number = $1', [walletNumber]);
        if (result.rows[0].count === '0') isUnique = true;
        attempts++;
    }
    if (!isUnique) throw new Error('Не удалось сгенерировать уникальный номер кошелька');
    return walletNumber;
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
        const clientId = rows[0].id;
        
        // Проверяем наличие referral_code у существующего клиента
        const clientCheck = await trx.query(
            'SELECT referral_code FROM clients WHERE id = $1',
            [clientId]
        );
        const hasReferralCode = clientCheck.rows[0]?.referral_code;
        
        // Если нет referral_code, генерируем его
        if (!hasReferralCode) {
            const newReferralCode = await generateUniqueReferralCode(trx);
            await trx.query(
                'UPDATE clients SET referral_code = $1 WHERE id = $2',
                [newReferralCode, clientId]
            );
            console.log(`[KULIGA-BOOKING] ✅ Создан referral_code для существующего клиента #${clientId}: ${newReferralCode}`);
        }
        
        // Проверяем наличие кошелька у существующего клиента
        const walletCheck = await trx.query(
            'SELECT id FROM wallets WHERE client_id = $1 LIMIT 1',
            [clientId]
        );
        
        // Если нет кошелька, создаем его
        if (walletCheck.rows.length === 0) {
            const walletNumber = await generateUniqueWalletNumber(trx);
            await trx.query(
                'INSERT INTO wallets (client_id, wallet_number, balance) VALUES ($1, $2, 0)',
                [clientId, walletNumber]
            );
            console.log(`[KULIGA-BOOKING] ✅ Создан кошелек для существующего клиента #${clientId}: ${walletNumber}`);
        }
        
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
                clientId
            ]
        );
        return { id: clientId, telegram_id: rows[0].telegram_id };
    }

    // Клиент не найден, создаем нового с датой рождения из формы или временной датой
    // Email обязателен, проверка должна быть выполнена до вызова этой функции
    if (!client.email) {
        throw new Error('Email обязателен для создания клиента');
    }
    
    // Генерируем уникальный реферальный код для нового клиента
    const newReferralCode = await generateUniqueReferralCode(trx);
    console.log(`[KULIGA-BOOKING] Сгенерирован referral_code для нового клиента: ${newReferralCode}`);
    
    const insertResult = await trx.query(
        `INSERT INTO clients (full_name, phone, email, birth_date, referral_code, created_at, updated_at)
         VALUES ($1, $2, $3, COALESCE($4::date, '1900-01-01'::date), $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, telegram_id`,
        [client.fullName, phone, client.email.trim(), client.birthDate || null, newReferralCode]
    );

    const clientId = insertResult.rows[0].id;
    
    // Создаем кошелек для нового клиента
    const walletNumber = await generateUniqueWalletNumber(trx);
    await trx.query(
        'INSERT INTO wallets (client_id, wallet_number, balance) VALUES ($1, $2, 0)',
        [clientId, walletNumber]
    );
    console.log(`[KULIGA-BOOKING] ✅ Создан кошелек для нового клиента #${clientId}: ${walletNumber}`);

    return { id: clientId, telegram_id: insertResult.rows[0].telegram_id };
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

// Функция для освобождения мест из устаревших транзакций
const releaseExpiredGroupTrainingHolds = async () => {
    try {
        // Находим транзакции со статусом pending старше 5 минут, где бронирование не создано
        const expiredTransactions = await pool.query(
            `SELECT id, provider_raw_data
             FROM kuliga_transactions
             WHERE booking_id IS NULL
               AND status = 'pending'
               AND created_at < NOW() - INTERVAL '5 minutes'`
        );

        if (expiredTransactions.rows.length === 0) {
            return;
        }

        console.log(`🔍 Найдено ${expiredTransactions.rows.length} устаревших транзакций для освобождения мест`);

        for (const transaction of expiredTransactions.rows) {
            try {
                const rawData = transaction.provider_raw_data;
                if (!rawData || typeof rawData !== 'object') continue;

                const bookingData = rawData.bookingData;
                if (!bookingData || !bookingData.group_training_id || !bookingData.participants_count) {
                    continue;
                }

                const groupTrainingId = bookingData.group_training_id;
                const participantsCount = Number(bookingData.participants_count) || 1;

                // Освобождаем места в групповой тренировке
                await pool.query(
                    `UPDATE kuliga_group_trainings
                     SET current_participants = GREATEST(0, current_participants - $1),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $2`,
                    [participantsCount, groupTrainingId]
                );

                // Помечаем транзакцию как failed
                await pool.query(
                    `UPDATE kuliga_transactions
                     SET status = 'failed',
                         provider_status = 'Expired: автоматически освобождено после 5 минут ожидания'
                     WHERE id = $1`,
                    [transaction.id]
                );

                console.log(`🔓 Освобождено ${participantsCount} мест в групповой тренировке #${groupTrainingId} (транзакция #${transaction.id} истекла)`);
            } catch (error) {
                console.error(`❌ Ошибка при освобождении мест для транзакции #${transaction.id}:`, error);
            }
        }
    } catch (error) {
        console.error('❌ Ошибка при освобождении устаревших броней:', error);
        // Не прерываем выполнение основного запроса
    }
};

const createGroupBooking = async (req, res) => {
    // Освобождаем устаревшие брони перед созданием новой
    await releaseExpiredGroupTrainingHolds();

    const {
        fullName,
        birthDate,
        phone,
        email,
        groupTrainingId,
        slotId,
        instructorId,
        date,
        priceId,
        sportType,
        location,
        participantsCount = 1,
        participantsNames = [],
        participants = [], // Массив объектов {fullName, birthYear} из формы
        consentConfirmed,
    } = req.body || {};

    if (!consentConfirmed) {
        return res.status(400).json({ success: false, error: 'Необходимо согласие на обработку персональных данных' });
    }

    if (!fullName || !birthDate || !phone || !email) {
        return res.status(400).json({ success: false, error: 'Укажите ФИО, дату рождения, телефон и email' });
    }
    
    // Валидация формата email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ success: false, error: 'Неверный формат email' });
    }

    const normalizedPhone = normalizePhone(phone);
    // Определяем количество участников: из participantsCount или из массива participants
    let actualParticipantsCount = Number(participantsCount) || 1;
    if (Array.isArray(participants) && participants.length > 0) {
        actualParticipantsCount = Math.max(actualParticipantsCount, participants.length);
    }
    const safeCount = Math.max(1, Math.min(8, actualParticipantsCount));

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let training;
        let groupTrainingIdToUse = groupTrainingId;

        // НОВАЯ ЛОГИКА: Если нет groupTrainingId, но есть slotId - создаем групповую тренировку автоматически
        if (!groupTrainingIdToUse && slotId && instructorId && date && priceId) {
            console.log(`🔨 Автоматическое создание групповой тренировки на слот #${slotId} для ${safeCount} участников`);

            // Проверяем, не создана ли уже групповая тренировка на этот слот
            const existingGroupTraining = await client.query(
                    `SELECT id, instructor_id, slot_id, date, start_time, end_time, sport_type,
                            level, price_per_person, max_participants, current_participants, status, location
                 FROM kuliga_group_trainings
                 WHERE slot_id = $1 AND date = $2
                 FOR UPDATE`,
                [slotId, date]
            );

            if (existingGroupTraining.rows.length > 0) {
                // Используем существующую групповую тренировку
                training = existingGroupTraining.rows[0];
                groupTrainingIdToUse = training.id;
                console.log(`✅ Используем существующую групповую тренировку #${groupTrainingIdToUse} на слот #${slotId}`);
            } else {
                // Получаем данные слота
                const slotResult = await client.query(
                    `SELECT s.id AS slot_id,
                            s.instructor_id,
                            s.date,
                            s.start_time,
                            s.end_time,
                            s.status,
                            s.location AS slot_location,
                            i.full_name AS instructor_name,
                            i.sport_type AS instructor_sport_type
                     FROM kuliga_schedule_slots s
                     JOIN kuliga_instructors i ON i.id = s.instructor_id
                     WHERE s.id = $1 AND s.date = $2
                     FOR UPDATE`,
                    [slotId, date]
                );

                if (!slotResult.rows.length) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ success: false, error: 'Выбранный слот не найден' });
                }

                const slot = slotResult.rows[0];

                // Проверяем статус слота: должен быть available или hold (hold может быть от предыдущей попытки оплаты)
                // Если слот уже в статусе 'group' или 'booked', значит групповая тренировка уже создана
                if (slot.status === 'group') {
                    // Групповая тренировка уже создана на этот слот - используем её
                    // ВАЖНО: Пересчитываем current_participants из реальных подтверждённых бронирований
                    const existingGroupTraining = await client.query(
                        `SELECT 
                                kgt.id, 
                                kgt.instructor_id, 
                                kgt.slot_id, 
                                kgt.date, 
                                kgt.start_time, 
                                kgt.end_time, 
                                kgt.sport_type,
                                kgt.level,
                                kgt.price_per_person, 
                                kgt.max_participants, 
                                COALESCE((
                                    SELECT SUM(kb.participants_count)
                                    FROM kuliga_bookings kb
                                    WHERE kb.group_training_id = kgt.id AND kb.status = 'confirmed'
                                ), 0)::INTEGER as current_participants,
                                kgt.status, 
                                kgt.location
                         FROM kuliga_group_trainings kgt
                         WHERE kgt.slot_id = $1 AND kgt.date = $2
                         FOR UPDATE`,
                        [slot.slot_id, date]
                    );
                    if (existingGroupTraining.rows.length > 0) {
                        training = existingGroupTraining.rows[0];
                        groupTrainingIdToUse = training.id;
                        console.log(`✅ Используем существующую групповую тренировку #${groupTrainingIdToUse} на слот #${slot.slot_id} (слот уже в статусе 'group')`);
                        // Пропускаем создание новой групповой тренировки
                    } else {
                        await client.query('ROLLBACK');
                        return res.status(400).json({ success: false, error: 'Слот уже занят групповой тренировкой, но тренировка не найдена. Обратитесь к администратору.' });
                    }
                } else if (slot.status === 'booked') {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Слот уже занят. Выберите другое время.' });
                } else if (slot.status !== 'available' && slot.status !== 'hold') {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: `Слот недоступен (статус: ${slot.status}). Выберите другое время.` });
                }
                
                // Если слот в статусе 'group', то training уже найден выше, пропускаем создание
                if (slot.status !== 'group' || !training) {
                    // Создаем новую групповую тренировку только если слот не в статусе 'group'
                    
                    // Получаем данные тарифа
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
                const normalizedSport = sportType === 'snowboard' ? 'snowboard' : 'ski';
                const slotLocation = location || slot.slot_location || 'vorona';

                // Вычисляем цену за человека и максимальное количество участников
                // Если тариф на группу (например, 2 человека за 5000), то price.price - это общая цена за группу
                const baseParticipants = Math.max(2, Number(price.participants) || safeCount);
                const pricePerPerson = Number(price.price) / baseParticipants; // Цена за человека = общая цена / количество в тарифе
                const maxParticipants = Math.max(safeCount, baseParticipants, 8); // Максимум 8 участников

                // Нормализуем дату
                const normalizedDate = slot.date instanceof Date 
                    ? moment.tz(slot.date, TIMEZONE).format('YYYY-MM-DD')
                    : typeof slot.date === 'string' && slot.date.includes('T')
                        ? moment.tz(slot.date, TIMEZONE).format('YYYY-MM-DD')
                        : moment.tz(slot.date, 'YYYY-MM-DD', TIMEZONE).format('YYYY-MM-DD');

                // Создаем групповую тренировку
                const newGroupTrainingResult = await client.query(
                    `INSERT INTO kuliga_group_trainings (
                        instructor_id, slot_id, date, start_time, end_time,
                        sport_type, level, price_per_person,
                        min_participants, max_participants, current_participants, status, location
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 'open', $11)
                    RETURNING id, instructor_id, slot_id, date, start_time, end_time, sport_type,
                            level, price_per_person, max_participants, current_participants, status, location`,
                    [
                        slot.instructor_id,
                        slot.slot_id,
                        normalizedDate,
                        slot.start_time,
                        slot.end_time,
                        normalizedSport,
                        'beginner', // Уровень подготовки: по умолчанию начальный
                        pricePerPerson,
                        2, // min_participants
                        maxParticipants,
                        slotLocation
                    ]
                );

                training = newGroupTrainingResult.rows[0];
                groupTrainingIdToUse = training.id;

                // Обновляем статус слота на 'group'
                await client.query(
                    `UPDATE kuliga_schedule_slots
                     SET status = 'group', updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [slot.slot_id]
                );

                    console.log(`✅ Создана групповая тренировка #${groupTrainingIdToUse} на слот #${slot.slot_id} для ${safeCount} участников`);
                }
            }
        } else if (!groupTrainingIdToUse) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Не выбрано групповое занятие. Выберите слот или существующую групповую тренировку.' });
        } else {
            // Используем существующую групповую тренировку
            // ВАЖНО: Пересчитываем current_participants из реальных подтверждённых бронирований
            const groupResult = await client.query(
                    `SELECT 
                            kgt.id, 
                            kgt.instructor_id, 
                            kgt.slot_id, 
                            kgt.date, 
                            kgt.start_time, 
                            kgt.end_time, 
                            kgt.sport_type,
                            kgt.level,
                            kgt.price_per_person, 
                            kgt.max_participants, 
                            COALESCE((
                                SELECT SUM(kb.participants_count)
                                FROM kuliga_bookings kb
                                WHERE kb.group_training_id = kgt.id AND kb.status = 'confirmed'
                            ), 0)::INTEGER as current_participants,
                            kgt.status, 
                            kgt.location
                     FROM kuliga_group_trainings kgt
                     WHERE kgt.id = $1
                     FOR UPDATE`,
                [groupTrainingIdToUse]
            );

            if (!groupResult.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Групповое занятие не найдено' });
            }

            training = groupResult.rows[0];
        }

        if (training.status !== 'open' && training.status !== 'confirmed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Запись на это занятие временно недоступна' });
        }

        // Проверяем доступность мест (используем пересчитанное current_participants из подтверждённых бронирований)
        if (training.current_participants + safeCount > training.max_participants) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Недостаточно мест в группе' });
        }

        const clientRecord = await upsertClient(
            { fullName: fullName.trim(), birthDate: birthDate, phone: normalizedPhone, email: email.trim() },
            client
        );
        await ensurePrivacyConsent(clientRecord.id, client);

        // Получаем уровень клиента
        const clientLevelResult = await client.query(
            'SELECT COALESCE(skill_level, 1) AS skill_level FROM clients WHERE id = $1',
            [clientRecord.id]
        );
        const clientSkillLevel = Number(clientLevelResult.rows[0]?.skill_level) || 1;

        // Конвертируем требуемый уровень тренировки в число
        const trainingLevel = convertLevelToNumber(training.level);

        // Обрабатываем участников: поддерживаем как массив объектов {fullName, birthYear}, так и массив строк
        let namesArray = [];
        if (Array.isArray(participants) && participants.length > 0) {
            // Форма отправляет массив объектов {fullName, birthYear}
            namesArray = participants.map(p => (p.fullName || '').trim()).filter(Boolean);
            // Если первый участник - это заказчик, используем его имя
            if (namesArray.length === 0 || namesArray[0] !== fullName.trim()) {
                namesArray.unshift(fullName.trim());
            }
        } else if (Array.isArray(participantsNames) && participantsNames.length > 0) {
            // Старый формат: массив строк
            namesArray = participantsNames.map(name => (name || '').toString().trim()).filter(Boolean);
            if (namesArray.length === 0 || namesArray[0] !== fullName.trim()) {
                namesArray.unshift(fullName.trim());
            }
        } else {
            // Если участники не переданы, создаем массив из имени заказчика
            namesArray = Array.from({ length: safeCount }, (_, index) => {
                if (index === 0) {
                    return fullName.trim();
                }
                return fullName.trim(); // По умолчанию все участники - заказчик
            });
        }
        
        // Ограничиваем массив до safeCount
        namesArray = namesArray.slice(0, safeCount);

        // Проверка уровня участников для тренировок с уровнем >= 2
        if (trainingLevel !== null && trainingLevel >= 2) {
            const normalizedClientName = normalizeFullName(fullName);
            const fallbackBirthYear = birthDate ? moment(birthDate).year() : null;

            // Строим массив участников с годом рождения, если он есть
            let participantsData = [];
            if (Array.isArray(participants) && participants.length > 0) {
                participantsData = participants.map((p) => ({
                    fullName: (p.fullName || '').trim(),
                    birthYear: p.birthYear ? Number(p.birthYear) : null,
                }));
            } else {
                participantsData = namesArray.map((name) => ({
                    fullName: name,
                    birthYear: fallbackBirthYear,
                }));
            }

            // Гарантируем длину массива = safeCount
            while (participantsData.length < safeCount) {
                participantsData.push({ fullName: fullName.trim(), birthYear: fallbackBirthYear });
            }
            participantsData = participantsData.slice(0, safeCount);

            for (const participant of participantsData) {
                const normalizedParticipant = normalizeFullName(participant.fullName);
                const participantBirthYear = Number.isInteger(participant.birthYear)
                    ? Number(participant.birthYear)
                    : fallbackBirthYear;

                let participantLevel = null;

                // Если это сам заказчик
                if (normalizedParticipant && normalizedParticipant === normalizedClientName) {
                    participantLevel = clientSkillLevel;
                } else {
                    // Пытаемся найти ребенка по ФИО
                    const child = await findChildByFullName(
                        clientRecord.id,
                        participant.fullName,
                        participantBirthYear,
                        client
                    );
                    if (child) {
                        participantLevel = Number(child.skill_level) || 0;
                    }
                }

                if (participantLevel === null || participantLevel < trainingLevel) {
                    await client.query('ROLLBACK');
                    const foundText =
                        participantLevel === null
                            ? 'Уровень участника не найден'
                            : `Уровень участника: ${participantLevel}`;
                    return res.status(400).json({
                        success: false,
                        error: `Для участника "${participant.fullName}" требуется уровень не ниже ${trainingLevel}. ${foundText}. Зарегистрируйтесь в боте и попросите администратора присвоить уровень.`,
                    });
                }
            }
        }

        const pricePerPerson = Number(training.price_per_person);
        const totalPrice = pricePerPerson * safeCount;

        // НОВАЯ ЛОГИКА: Бронирование создаётся ТОЛЬКО после успешной оплаты
        // 1. НЕ создаём бронирование сразу
        // 2. НЕ увеличиваем current_participants
        // 3. Создаём транзакцию с данными для будущего бронирования

        const description = formatPaymentDescription({
            bookingType: 'group',
            location: training.location || 'kuliga',
            sportType: training.sport_type,
            date: training.date,
            time: training.start_time
        });

        // Сохраняем данные для будущего создания бронирования после оплаты
        const bookingData = {
            client_id: clientRecord.id,
            booking_type: 'group',
            group_training_id: groupTrainingIdToUse,
            date: training.date instanceof Date 
                ? moment.tz(training.date, TIMEZONE).format('YYYY-MM-DD')
                : typeof training.date === 'string' && training.date.includes('T')
                    ? moment.tz(training.date, TIMEZONE).format('YYYY-MM-DD')
                    : moment.tz(training.date, 'YYYY-MM-DD', TIMEZONE).format('YYYY-MM-DD'),
            start_time: training.start_time,
            end_time: training.end_time,
            sport_type: training.sport_type,
            participants_count: safeCount,
            participants_names: namesArray,
            price_total: totalPrice,
            price_per_person: pricePerPerson,
            location: training.location || 'kuliga',
            // Дополнительные данные для уведомлений
            client_name: fullName,
            client_phone: normalizedPhone,
            client_email: email?.trim() || null,
            instructor_id: training.instructor_id || null,
        };
        
        console.log(`📝 [GroupBooking] Сохранение bookingData: client_id=${bookingData.client_id}, client_email=${bookingData.client_email}, client_name=${bookingData.client_name}`);

        // Создаём транзакцию БЕЗ бронирования (booking_id = NULL)
        // Данные бронирования сохраняем в provider_raw_data
        const rawDataForInsert = { bookingData };
        const transactionResult = await client.query(
            `INSERT INTO kuliga_transactions (
                client_id, 
                booking_id, 
                type, 
                amount, 
                status, 
                description,
                provider_raw_data
            )
             VALUES ($1, NULL, 'payment', $2, 'pending', $3, $4)
             RETURNING id`,
            [clientRecord.id, totalPrice, description, JSON.stringify(rawDataForInsert)]
        );

        const transactionId = transactionResult.rows[0].id;

        // ВРЕМЕННАЯ БЛОКИРОВКА МЕСТ: Увеличиваем current_participants на время оплаты
        // Это предотвращает двойное бронирование, пока клиент оплачивает
        // При успешной оплате места останутся занятыми, при неудаче - вернутся обратно
        await client.query(
            `UPDATE kuliga_group_trainings
             SET current_participants = current_participants + $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [safeCount, training.id]
        );
        
        console.log(`🔒 Временно забронировано ${safeCount} мест в групповой тренировке #${training.id} для транзакции #${transactionId}`);

        await client.query('COMMIT');

        let payment;
        const paymentMethod = req.body.paymentMethod || 'card';
        try {
            const provider = PaymentProviderFactory.create();
            payment = await provider.initPayment({
                orderId: `gornostyle72-winter-${transactionId}`, // Используем transactionId вместо bookingId
                amount: totalPrice,
                description,
                customerPhone: normalizedPhone,
                customerEmail: email?.trim() || undefined,
                clientId: clientRecord.id, // Передаем client_id для формирования deep link
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
                paymentMethod: paymentMethod,
            });
        } catch (paymentError) {
            // При ошибке инициализации платежа помечаем транзакцию как failed
            // И ВОЗВРАЩАЕМ места в групповой тренировке
            await pool.query(
                `UPDATE kuliga_transactions
                 SET status = 'failed', provider_status = $1
                 WHERE id = $2`,
                [paymentError.message.slice(0, 120), transactionId]
            );
            
            // Возвращаем места в групповой тренировке
            await pool.query(
                `UPDATE kuliga_group_trainings
                 SET current_participants = current_participants - $1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [safeCount, groupTrainingIdToUse]
            );
            
            console.log(`🔓 Возвращено ${safeCount} мест в групповой тренировке #${groupTrainingIdToUse} (ошибка инициализации платежа)`);
            
            throw paymentError;
        }

        const providerName = process.env.PAYMENT_PROVIDER || 'tochka';
        
        // Обновляем транзакцию с данными от провайдера
        // КРИТИЧНО: Используем исходный rawDataForInsert и добавляем к нему paymentData
        // Это гарантирует, что bookingData не потеряется
        const paymentData = payment.rawData || payment;
        // Удаляем bookingData из paymentData если он там есть (чтобы не перезаписать наш)
        if (paymentData && typeof paymentData === 'object') {
            delete paymentData.bookingData;
        }
        const rawData = {
            ...rawDataForInsert, // bookingData уже здесь
            paymentData: paymentData
        };
        
        console.log(`💾 [Booking] Обновление транзакции #${transactionId} с paymentData, bookingData сохранен: client_id=${rawDataForInsert.bookingData?.client_id}`);
        
        await pool.query(
            `UPDATE kuliga_transactions
             SET payment_provider = $1,
                 provider_payment_id = $2,
                 provider_order_id = $3,
                 provider_status = $4,
                 payment_method = $5,
                 provider_raw_data = $6
             WHERE id = $7`,
            [
                providerName,
                payment.paymentId,
                `gornostyle72-winter-${transactionId}`,
                payment.status,
                paymentMethod,
                JSON.stringify(rawData),
                transactionId
            ]
        );

        // УВЕДОМЛЕНИЯ НЕ ОТПРАВЛЯЕМ ЗДЕСЬ!
        // Они будут отправлены при обработке webhook после создания бронирования

        return res.json({ 
            success: true, 
            transactionId, // Возвращаем transactionId вместо bookingId
            paymentUrl: payment.paymentURL,
            paymentMethod: paymentMethod,
            qrCodeUrl: payment.qrCodeUrl || null
        });
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
        location, // МИГРАЦИЯ 038: Место проведения тренировки
        participants = [],
        notification = {},
        payerParticipation = 'self',
        consentConfirmed,
        paymentMethod = 'card', // 'card' | 'sbp'
        groupTrainingLevel = null,
    } = req.body || {};

    if (!consentConfirmed) {
        return res.status(400).json({ success: false, error: 'Необходимо согласие на обработку персональных данных' });
    }

    if (!fullName || !birthDate || !phone || !email) {
        return res.status(400).json({ success: false, error: 'Укажите ФИО, дату рождения, телефон и email' });
    }
    
    // Валидация формата email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ success: false, error: 'Неверный формат email' });
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

    // Email теперь обязателен всегда, эта проверка больше не нужна

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
            { fullName: fullName.trim(), birthDate: birthDate, phone: normalizedPhone, email: email.trim() },
            client
        );

        // Если выбран Telegram, но клиент еще не зарегистрирован в боте - это не критично
        // Бот может быть запущен после оплаты, или клиент уже зарегистрирован
        // Не блокируем создание бронирования, просто логируем
        if (notifyTelegram && !clientRecord.telegram_id) {
            console.log(`⚠️ Клиент ${fullName} (${normalizedPhone}) выбрал Telegram уведомления, но еще не зарегистрирован в боте. Бронь создана, но уведомления в Telegram будут отправлены после регистрации в боте.`);
        }

        await ensurePrivacyConsent(clientRecord.id, client);

        // Проверка уровня для индивидуальной/групповой брони, если передан требуемый уровень (например, слот с уровнем)
        const requiredLevel = convertLevelToNumber(groupTrainingLevel);
        if (requiredLevel !== null && requiredLevel >= 2) {
            const clientLevelResult = await client.query(
                'SELECT COALESCE(skill_level, 1) AS skill_level FROM clients WHERE id = $1',
                [clientRecord.id]
            );
            const clientSkillLevel = Number(clientLevelResult.rows[0]?.skill_level) || 1;
            const normalizedClientName = normalizeFullName(fullName);
            const fallbackBirthYear = birthDate ? moment(birthDate).year() : null;

            for (const participant of participants) {
                const normalizedParticipant = normalizeFullName(participant.fullName);
                const participantBirthYear = Number.isInteger(Number(participant.birthYear))
                    ? Number(participant.birthYear)
                    : fallbackBirthYear;

                let participantLevel = null;

                if (normalizedParticipant && normalizedParticipant === normalizedClientName) {
                    participantLevel = clientSkillLevel;
                } else {
                    const child = await findChildByFullName(
                        clientRecord.id,
                        participant.fullName,
                        participantBirthYear,
                        client
                    );
                    if (child) {
                        participantLevel = Number(child.skill_level) || 0;
                    }
                }

                if (participantLevel === null || participantLevel < requiredLevel) {
                    await client.query('ROLLBACK');
                    const foundText =
                        participantLevel === null
                            ? 'Уровень участника не найден'
                            : `Уровень участника: ${participantLevel}`;
                    return res.status(400).json({
                        success: false,
                        error: `Для участника "${participant.fullName}" требуется уровень не ниже ${requiredLevel}. ${foundText}. Зарегистрируйтесь в боте и попросите администратора присвоить уровень.`,
                    });
                }
            }
        }

        const slotResult = await client.query(
            `SELECT s.id AS slot_id,
                    s.instructor_id,
                    s.date,
                    s.start_time,
                    s.end_time,
                    s.status,
                    s.location AS slot_location,
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

        // МИГРАЦИЯ 038: Проверка location
        const slotLocation = slot.slot_location || 'kuliga';
        const requestedLocation = location || 'kuliga';
        if (slotLocation !== requestedLocation) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Выбранный слот не соответствует выбранному месту проведения' });
        }

        const slotDuration = minutesBetween(slot.date, slot.start_time, slot.end_time);
        const requiredDuration = Number(price.duration) || 60;

        if (slotDuration < requiredDuration) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Длительность выбранного слота меньше требуемой по тарифу' });
        }

        // НОВАЯ ЛОГИКА: Бронирование создаётся ТОЛЬКО после успешной оплаты
        // 1. НЕ резервируем слот сразу (он остаётся available до оплаты)
        // 2. НЕ создаём бронирование
        // 3. Создаём транзакцию с данными для будущего бронирования
        
        const notificationMethod = notifyEmail && notifyTelegram ? 'both' : notifyTelegram ? 'telegram' : notifyEmail ? 'email' : 'none';
        const payerRides = payerParticipation !== 'other';

        const description = formatPaymentDescription({
            bookingType: 'individual',
            location: slotLocation,
            sportType: normalizedSport,
            date: slot.date,
            time: slot.start_time
        });

        // Сохраняем данные для будущего создания бронирования после оплаты
        // Нормализуем дату: slot.date может быть Date объектом или строкой, приводим к YYYY-MM-DD
        const normalizedDate = slot.date instanceof Date 
            ? moment.tz(slot.date, TIMEZONE).format('YYYY-MM-DD')
            : typeof slot.date === 'string' && slot.date.includes('T')
                ? moment.tz(slot.date, TIMEZONE).format('YYYY-MM-DD')
                : moment.tz(slot.date, 'YYYY-MM-DD', TIMEZONE).format('YYYY-MM-DD');
        
        const bookingData = {
            client_id: clientRecord.id,
            booking_type: 'individual',
            instructor_id: slot.instructor_id,
            slot_id: slot.slot_id,
            date: normalizedDate,
            start_time: slot.start_time,
            end_time: slot.end_time,
            sport_type: normalizedSport,
            participants_count: participantsCount,
            participants_names: participantsNames,
            participants_birth_years: participantsBirthYears,
            price_total: totalPrice,
            price_per_person: pricePerPerson,
            price_id: price.id,
            notification_method: notificationMethod,
            payer_rides: payerRides,
            location: slotLocation,
            // Дополнительные данные для уведомлений
            client_name: fullName,
            client_phone: normalizedPhone,
            client_email: email?.trim() || null,
            instructor_name: slot.instructor_name,
            price_duration: price.duration,
        };
        
        console.log(`📝 [IndividualBooking] Сохранение bookingData: client_id=${bookingData.client_id}, client_email=${bookingData.client_email}, client_name=${bookingData.client_name}`);

        // Создаём транзакцию БЕЗ бронирования (booking_id = NULL)
        // Данные бронирования сохраняем в provider_raw_data
        const rawDataForInsert = { bookingData };
        const transactionResult = await client.query(
            `INSERT INTO kuliga_transactions (
                client_id, 
                booking_id, 
                type, 
                amount, 
                status, 
                description,
                provider_raw_data
            )
             VALUES ($1, NULL, 'payment', $2, 'pending', $3, $4)
             RETURNING id`,
            [clientRecord.id, totalPrice, description, JSON.stringify(rawDataForInsert)]
        );

        const transactionId = transactionResult.rows[0].id;

        // ВРЕМЕННАЯ БЛОКИРОВКА (HOLD): Ставим слот на hold на 5 минут
        // Это предотвращает двойное бронирование, пока клиент оплачивает
        // Вебхуки от банка приходят быстро, поэтому 5 минут достаточно
        await client.query(
            `UPDATE kuliga_schedule_slots
             SET status = 'hold',
                 hold_until = NOW() + INTERVAL '5 minutes',
                 hold_transaction_id = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [transactionId, slot.slot_id]
        );
        
        console.log(`🔒 Слот #${slot.slot_id} заблокирован (hold) на 5 минут для транзакции #${transactionId}`);

        await client.query('COMMIT');

        let payment;
        try {
            const provider = PaymentProviderFactory.create();
            payment = await provider.initPayment({
                orderId: `gornostyle72-winter-${transactionId}`, // Используем transactionId вместо bookingId
                amount: totalPrice,
                description,
                customerPhone: normalizedPhone,
                customerEmail: email?.trim() || undefined,
                clientId: clientRecord.id, // Передаем client_id для формирования deep link
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
                paymentMethod: paymentMethod,
            });
        } catch (paymentError) {
            // При ошибке инициализации платежа помечаем транзакцию как failed
            // И СНИМАЕМ HOLD со слота
            await pool.query(
                `UPDATE kuliga_transactions
                 SET status = 'failed', provider_status = $1
                 WHERE id = $2`,
                [paymentError.message.slice(0, 120), transactionId]
            );
            
            // Снимаем hold со слота
            await pool.query(
                `UPDATE kuliga_schedule_slots
                 SET status = 'available',
                     hold_until = NULL,
                     hold_transaction_id = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND hold_transaction_id = $2`,
                [slot.slot_id, transactionId]
            );
            
            console.log(`🔓 Hold снят со слота #${slot.slot_id} (ошибка инициализации платежа)`);
            
            throw paymentError;
        }

        const providerName = process.env.PAYMENT_PROVIDER || 'tochka';
        
        // Обновляем транзакцию с данными от провайдера
        // КРИТИЧНО: Используем исходный rawDataForInsert и добавляем к нему paymentData
        // Это гарантирует, что bookingData не потеряется
        const paymentData = payment.rawData || payment;
        // Удаляем bookingData из paymentData если он там есть (чтобы не перезаписать наш)
        if (paymentData && typeof paymentData === 'object') {
            delete paymentData.bookingData;
        }
        const rawData = {
            ...rawDataForInsert, // bookingData уже здесь
            paymentData: paymentData
        };
        
        console.log(`💾 [Booking] Обновление транзакции #${transactionId} с paymentData, bookingData сохранен: client_id=${rawDataForInsert.bookingData?.client_id}`);
        
        await pool.query(
            `UPDATE kuliga_transactions
             SET payment_provider = $1,
                 provider_payment_id = $2,
                 provider_order_id = $3,
                 provider_status = $4,
                 payment_method = $5,
                 provider_raw_data = $6
             WHERE id = $7`,
            [
                providerName,
                payment.paymentId,
                `gornostyle72-winter-${transactionId}`,
                payment.status,
                paymentMethod,
                JSON.stringify(rawData),
                transactionId
            ]
        );

        // УВЕДОМЛЕНИЯ НЕ ОТПРАВЛЯЕМ ЗДЕСЬ!
        // Они будут отправлены при обработке webhook после создания бронирования

        return res.json({ 
            success: true, 
            transactionId, // Возвращаем transactionId вместо bookingId
            paymentUrl: payment.paymentURL,
            paymentMethod: paymentMethod,
            qrCodeUrl: payment.qrCodeUrl || null
        });
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
    const { date, sport = 'ski', duration = 60, location } = req.query || {};

    if (!date) {
        return res.status(400).json({ success: false, error: 'Укажите дату' });
    }

    if (!isDateWithinRange(date)) {
        return res.status(400).json({ success: false, error: 'Дата вне допустимого диапазона' });
    }

    const normalizedSport = sport === 'snowboard' ? 'snowboard' : 'ski';
    const requiredDuration = Math.max(30, Math.min(180, parseInt(duration, 10) || 60));

    try {
        let query = `SELECT s.id AS slot_id,
                    s.instructor_id,
                    s.date,
                    s.start_time,
                    s.end_time,
                    s.status,
                    i.full_name AS instructor_name,
                    i.sport_type AS instructor_sport_type,
                    i.photo_url AS instructor_photo_url,
                    i.description AS instructor_description,
                    i.is_active AS instructor_active,
                    s.location,
                    kgt.id AS group_training_id,
                    kgt.level AS group_training_level,
                    kgt.description AS group_training_description,
                    kgt.max_participants AS group_training_max_participants,
                    COALESCE((
                        SELECT SUM(kb.participants_count)
                        FROM kuliga_bookings kb
                        WHERE kb.group_training_id = kgt.id AND kb.status = 'confirmed'
                    ), 0)::INTEGER AS group_training_current_participants
             FROM kuliga_schedule_slots s
             JOIN kuliga_instructors i ON i.id = s.instructor_id
             LEFT JOIN kuliga_group_trainings kgt ON kgt.slot_id = s.id 
                 AND kgt.status IN ('open', 'confirmed')
             WHERE s.date = $1
               AND s.status IN ('available', 'group')  -- Включаем слоты с групповыми тренировками
               AND i.is_active = TRUE
               AND (i.sport_type = $2 OR i.sport_type = 'both')
               AND (s.hold_until IS NULL OR s.hold_until < NOW())`; // Исключаем слоты с активным hold
        const params = [date, normalizedSport];
        
        // Фильтр по location, если указан
        if (location && isValidLocation(location)) {
            params.push(location);
            query += ` AND s.location = $${params.length}`;
        }
        
        query += ' ORDER BY s.start_time ASC';

        const { rows } = await pool.query(query, params);

        const now = moment.tz(TIMEZONE);
        const todayStr = now.format('YYYY-MM-DD');

        const available = rows
            // Отсекаем слоты, чье время уже прошло (для текущей даты)
            .filter((slot) => {
                const durationOk = minutesBetween(date, slot.start_time, slot.end_time) >= requiredDuration;
                if (!durationOk) return false;

                if (date === todayStr) {
                    // ВАЖНО: используем строковый параметр date (YYYY-MM-DD), а не slot.date (Timestamp),
                    // иначе формат не совпадает и момент может вернуть невалидную дату.
                    const slotStart = moment.tz(`${date} ${slot.start_time}`, 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
                    if (!slotStart.isValid()) {
                        // Если по какой-то причине время не распарсилось — на всякий случай показываем слот,
                        // чтобы не терять слоты из-за ошибок парсинга.
                        return true;
                    }
                    return slotStart.isAfter(now);
                }
                return true;
            })
            .map((slot) => {
                // Преобразуем уровень групповой тренировки в числовой формат
                let skillLevel = null;
                if (slot.group_training_level) {
                    if (typeof slot.group_training_level === 'number') {
                        skillLevel = slot.group_training_level;
                    } else if (typeof slot.group_training_level === 'string') {
                        // Преобразуем текстовый уровень в число
                        const levelMap = {
                            'beginner': 1,
                            'intermediate': 2,
                            'advanced': 3
                        };
                        const levelLower = slot.group_training_level.toLowerCase();
                        skillLevel = levelMap[levelLower] || parseInt(slot.group_training_level) || null;
                    }
                }

                return {
                    slot_id: slot.slot_id,
                    instructor_id: slot.instructor_id,
                    date: slot.date,
                    start_time: slot.start_time,
                    end_time: slot.end_time,
                    instructor_name: slot.instructor_name,
                    instructor_sport_type: slot.instructor_sport_type,
                    instructor_photo_url: slot.instructor_photo_url,
                    instructor_description: slot.instructor_description,
                    // Информация о групповой тренировке, если она есть на слоте
                    group_training: slot.group_training_id ? {
                        id: slot.group_training_id,
                        level: skillLevel,
                        description: slot.group_training_description || null,
                        max_participants: slot.group_training_max_participants || null,
                        current_participants: slot.group_training_current_participants || 0
                    } : null
                };
            });

        return res.json({ success: true, data: available });
    } catch (error) {
        console.error('Ошибка получения свободных слотов Кулиги:', error);
        return res.status(500).json({ success: false, error: 'Не удалось получить свободные слоты' });
    }
});

// GET /api/kuliga/availability/dates - Получение дат с доступными слотами для диапазона
router.get('/availability/dates', async (req, res) => {
    const { from, to, sport = 'ski', duration = 60, location } = req.query || {};

    if (!from || !to) {
        return res.status(400).json({ success: false, error: 'Укажите параметры from и to (даты в формате YYYY-MM-DD)' });
    }

    const normalizedSport = sport === 'snowboard' ? 'snowboard' : 'ski';
    const requiredDuration = Math.max(30, Math.min(180, parseInt(duration, 10) || 60));

    try {
        // Оптимизированный запрос: сразу проверяем длительность слотов
        // Важно: при SELECT DISTINCT все выражения в ORDER BY должны быть в SELECT списке
        let query = `SELECT DISTINCT s.date::text as date
             FROM kuliga_schedule_slots s
             JOIN kuliga_instructors i ON i.id = s.instructor_id
             WHERE s.date >= $1::date 
               AND s.date <= $2::date
               AND s.status = 'available'
               AND i.is_active = TRUE
               AND (i.sport_type = $3 OR i.sport_type = 'both')
               AND EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60 >= $4`;
        const params = [from, to, normalizedSport, requiredDuration];
        
        // Фильтр по location, если указан
        if (location && isValidLocation(location)) {
            params.push(location);
            query += ` AND s.location = $${params.length}`;
        }
        
        // При SELECT DISTINCT нужно использовать алиас из SELECT списка
        query += ' ORDER BY date ASC';

        const { rows } = await pool.query(query, params);
        const availableDates = rows.map(row => row.date);

        return res.json({ success: true, data: availableDates });
    } catch (error) {
        console.error('Ошибка получения доступных дат Кулиги:', error);
        return res.status(500).json({ success: false, error: 'Не удалось получить доступные даты' });
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

/**
 * Создание бронирования для программы
 * Находит свободный слот у назначенного инструктора, создает групповую тренировку и бронирование
 */
const createProgramBooking = async (req, res) => {
    // Освобождаем устаревшие брони перед созданием новой
    await releaseExpiredGroupTrainingHolds();

    const {
        programId,
        date,
        time,
        fullName,
        birthDate,
        phone,
        email,
        participantsCount = 1,
        participantsNames = [],
        participants = [], // Массив объектов {fullName, birthYear} из формы
        consentConfirmed,
    } = req.body || {};

    if (!consentConfirmed) {
        return res.status(400).json({ success: false, error: 'Необходимо согласие на обработку персональных данных' });
    }

    if (!fullName || !birthDate || !phone || !email) {
        return res.status(400).json({ success: false, error: 'Укажите ФИО, дату рождения, телефон и email' });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ success: false, error: 'Неверный формат email' });
    }

    if (!programId || !date || !time) {
        return res.status(400).json({ success: false, error: 'Укажите программу, дату и время' });
    }

    const normalizedPhone = normalizePhone(phone);
    // Определяем количество участников: из participantsCount или из массива participants
    let actualParticipantsCount = Number(participantsCount) || 1;
    if (Array.isArray(participants) && participants.length > 0) {
        actualParticipantsCount = Math.max(actualParticipantsCount, participants.length);
    }
    const safeCount = Math.max(1, Math.min(8, actualParticipantsCount));

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Получаем информацию о программе
        const programResult = await client.query(
            `SELECT p.*, 
                    COALESCE(
                        array_agg(pi.instructor_id) FILTER (WHERE pi.instructor_id IS NOT NULL),
                        ARRAY[]::integer[]
                    ) as instructor_ids
             FROM kuliga_programs p
             LEFT JOIN kuliga_program_instructors pi ON p.id = pi.program_id
             WHERE p.id = $1 AND p.is_active = TRUE
             GROUP BY p.id`,
            [programId]
        );

        if (!programResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Программа не найдена или неактивна' });
        }

        const program = programResult.rows[0];

        // Вычисляем время окончания тренировки
        // Нормализуем формат времени: "10:15" -> "10:15:00"
        let normalizedTime = time.trim();
        if (normalizedTime.length === 5 && normalizedTime.includes(':')) {
            normalizedTime = normalizedTime + ':00';
        }
        
        console.log(`🕐 [ProgramBooking] Парсинг времени:`, {
            originalTime: time,
            normalizedTime,
            date,
            combined: `${date} ${normalizedTime}`
        });
        
        const startTime = moment.tz(`${date} ${normalizedTime}`, 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
        
        if (!startTime.isValid()) {
            throw new Error(`Некорректный формат даты/времени: date="${date}", time="${time}" (нормализовано: "${normalizedTime}")`);
        }
        
        const endTime = startTime.clone().add(program.training_duration, 'minutes');
        const dateStr = startTime.format('YYYY-MM-DD');
        const startTimeStr = startTime.format('HH:mm:ss');
        const endTimeStr = endTime.format('HH:mm:ss');
        
        console.log(`✅ [ProgramBooking] Время успешно распарсено:`, {
            dateStr,
            startTimeStr,
            endTimeStr
        });

        // НОВАЯ ЛОГИКА: Ищем уже созданную тренировку из программы
        // Программы автоматически генерируют тренировки без инструктора
        // ВАЖНО: Пересчитываем current_participants из реальных подтверждённых бронирований
        const existingTrainingResult = await client.query(
            `SELECT 
                    kgt.id, 
                    COALESCE((
                        SELECT SUM(kb.participants_count)
                        FROM kuliga_bookings kb
                        WHERE kb.group_training_id = kgt.id AND kb.status = 'confirmed'
                    ), 0)::INTEGER as current_participants,
                    kgt.max_participants, 
                    kgt.status, 
                    kgt.instructor_id, 
                    kgt.price_per_person
             FROM kuliga_group_trainings kgt
             WHERE kgt.program_id = $1 
               AND kgt.date = $2 
               AND kgt.start_time = $3
               AND kgt.status IN ('open', 'confirmed')
             FOR UPDATE`,
            [programId, dateStr, startTimeStr]
        );

        if (existingTrainingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            const locationName = program.location === 'vorona' ? 'Воронинских горках' : 'Кулиге';
            const timeFormatted = formatTime(startTimeStr);
            const dateFormatted = formatDate(dateStr);
            
            return res.status(400).json({ 
                success: false, 
                error: `Тренировка программы "${program.name}" на ${dateFormatted} в ${timeFormatted} не найдена. Возможно, тренировки еще не сгенерированы. Обратитесь к администратору.` 
            });
        }

        const groupTraining = existingTrainingResult.rows[0];

        // Проверяем наличие мест (используем пересчитанное current_participants из подтверждённых бронирований)
        if (groupTraining.current_participants + safeCount > groupTraining.max_participants) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Недостаточно мест в группе' });
        }

        // Проверяем, назначен ли инструктор (предупреждение, но не блокируем бронирование)
        if (!groupTraining.instructor_id) {
            console.log(`⚠️ Бронирование на тренировку программы ID=${programId} без назначенного инструктора`);
        }

        // Создаем или обновляем клиента
        const clientRecord = await upsertClient(
            { fullName: fullName.trim(), birthDate: birthDate, phone: normalizedPhone, email: email.trim() },
            client
        );
        await ensurePrivacyConsent(clientRecord.id, client);

        // Обрабатываем участников: поддерживаем как массив объектов {fullName, birthYear}, так и массив строк
        let namesArray = [];
        if (Array.isArray(participants) && participants.length > 0) {
            // Форма отправляет массив объектов {fullName, birthYear}
            namesArray = participants.map(p => (p.fullName || '').trim()).filter(Boolean);
            // Если первый участник - это заказчик, используем его имя
            if (namesArray.length === 0 || namesArray[0] !== fullName.trim()) {
                namesArray.unshift(fullName.trim());
            }
        } else if (Array.isArray(participantsNames) && participantsNames.length > 0) {
            // Старый формат: массив строк
            namesArray = participantsNames.map(name => (name || '').toString().trim()).filter(Boolean);
            if (namesArray.length === 0 || namesArray[0] !== fullName.trim()) {
                namesArray.unshift(fullName.trim());
            }
        } else {
            // Если участники не переданы, создаем массив из имени заказчика
            namesArray = Array.from({ length: safeCount }, (_, index) => {
                if (index === 0) {
                    return fullName.trim();
                }
                return fullName.trim(); // По умолчанию все участники - заказчик
            });
        }
        
        // Ограничиваем массив до safeCount
        namesArray = namesArray.slice(0, safeCount);

        console.log(`💰 [ProgramBooking] Расчет цены:`, {
            groupTrainingId: groupTraining.id,
            price_per_person_raw: groupTraining.price_per_person,
            price_per_person_type: typeof groupTraining.price_per_person,
            safeCount,
            safeCount_type: typeof safeCount
        });

        const pricePerPerson = Number(groupTraining.price_per_person);
        
        if (isNaN(pricePerPerson) || pricePerPerson <= 0) {
            console.error(`❌ [ProgramBooking] Некорректная цена за человека:`, {
                price_per_person_raw: groupTraining.price_per_person,
                pricePerPerson,
                groupTrainingId: groupTraining.id,
                programId,
                programName: program.name
            });
            throw new Error(`Некорректная цена за человека в тренировке программы "${program.name}". Обратитесь к администратору.`);
        }
        
        if (isNaN(safeCount) || safeCount <= 0) {
            console.error(`❌ [ProgramBooking] Некорректное количество участников:`, {
                safeCount,
                participantsCount,
                participantsLength: participants ? participants.length : 0,
                participantsNamesLength: participantsNames ? participantsNames.length : 0
            });
            throw new Error(`Некорректное количество участников: ${safeCount}`);
        }
        
        const totalPrice = pricePerPerson * safeCount;
        
        console.log(`✅ [ProgramBooking] Цена рассчитана:`, {
            pricePerPerson,
            safeCount,
            totalPrice
        });
        
        if (isNaN(totalPrice) || totalPrice <= 0) {
            console.error(`❌ [ProgramBooking] Некорректная общая сумма:`, {
                pricePerPerson,
                safeCount,
                totalPrice,
                calculation: `${pricePerPerson} * ${safeCount} = ${totalPrice}`
            });
            throw new Error(`Некорректная общая сумма платежа: ${totalPrice}`);
        }

        // Проверяем корректность данных перед формированием description
        console.log(`🔍 [ProgramBooking] Данные для description:`, {
            date,
            time,
            dateStr,
            startTimeStr,
            programLocation: program.location,
            programSportType: program.sport_type,
            programName: program.name,
            pricePerPerson,
            totalPrice,
            safeCount
        });

        if (!dateStr || !startTimeStr) {
            throw new Error(`Некорректные дата или время: date="${date}", time="${time}"`);
        }

        if (!program.sport_type) {
            console.warn(`⚠️ [ProgramBooking] program.sport_type отсутствует, используем 'ski' по умолчанию`);
        }

        // НОВАЯ ЛОГИКА: Бронирование создаётся ТОЛЬКО после успешной оплаты
        // 1. НЕ создаём бронирование сразу
        // 2. НЕ увеличиваем current_participants сразу (только временно)
        // 3. Создаём транзакцию с данными для будущего бронирования

        const description = formatPaymentDescription({
            bookingType: 'group',
            location: program.location || 'kuliga',
            sportType: program.sport_type || 'ski',
            date: dateStr,
            time: startTimeStr,
            programName: program.name
        });

        console.log(`📝 [ProgramBooking] Сформированное описание платежа: "${description}"`);

        if (!description || description.trim() === '') {
            throw new Error('Не удалось сформировать описание платежа');
        }

        // Сохраняем данные для будущего создания бронирования после оплаты
        const bookingData = {
            client_id: clientRecord.id,
            booking_type: 'group',
            group_training_id: groupTraining.id,
            date: dateStr,
            start_time: startTimeStr,
            end_time: endTimeStr,
            sport_type: program.sport_type,
            participants_count: safeCount,
            participants_names: namesArray,
            price_total: totalPrice,
            price_per_person: pricePerPerson,
            location: program.location || 'kuliga',
            // Дополнительные данные для уведомлений
            client_name: fullName,
            client_phone: normalizedPhone,
            client_email: email?.trim() || null,
            instructor_id: groupTraining.instructor_id || null,
            program_id: programId,
            program_name: program.name,
        };

        // Создаём транзакцию БЕЗ бронирования (booking_id = NULL)
        // Данные бронирования сохраняем в provider_raw_data
        const rawDataForInsert = { bookingData };
        const transactionResult = await client.query(
            `INSERT INTO kuliga_transactions (
                client_id, 
                booking_id, 
                type, 
                amount, 
                status, 
                description,
                provider_raw_data
            )
             VALUES ($1, NULL, 'payment', $2, 'pending', $3, $4)
             RETURNING id`,
            [clientRecord.id, totalPrice, description, JSON.stringify(rawDataForInsert)]
        );

        const transactionId = transactionResult.rows[0].id;

        // ВРЕМЕННАЯ БЛОКИРОВКА МЕСТ: Увеличиваем current_participants на время оплаты
        // Это предотвращает двойное бронирование, пока клиент оплачивает
        // При успешной оплате места останутся занятыми, при неудаче - вернутся обратно
        await client.query(
            `UPDATE kuliga_group_trainings
             SET current_participants = current_participants + $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [safeCount, groupTraining.id]
        );
        
        console.log(`🔒 Временно забронировано ${safeCount} мест в групповой тренировке программы #${groupTraining.id} для транзакции #${transactionId}`);

        await client.query('COMMIT');

        let payment;
        const paymentMethod = req.body.paymentMethod || 'card';
        
        // Логируем параметры перед созданием платежа
        console.log(`💳 [ProgramBooking] Параметры для initPayment:`, {
            transactionId,
            orderId: `gornostyle72-winter-${transactionId}`,
            amount: totalPrice,
            description,
            customerPhone: normalizedPhone,
            customerEmail: email?.trim() || undefined,
            clientId: clientRecord.id,
            paymentMethod,
            pricePerPerson,
            safeCount,
            programName: program.name
        });
        
        // Проверяем обязательные параметры перед вызовом
        if (!transactionId) {
            throw new Error('transactionId не создан');
        }
        if (!totalPrice || totalPrice <= 0) {
            throw new Error(`Некорректная сумма платежа: ${totalPrice}`);
        }
        if (!description || description.trim() === '') {
            throw new Error('Описание платежа не может быть пустым');
        }
        
        try {
            const provider = PaymentProviderFactory.create();
            payment = await provider.initPayment({
                orderId: `gornostyle72-winter-${transactionId}`, // Используем transactionId вместо bookingId
                amount: totalPrice,
                description,
                customerPhone: normalizedPhone,
                customerEmail: email?.trim() || undefined,
                clientId: clientRecord.id, // Передаем client_id для формирования deep link
                items: [
                    {
                        Name: `Программа "${program.name}" (${safeCount} чел.)`,
                        Price: Math.round(pricePerPerson * 100),
                        Quantity: safeCount,
                        Amount: Math.round(totalPrice * 100),
                        Tax: 'none',
                        PaymentMethod: 'full_payment',
                        PaymentObject: 'service',
                    },
                ],
                paymentMethod: paymentMethod,
            });
        } catch (paymentError) {
            // При ошибке инициализации платежа помечаем транзакцию как failed
            // И ВОЗВРАЩАЕМ места в групповой тренировке
            await pool.query(
                `UPDATE kuliga_transactions
                 SET status = 'failed', provider_status = $1
                 WHERE id = $2`,
                [paymentError.message.slice(0, 120), transactionId]
            );
            
            // Возвращаем места в групповой тренировке
            await pool.query(
                `UPDATE kuliga_group_trainings
                 SET current_participants = current_participants - $1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [safeCount, groupTraining.id]
            );
            
            console.log(`🔓 Возвращено ${safeCount} мест в групповой тренировке программы #${groupTraining.id} (ошибка инициализации платежа)`);
            
            throw paymentError;
        }

        const providerName = process.env.PAYMENT_PROVIDER || 'tochka';
        
        // Обновляем транзакцию с данными от провайдера
        // КРИТИЧНО: Используем исходный rawDataForInsert и добавляем к нему paymentData
        // Это гарантирует, что bookingData не потеряется
        const paymentData = payment.rawData || payment;
        // Удаляем bookingData из paymentData если он там есть (чтобы не перезаписать наш)
        if (paymentData && typeof paymentData === 'object') {
            delete paymentData.bookingData;
        }
        const rawData = {
            ...rawDataForInsert, // bookingData уже здесь
            paymentData: paymentData
        };
        
        console.log(`💾 [Booking] Обновление транзакции #${transactionId} с paymentData, bookingData сохранен: client_id=${rawDataForInsert.bookingData?.client_id}`);
        
        await pool.query(
            `UPDATE kuliga_transactions
             SET payment_provider = $1,
                 provider_payment_id = $2,
                 provider_order_id = $3,
                 provider_status = $4,
                 payment_method = $5,
                 provider_raw_data = $6
             WHERE id = $7`,
            [
                providerName,
                payment.paymentId,
                `gornostyle72-winter-${transactionId}`,
                payment.status,
                paymentMethod,
                JSON.stringify(rawData),
                transactionId
            ]
        );

        // УВЕДОМЛЕНИЯ НЕ ОТПРАВЛЯЕМ ЗДЕСЬ!
        // Они будут отправлены при обработке webhook после создания бронирования

        console.log(`✅ [ProgramBooking] Бронирование программы создано успешно:`, {
            transactionId,
            paymentUrl: payment.paymentURL,
            paymentMethod,
            qrCodeUrl: payment.qrCodeUrl || null,
            programId,
            clientId: clientRecord.id,
            totalPrice
        });

        if (!payment.paymentURL) {
            console.error(`❌ [ProgramBooking] payment.paymentURL отсутствует! payment объект:`, JSON.stringify(payment, null, 2));
            throw new Error('Не удалось получить ссылку на оплату от платежного провайдера');
        }

        return res.json({ 
            success: true, 
            transactionId, // Возвращаем transactionId вместо bookingId
            paymentUrl: payment.paymentURL,
            paymentMethod: paymentMethod,
            qrCodeUrl: payment.qrCodeUrl || null
        });
    } catch (error) {
        console.error('❌ [ProgramBooking] Ошибка бронирования программы Кулиги:', error);
        console.error('❌ [ProgramBooking] Stack trace:', error.stack);
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка при откате транзакции бронирования программы Кулиги:', rollbackError);
        }
        return res.status(500).json({ success: false, error: error.message || 'Не удалось создать бронирование программы' });
    } finally {
        client.release();
    }
};

router.post('/bookings', async (req, res) => {
    const bookingType = (req.body && req.body.bookingType) || 'group';
    const programId = req.body && req.body.programId;

    // Если передан programId, обрабатываем как бронирование программы
    if (programId) {
        return createProgramBooking(req, res);
    }

    if (bookingType === 'individual') {
        return createIndividualBooking(req, res);
    }

    if (bookingType === 'group') {
        return createGroupBooking(req, res);
    }

    return res.status(400).json({ success: false, error: 'Недопустимый тип бронирования' });
});

module.exports = router;

