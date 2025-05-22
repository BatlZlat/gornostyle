const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { notifyAdminFailedPayment, notifyAdminWalletRefilled } = require('../bot/admin-bot');

// Универсальный парсер суммы и кошелька
function parseSmsUniversal(text) {
    // Ищем сумму: +10р, 10р, 100р и т.д.
    const amountMatch = text.match(/(\+?\d+)\s*р/i);
    // Ищем номер кошелька: xxxx-xxxx-xxxx-xxxx (12-20 цифр с дефисами)
    const walletMatch = text.match(/(\d{4}-\d{4}-\d{4}-\d{4,6})/);
    if (!amountMatch || !walletMatch) return null;
    return {
        amount: parseFloat(amountMatch[1].replace('+', '')),
        walletNumber: walletMatch[1].replace(/-/g, '')
    };
}

// Функция для извлечения номера кошелька
function extractWalletNumber(walletNumber) {
    try {
        // Удаляем дефисы и проверяем длину (от 12 до 20 символов)
        const cleanNumber = walletNumber.replace(/-/g, '');
        if (cleanNumber.length < 12 || cleanNumber.length > 20) {
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
    let { sms_text } = req.body;

    if (!sms_text) {
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
    console.log('Получено СМС от MacroDroid:', JSON.stringify(sms_text));

    try {
        // Удаляем переводы строк для универсального парсинга
        const normalizedText = sms_text.replace(/[\r\n]+/g, ' ');
        // Универсальный парсинг
        const parsed = parseSmsUniversal(normalizedText);
        if (!parsed) {
            console.log('Не удалось извлечь сумму или номер кошелька:', sms_text);
            return res.status(200).json({ message: 'Не удалось извлечь сумму или номер кошелька' });
        }
        const { amount, walletNumber } = parsed;
        console.log('Извлеченные данные:', { amount, walletNumber });

        const cleanWalletNumber = extractWalletNumber(walletNumber);
        // Исправляем extractAmount: приводим к строке
        const cleanAmount = extractAmount(String(amount));

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

        // Получаем текущий баланс и имя клиента
        const walletInfo = await pool.query(
            `SELECT w.balance, c.full_name FROM wallets w JOIN clients c ON w.client_id = c.id WHERE w.wallet_number = $1`,
            [cleanWalletNumber]
        );
        if (walletInfo.rows.length === 0) {
            // Кошелек не найден, обработка как раньше
            console.log('Кошелек не найден:', cleanWalletNumber);
            await pool.query(
                `INSERT INTO failed_payments (
                    amount, 
                    wallet_number, 
                    sms_text, 
                    error_type
                ) VALUES ($1, $2, $3, $4)`,
                [cleanAmount, cleanWalletNumber, sms_text, 'wallet_not_found']
            );
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
        const oldBalance = parseFloat(walletInfo.rows[0].balance);
        const clientName = walletInfo.rows[0].full_name;
        const newBalance = oldBalance + cleanAmount;

        // Обновляем баланс кошелька
        await pool.query(
            `UPDATE wallets SET balance = $1, last_updated = CURRENT_TIMESTAMP WHERE wallet_number = $2`,
            [newBalance, cleanWalletNumber]
        );

        // Создаем запись о транзакции
        await pool.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ((SELECT id FROM wallets WHERE wallet_number = $1), $2, $3, $4)`,
            [cleanWalletNumber, cleanAmount, 'refill', 'Пополнение через СБП']
        );

        // Уведомляем администратора о пополнении
        await notifyAdminWalletRefilled({
            clientName,
            amount: cleanAmount,
            walletNumber: cleanWalletNumber,
            balance: newBalance
        });

        console.log('Платеж успешно обработан:', {
            wallet_number: cleanWalletNumber,
            client_name: clientName,
            amount: cleanAmount,
            new_balance: newBalance
        });

        res.json({ 
            message: 'Платеж успешно обработан',
            wallet_number: cleanWalletNumber,
            client_name: clientName,
            new_balance: newBalance
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