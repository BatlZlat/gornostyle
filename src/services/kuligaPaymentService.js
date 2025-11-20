const axios = require('axios');
const crypto = require('crypto');

const TERMINAL_KEY = process.env.TINKOFF_TERMINAL_KEY;
const PASSWORD = process.env.TINKOFF_PASSWORD;
const API_URL = process.env.TINKOFF_API_URL || 'https://securepay.tinkoff.ru/v2';
const SUCCESS_URL = process.env.KULIGA_PAYMENT_SUCCESS_URL || `${process.env.DOMAIN || ''}/instruktora-kuliga/booking/success`;
const FAIL_URL = process.env.KULIGA_PAYMENT_FAIL_URL || `${process.env.DOMAIN || ''}/instruktora-kuliga/booking/fail`;
const CALLBACK_URL = process.env.KULIGA_PAYMENT_CALLBACK_URL || `${process.env.DOMAIN || ''}/api/kuliga/payment/callback`;

if (!TERMINAL_KEY || !PASSWORD) {
    console.warn('⚠️  Tinkoff Acquiring: отсутствуют TERMINAL_KEY или PASSWORD. Проверьте .env');
}

const normalizeAmount = (amount) => {
    const numeric = Number(amount || 0);
    return Math.round(numeric * 100);
};

const generateToken = (params) => {
    const prepared = { ...params };
    delete prepared.Token;
    prepared.Password = PASSWORD;

    const sortedKeys = Object.keys(prepared).sort();
    const concatenated = sortedKeys.map((key) => prepared[key]).join('');

    return crypto.createHash('sha256').update(concatenated).digest('hex');
};

const initPayment = async ({ orderId, amount, description, customerPhone, customerEmail, items }) => {
    if (!TERMINAL_KEY || !PASSWORD) {
        throw new Error('Платежный шлюз не настроен (отсутствуют TERMINAL_KEY/PASSWORD)');
    }

    // Валидация обязательных параметров
    if (!orderId || !amount || !description) {
        throw new Error('Отсутствуют обязательные параметры для создания платежа');
    }

    const params = {
        TerminalKey: TERMINAL_KEY,
        Amount: normalizeAmount(amount),
        OrderId: orderId,
        Description: description,
        NotificationURL: CALLBACK_URL,
        SuccessURL: SUCCESS_URL,
        FailURL: FAIL_URL,
    };

    // DATA необязательна, но если передана email или phone, добавляем
    if (customerEmail || customerPhone) {
        params.DATA = {};
        if (customerEmail) params.DATA.Email = customerEmail;
        if (customerPhone) params.DATA.Phone = customerPhone;
    }

    // Receipt обязателен для платежей с фискализацией
    const receiptItems = items && items.length ? items : [
        {
            Name: description,
            Price: normalizeAmount(amount),
            Quantity: 1,
            Amount: normalizeAmount(amount),
            Tax: 'none',
            PaymentMethod: 'full_payment',
            PaymentObject: 'service',
        },
    ];

    params.Receipt = {
        Taxation: 'usn_income',
        Items: receiptItems,
    };

    // Email и Phone в Receipt необязательны, но если есть - добавляем
    if (customerEmail) {
        params.Receipt.Email = customerEmail;
    }
    if (customerPhone) {
        params.Receipt.Phone = customerPhone;
    }

    params.Token = generateToken(params);

    const { data } = await axios.post(`${API_URL}/Init`, params, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
    });

    if (!data.Success) {
        const message = data.Message || data.Details || 'Tinkoff Init вернул ошибку';
        console.error('Ошибка Tinkoff API:', {
            message: data.Message,
            details: data.Details,
            errorCode: data.ErrorCode,
            params: {
                OrderId: params.OrderId,
                Amount: params.Amount,
                Description: params.Description,
                hasEmail: !!params.Receipt.Email,
                hasPhone: !!params.Receipt.Phone,
                itemsCount: params.Receipt.Items.length,
            }
        });
        throw new Error(message);
    }

    return {
        paymentId: data.PaymentId,
        paymentURL: data.PaymentURL,
        status: data.Status,
        params,
    };
};

module.exports = {
    initPayment,
    generateToken,
};
