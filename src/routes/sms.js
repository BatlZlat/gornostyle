const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { notifyAdminFailedPayment, notifyAdminWalletRefilled, notifyAdminWebCertificatePurchase, calculateAge } = require('../bot/admin-notify');

// Функция для обработки ожидающих сертификатов
async function processPendingCertificate(walletNumber, amount, dbClient) {
    try {
        // Проверяем, есть ли ожидающий сертификат для этого кошелька
        const pendingQuery = `
            SELECT pc.*, c.full_name, c.email, c.phone, c.birth_date, cd.name as design_name
            FROM pending_certificates pc
            JOIN clients c ON pc.client_id = c.id
            LEFT JOIN certificate_designs cd ON pc.design_id = cd.id
            WHERE pc.wallet_number = $1 
            AND pc.nominal_value = $2
            AND pc.expires_at > CURRENT_TIMESTAMP
            ORDER BY pc.created_at DESC
            LIMIT 1
        `;
        
        const pendingResult = await dbClient.query(pendingQuery, [walletNumber, amount]);
        
        if (pendingResult.rows.length === 0) {
            console.log(`Нет ожидающих сертификатов для кошелька ${walletNumber} на сумму ${amount}`);
            return;
        }

        const pendingCert = pendingResult.rows[0];
        console.log(`Найден ожидающий сертификат для клиента ${pendingCert.full_name}`);

        await dbClient.query('BEGIN');

        // Списываем деньги с кошелька
        await dbClient.query(
            `UPDATE wallets SET balance = balance - $1 WHERE wallet_number = $2`,
            [amount, walletNumber]
        );

        // Создаем транзакцию списания
        await dbClient.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ((SELECT id FROM wallets WHERE wallet_number = $1), $2, 'payment', $3)`,
            [walletNumber, -amount, `Покупка сертификата - ${pendingCert.full_name}`]
        );

        // Создаем сертификат
        const certificateQuery = `
            INSERT INTO certificates (
                purchaser_id, nominal_value, recipient_name, message, design_id, 
                certificate_number, status, purchase_date, expiry_date
            ) VALUES ($1, $2, $3, $4, $5, $6, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 year')
            RETURNING id, certificate_number
        `;
        
        // Генерируем уникальный 6-значный номер сертификата
        const certificateNumber = Math.floor(Math.random() * 900000 + 100000).toString();
        
        const certResult = await dbClient.query(certificateQuery, [
            pendingCert.client_id,
            pendingCert.nominal_value,
            pendingCert.recipient_name,
            pendingCert.message,
            pendingCert.design_id,
            certificateNumber
        ]);

        const certificateId = certResult.rows[0].id;
        console.log(`Создан сертификат ID: ${certificateId}, номер: ${certificateNumber}`);

        // Удаляем запись из pending_certificates
        await dbClient.query('DELETE FROM pending_certificates WHERE id = $1', [pendingCert.id]);

        await dbClient.query('COMMIT');

        // Отправляем email с сертификатом (если настроена отправка email)
        if (pendingCert.email) {
            try {
                await sendCertificateEmail(pendingCert.email, {
                    certificateId,
                    certificateCode: certificateNumber,
                    recipientName: pendingCert.recipient_name || pendingCert.full_name,
                    amount: pendingCert.nominal_value,
                    message: pendingCert.message
                });
                console.log(`Email с сертификатом отправлен на ${pendingCert.email}`);
            } catch (emailError) {
                console.error('Ошибка при отправке email с сертификатом:', emailError);
            }
        }

        // Отправляем уведомление администратору о покупке через сайт
        try {
            const clientAge = calculateAge(pendingCert.birth_date);
            await notifyAdminWebCertificatePurchase({
                clientName: pendingCert.full_name,
                clientAge: clientAge,
                clientPhone: pendingCert.phone,
                clientEmail: pendingCert.email,
                certificateNumber: certificateNumber,
                nominalValue: pendingCert.nominal_value,
                designName: pendingCert.design_name || 'Неизвестный дизайн',
                recipientName: pendingCert.recipient_name,
                message: pendingCert.message
            });
            console.log(`Уведомление администратору о покупке сертификата отправлено`);
        } catch (notifyError) {
            console.error('Ошибка при отправке уведомления администратору:', notifyError);
        }

    } catch (error) {
        console.error('Ошибка при обработке ожидающего сертификата:', error);
        await dbClient.query('ROLLBACK');
        throw error;
    }
}

// Импорт email сервиса
const EmailService = require('../services/emailService');
const emailService = new EmailService();

// Отправка email с сертификатом
async function sendCertificateEmail(email, certificateData) {
    try {
        console.log(`Отправка сертификата на email ${email}:`, certificateData);
        const result = await emailService.sendCertificateEmail(email, certificateData);
        return result;
    } catch (error) {
        console.error('Ошибка при отправке email с сертификатом:', error);
        throw error;
    }
}

// Универсальный парсер суммы и кошелька
function parseSmsUniversal(text) {
    // Нормализация текста
    const normalizedText = text
        .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ') // Замена всех видов пробелов
        .replace(/["'«»]/g, '"') // Нормализация кавычек
        .replace(/\s+/g, ' ') // Нормализация пробелов
        .trim();

    // Поиск суммы (основной приоритет)
    const amountPatterns = [
        // Число перед буквой р (русской или английской), допускаем точку/запятую после "р"
        /(\+?(?:\d{1,3}(?:\s\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?))\s*[рp](?:[.,]?|\b)/i,
        // Дополнительные паттерны (на всякий случай), допускаем точку/запятую после слова
        /(\+?(?:\d{1,3}(?:\s\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?))\s*(?:руб|рубль|рублей|₽)[.,]?/i
    ];

    // Поиск номера кошелька
    const walletPatterns = [
        // После ключевых слов, допускаем точку или запятую после номера
        /(?:сообщение|номер|кошелек|счет|карта|перевод)[:]\s*([\d\-]{16,23})[.,]?/i,
        // В кавычках, допускаем точку или запятую после номера
        /["']([\d\-]{16,23})["'][.,]?/,
        // Просто последовательность цифр с разделителями, допускаем точку или запятую после номера
        /(\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4})[.,]?/,
        // Любая последовательность из 16+ цифр, допускаем точку или запятую после номера
        /(\d{16,})[.,]?/
    ];

    // Поиск суммы (основной приоритет)
    let amount = null;
    for (const pattern of amountPatterns) {
        const match = normalizedText.match(pattern);
        if (match) {
            amount = parseFloat(match[1].replace(/\s/g, '').replace(',', '.').replace('+', ''));
            if (!isNaN(amount)) {
                break;
            }
        }
    }

    // Поиск номера кошелька
    let walletNumber = null;
    for (const pattern of walletPatterns) {
        const match = normalizedText.match(pattern);
        if (match) {
            // Очистка номера от всех нецифровых символов
            walletNumber = match[1].replace(/[^\d]/g, '');
            if (walletNumber.length >= 16) {
                walletNumber = walletNumber.slice(0, 16);
                break;
            }
        }
    }

    // Логирование процесса парсинга
    // console.log('Парсинг СМС:', {
    //     original_text: text,
    //     normalized_text: normalizedText,
    //     found_amount: amount,
    //     found_wallet: walletNumber,
    //     timestamp: new Date().toISOString()
    // });

    // Валидация результатов
    if (!amount) {
        // console.log('Не удалось найти сумму в СМС:', {
        //     text: normalizedText,
        //     error: 'Сумма не найдена'
        // });
        return null;
    }

    if (!walletNumber) {
        // console.log('Не удалось найти номер кошелька в СМС:', {
        //     text: normalizedText,
        //     error: 'Номер кошелька не найден'
        // });
        return null;
    }

    return {
        amount,
        walletNumber,
        originalText: text,
        parsedAt: new Date().toISOString()
    };
}

// Функция для сохранения СМС в лог
async function logSms(smsText, parsedData, errorType = null, errorDetails = null) {
    try {
        await pool.query(
            `INSERT INTO sms_log (
                sms_text,
                parsed_data,
                error_type,
                error_details,
                processing_status
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
                smsText,
                parsedData ? JSON.stringify(parsedData) : null,
                errorType,
                errorDetails,
                parsedData ? 'success' : 'failed'
            ]
        );
    } catch (error) {
        console.error('Ошибка при сохранении СМС в лог:', error);
    }
}

// Обработка СМС
router.post('/process', async (req, res) => {
    // Логируем заголовок Authorization для отладки
    // console.log('Authorization header:', req.headers.authorization);
    let { sms_text } = req.body;

    if (!sms_text) {
        await logSms(null, null, 'validation_error', 'Текст СМС не указан');
        return res.status(400).json({ error: 'Текст СМС не указан' });
    }

    // Универсальная обработка: если пришёл массив или строка с кавычками
    if (Array.isArray(sms_text)) {
        sms_text = sms_text[0];
    } else if (typeof sms_text === 'string' && sms_text.startsWith('[') && sms_text.endsWith(']')) {
        try {
            const arr = JSON.parse(sms_text.replace(/'/g, '"'));
            if (Array.isArray(arr) && arr.length > 0) {
                sms_text = arr[0];
            }
        } catch (e) {
            // Оставляем sms_text как есть
        }
    }

    // Логируем реальный текст СМС
    // console.log('Получено СМС от MacroDroid:', JSON.stringify(sms_text));

    try {
        // Удаляем переводы строк для универсального парсинга
        const normalizedText = sms_text.replace(/[\r\n]+/g, ' ');
        // Универсальный парсинг
        const parsed = parseSmsUniversal(normalizedText);
        
        if (!parsed) {
            // console.log('Не удалось извлечь сумму или номер кошелька:', sms_text);
            await logSms(sms_text, null, 'parsing_error', 'Не удалось извлечь сумму или номер кошелька');
            return res.status(200).json({ message: 'Не удалось извлечь сумму или номер кошелька' });
        }

        const { amount, walletNumber } = parsed;
        // console.log('Извлеченные данные:', { amount, walletNumber });

        // Проверяем существование таблиц
        const tablesExist = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'wallets'
            ) as wallets_exist,
            EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'failed_payments'
            ) as failed_payments_exist,
            EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'sms_log'
            ) as sms_log_exist
        `);

        if (!tablesExist.rows[0].wallets_exist || !tablesExist.rows[0].failed_payments_exist || !tablesExist.rows[0].sms_log_exist) {
            throw new Error('Необходимые таблицы не существуют');
        }

        // Получаем текущий баланс и имя клиента
        const walletInfo = await pool.query(
            `SELECT w.balance, c.full_name FROM wallets w JOIN clients c ON w.client_id = c.id WHERE w.wallet_number = $1`,
            [walletNumber]
        );

        if (walletInfo.rows.length === 0) {
            // Кошелек не найден, сохраняем в failed_payments и логируем
            // console.log('Кошелек не найден:', walletNumber);
            await pool.query(
                `INSERT INTO failed_payments (
                    amount, 
                    wallet_number, 
                    sms_text, 
                    error_type
                ) VALUES ($1, $2, $3, $4)`,
                [amount, walletNumber, sms_text, 'wallet_not_found']
            );
            await logSms(sms_text, parsed, 'wallet_not_found', 'Кошелек не найден в базе данных');
            await notifyAdminFailedPayment({
                amount,
                wallet_number: walletNumber,
                date: new Date().toLocaleDateString(),
                time: new Date().toLocaleTimeString()
            });
            return res.status(200).json({ 
                message: 'Платеж не обработан - кошелек не найден',
                saved_to_failed: true
            });
        }

        const oldBalance = parseFloat(walletInfo.rows[0].balance);
        const clientName = walletInfo.rows[0].full_name;
        const newBalance = oldBalance + amount;

        // Начинаем транзакцию
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Обновляем баланс кошелька
            await client.query(
                `UPDATE wallets SET balance = $1, last_updated = CURRENT_TIMESTAMP WHERE wallet_number = $2`,
                [newBalance, walletNumber]
            );

            // Создаем запись о транзакции
            await client.query(
                `INSERT INTO transactions (wallet_id, amount, type, description)
                VALUES ((SELECT id FROM wallets WHERE wallet_number = $1), $2, $3, $4)`,
                [walletNumber, amount, 'refill', `Пополнение через СБП - ${clientName}`]
            );

            // Обновляем статус в sms_log
            await client.query(
                `UPDATE sms_log 
                 SET processing_status = 'completed', processed_at = CURRENT_TIMESTAMP 
                 WHERE id = (
                     SELECT id FROM sms_log
                     WHERE sms_text = $1 AND processing_status = 'success'
                     ORDER BY created_at DESC
                     LIMIT 1
                 )`,
                [sms_text]
            );

            await client.query('COMMIT');

            // Проверяем, есть ли ожидающий сертификат для этого кошелька
            await processPendingCertificate(walletNumber, amount, client);

            // Уведомляем администратора о пополнении
            await notifyAdminWalletRefilled({
                clientName,
                amount,
                walletNumber,
                balance: newBalance
            });

            // console.log('Платеж успешно обработан:', {
            //     wallet_number: walletNumber,
            //     client_name: clientName,
            //     amount,
            //     new_balance: newBalance
            // });

            res.json({ 
                message: 'Платеж успешно обработан',
                wallet_number: walletNumber,
                client_name: clientName,
                new_balance: newBalance
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Ошибка при обработке СМС:', error);
        await logSms(sms_text, null, 'processing_error', error.message);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

module.exports = router; 