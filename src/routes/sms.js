const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { notifyAdminFailedPayment } = require('../bot/admin-bot');

// Регулярное выражение для парсинга СМС
const SMS_REGEX = /СЧЁТ3009.*?Перевод.*?(\d+)р.*?«(\d{4}-\d{4}-\d{4}-\d{4})»/;

// Функция для извлечения номера кошелька
function extractWalletNumber(walletNumber) {
    try {
        // Удаляем дефисы и проверяем длину
        const cleanNumber = walletNumber.replace(/-/g, '');
        if (cleanNumber.length !== 16) {
            throw new Error('Неверный формат номера кошелька');
        }
        return cleanNumber;
    } catch (error) {
        console.error('Ошибка при извлечении номера кошелька:', error);
        throw error;
    }
}

// Функция для извлечения суммы
function extractAmount(amount) {
    try {
        // Удаляем + если есть и проверяем что это число
        const cleanAmount = amount.replace('+', '');
        const numAmount = parseFloat(cleanAmount);
        if (isNaN(numAmount)) {
            throw new Error('Неверный формат суммы');
        }
        return numAmount;
    } catch (error) {
        console.error('Ошибка при извлечении суммы:', error);
        throw error;
    }
}

// Обработка СМС
router.post('/process', async (req, res) => {
    const { sms_text } = req.body;

    if (!sms_text) {
        return res.status(400).json({ error: 'Текст СМС не указан' });
    }

    try {
        // Парсим СМС
        const match = sms_text.match(SMS_REGEX);
        if (!match) {
            console.log('Формат СМС не соответствует ожидаемому:', sms_text);
            return res.status(200).json({ message: 'Формат СМС не соответствует ожидаемому' });
        }

        const [, amount, walletNumber] = match;
        console.log('Извлеченные данные:', { amount, walletNumber });

        const cleanWalletNumber = extractWalletNumber(walletNumber);
        const cleanAmount = extractAmount(amount);

        console.log('Очищенные данные:', { cleanAmount, cleanWalletNumber });

        // Проверяем существование таблиц
        const tablesExist = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'wallets'
            ) as wallets_exist,
            EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'failed_payments'
            ) as failed_payments_exist
        `);

        if (!tablesExist.rows[0].wallets_exist || !tablesExist.rows[0].failed_payments_exist) {
            throw new Error('Необходимые таблицы не существуют');
        }

        // Обновляем баланс кошелька
        const result = await pool.query(
            `WITH wallet_update AS (
                UPDATE wallets 
                SET balance = balance + $1,
                    last_updated = CURRENT_TIMESTAMP
                WHERE wallet_number = $2
                RETURNING client_id, id
            )
            SELECT 
                CASE 
                    WHEN client_id IS NULL THEN false
                    ELSE true
                END as success,
                client_id,
                id as wallet_id
            FROM wallet_update`,
            [cleanAmount, cleanWalletNumber]
        );

        if (!result.rows[0].success) {
            console.log('Кошелек не найден:', cleanWalletNumber);
            // Если кошелек не найден, сохраняем информацию о неудачном платеже
            await pool.query(
                `INSERT INTO failed_payments (
                    amount, 
                    wallet_number, 
                    sms_text, 
                    error_type
                ) VALUES ($1, $2, $3, $4)`,
                [cleanAmount, cleanWalletNumber, sms_text, 'wallet_not_found']
            );

            // Отправляем уведомление администратору
            await notifyAdminFailedPayment({
                amount: cleanAmount,
                wallet_number: cleanWalletNumber,
                date: new Date().toLocaleDateString(),
                time: new Date().toLocaleTimeString()
            });

            return res.status(200).json({ 
                message: 'Платеж не обработан - кошелек не найден',
                saved_to_failed: true
            });
        }

        // Создаем запись о транзакции
        await pool.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ($1, $2, $3, $4)`,
            [result.rows[0].wallet_id, cleanAmount, 'refill', 'Пополнение через СБП']
        );

        console.log('Платеж успешно обработан:', {
            wallet_id: result.rows[0].wallet_id,
            client_id: result.rows[0].client_id,
            amount: cleanAmount
        });

        res.json({ 
            message: 'Платеж успешно обработан',
            wallet_id: result.rows[0].wallet_id,
            client_id: result.rows[0].client_id
        });

    } catch (error) {
        console.error('Ошибка при обработке СМС:', error);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

module.exports = router; 