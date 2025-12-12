/**
 * TochkaProvider
 * 
 * Интеграция с Точка Банком для интернет-эквайринга.
 * Поддерживает оплату картами и через СБП.
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class TochkaProvider {
    constructor() {
        this.apiKey = process.env.TOCHKA_API_KEY;
        this.clientId = process.env.TOCHKA_CLIENT_ID;
        this.merchantId = process.env.TOCHKA_MERCHANT_ID;
        this.customerCode = process.env.TOCHKA_CUSTOMER_CODE;
        // Согласно документации Точка Банка, правильный базовый URL: https://enter.tochka.com/uapi
        // Для платежей используется тот же базовый URL, что и для вебхуков
        // Если TOCHKA_API_URL не указан, используем базовый URL из документации
        this.apiUrl = process.env.TOCHKA_API_URL || 'https://enter.tochka.com/uapi/v1.0';
        this.enableSBP = process.env.TOCHKA_ENABLE_SBP === 'true';
        this.publicKey = process.env.TOCHKA_PUBLIC_KEY || process.env.TOCHKA_PUBLIC_JWK; // Поддерживаем PEM или JWK
        
        // URL для редиректов и webhook
        this.successUrl = process.env.PAYMENT_SUCCESS_URL;
        this.failUrl = process.env.PAYMENT_FAIL_URL;
        this.callbackUrl = process.env.PAYMENT_CALLBACK_URL;

        if (!this.apiKey || !this.clientId || !this.merchantId) {
            console.warn('⚠️  Tochka Bank: отсутствуют обязательные credentials');
        }
    }

    /**
     * Инициализация платежа
     * @param {object} params - Параметры платежа
     * @param {string} params.orderId - ID заказа
     * @param {number} params.amount - Сумма в рублях
     * @param {string} params.description - Описание платежа
     * @param {string} params.customerPhone - Телефон клиента
     * @param {string} params.customerEmail - Email клиента
     * @param {Array} params.items - Товары/услуги для чека
     * @param {string} params.paymentMethod - Метод оплаты ('card' | 'sbp')
     * @returns {Promise<{paymentId, paymentURL, qrCodeUrl, status}>}
     */
    async initPayment({
        orderId,
        amount,
        description,
        customerPhone,
        customerEmail,
        items = [],
        paymentMethod = 'card'
    }) {
        if (!this.apiKey || !this.clientId || !this.merchantId) {
            throw new Error('Точка Банк не настроен (отсутствуют credentials)');
        }

        // Валидация обязательных параметров
        if (!orderId || !amount || !description) {
            throw new Error('Отсутствуют обязательные параметры для создания платежа');
        }

        // Сумма в копейках
        const amountKopecks = Math.round(amount * 100);

        // Формируем данные для чека (54-ФЗ)
        const receiptItems = items.length > 0 ? items.map(item => ({
            name: item.Name || item.name || description,
            price: Math.round((item.Price || item.price || amount) * 100),
            quantity: item.Quantity || item.quantity || 1,
            amount: Math.round((item.Amount || item.amount || amount) * 100),
            tax: item.Tax || item.tax || 'none',
            payment_method: item.PaymentMethod || item.paymentMethod || 'full_payment',
            payment_object: item.PaymentObject || item.paymentObject || 'service'
        })) : [{
            name: description,
            price: amountKopecks,
            quantity: 1,
            amount: amountKopecks,
            tax: 'none',
            payment_method: 'full_payment',
            payment_object: 'service'
        }];

        // Формируем тело запроса
        const requestBody = {
            customerCode: this.customerCode,
            merchantId: this.merchantId,
            orderId: orderId,
            amount: amountKopecks,
            currency: 'RUB',
            description: description,
            returnUrl: this.successUrl,
            failUrl: this.failUrl,
            notificationUrl: this.callbackUrl,
            customer: {
                email: customerEmail || undefined,
                phone: customerPhone ? customerPhone.replace(/\D/g, '') : undefined
            },
            receipt: {
                taxation: 'usn_income', // УСН доходы
                items: receiptItems
            }
        };

        // Для СБП добавляем специальный параметр
        if (paymentMethod === 'sbp' && this.enableSBP) {
            requestBody.paymentMethod = 'SBP';
        }

        try {
            // Создаем JWT токен для авторизации
            const token = this.createAuthToken();

            const response = await axios.post(
                `${this.apiUrl}/payment-operations`,
                requestBody,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            const data = response.data;

            if (!data || !data.paymentId) {
                throw new Error('Точка Банк вернул некорректный ответ');
            }

            return {
                paymentId: data.paymentId,
                paymentURL: data.paymentURL || data.paymentUrl,
                qrCodeUrl: data.qrCodeUrl || data.qr_code_url, // Для СБП
                status: data.status || 'pending',
                rawData: data
            };
        } catch (error) {
            console.error('Ошибка создания платежа в Точка Банке:', {
                message: error.message,
                response: error.response?.data,
                orderId,
                amount
            });
            throw new Error(
                error.response?.data?.message || 
                error.response?.data?.error || 
                'Не удалось создать платеж в Точка Банке'
            );
        }
    }

    /**
     * Создает JWT токен для авторизации в API
     * @returns {string} JWT токен
     */
    createAuthToken() {
        // Точка Банк использует JWT токен, который мы получили при генерации ключа
        // Этот токен уже содержит все необходимые данные
        return this.apiKey;
    }

    /**
     * Проверка подписи webhook
     * @param {object} payload - Данные webhook
     * @param {object} headers - HTTP заголовки
     * @returns {boolean} true если подпись валидна
     */
    verifyWebhookSignature(payload, headers = {}) {
        // Точка Банк может использовать JWT в заголовке Authorization
        const authHeader = headers.authorization || headers.Authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            return this.verifyJWT(token);
        }

        // Или JWT может быть в payload
        if (payload.token || payload.jwt) {
            return this.verifyJWT(payload.token || payload.jwt);
        }

        // Если есть публичный ключ, проверяем подпись
        if (this.publicKey) {
            // Пытаемся найти JWT в payload
            const jwtString = payload.jwt || payload.token || JSON.stringify(payload);
            return this.verifyJWT(jwtString);
        }

        // Если нет публичного ключа, логируем предупреждение и разрешаем (для разработки)
        console.warn('⚠️  Tochka Bank: публичный ключ не настроен, пропускаем проверку подписи');
        return true; // Временно разрешаем, пока не получим публичный ключ
    }

    /**
     * Проверка JWT токена с RS256
     * @param {string} token - JWT токен
     * @returns {boolean} true если токен валиден
     */
    verifyJWT(token) {
        if (!this.publicKey) {
            console.warn('⚠️  Tochka Bank: публичный ключ не настроен');
            return false;
        }

        try {
            // Поддерживаем ключ в PEM или JWK (как присылает банк)
            const publicKeyPem = this.normalizePublicKey(this.publicKey);

            jwt.verify(token, publicKeyPem, {
                algorithms: ['RS256']
            });

            return true;
        } catch (error) {
            console.error('Ошибка проверки JWT подписи Точка Банка:', error.message);
            return false;
        }
    }

    /**
     * Нормализация публичного ключа: принимает PEM строку или JWK (JSON) и возвращает PEM
     * @param {string} keyString
     * @returns {string} PEM
     */
    normalizePublicKey(keyString) {
        // Если уже PEM
        if (keyString.trim().startsWith('-----BEGIN PUBLIC KEY-----')) {
            return keyString.trim();
        }

        // Если это JWK в JSON
        try {
            const maybeJson = JSON.parse(keyString);
            if (maybeJson && maybeJson.kty === 'RSA' && maybeJson.n && maybeJson.e) {
                const publicKeyObj = crypto.createPublicKey({ key: maybeJson, format: 'jwk' });
                return publicKeyObj.export({ type: 'spki', format: 'pem' }).toString();
            }
        } catch (_err) {
            // Не JSON — пойдём дальше
        }

        // Если это “сырой” base64 без заголовков — оборачиваем в PEM
        return `-----BEGIN PUBLIC KEY-----\n${keyString}\n-----END PUBLIC KEY-----`;
    }

    /**
     * Парсинг данных webhook acquiringInternetPayment
     * @param {object} payload - Данные webhook (декодированный JWT)
     * @returns {object} Распарсенные данные {orderId, paymentId, status, amount, paymentMethod, webhookType}
     */
    parseWebhookData(payload) {
        // Формат acquiringInternetPayment от Точка Банка
        // Вебхук приходит как JWT, payload уже декодирован
        
        const webhookType = payload.webhookType || payload.webhook_type;
        
        // Для acquiringInternetPayment структура:
        // { webhookType, paymentId, orderId, status, amount, currency, paymentMethod, customerCode, ... }
        
        // Маппинг статусов Точка Банка
        const statusMap = {
            'SUCCESS': 'SUCCESS',
            'CONFIRMED': 'SUCCESS',
            'FAILED': 'FAILED',
            'REJECTED': 'FAILED',
            'CANCELED': 'FAILED',
            'CANCELLED': 'FAILED',
            'PENDING': 'PENDING',
            'REFUNDED': 'REFUNDED'
        };
        
        const rawStatus = payload.status || payload.Status;
        const normalizedStatus = statusMap[rawStatus] || rawStatus;
        
        return {
            webhookType: webhookType,
            orderId: payload.orderId || payload.order_id || payload.OrderId,
            paymentId: payload.paymentId || payload.payment_id || payload.PaymentId || payload.operationId,
            status: normalizedStatus,
            amount: payload.amount ? payload.amount / 100 : payload.Amount ? payload.Amount / 100 : null,
            currency: payload.currency || payload.Currency || 'RUB',
            paymentMethod: payload.paymentMethod || payload.payment_method || payload.PaymentMethod || 'card',
            customerCode: payload.customerCode || payload.customer_code,
            rawData: payload
        };
    }

    /**
     * Проверка статуса платежа
     * @param {string} paymentId - ID платежа
     * @returns {Promise<{status, paymentId}>}
     */
    async checkPaymentStatus(paymentId) {
        if (!this.apiKey || !paymentId) {
            throw new Error('Не указаны credentials или paymentId');
        }

        try {
            const token = this.createAuthToken();
            const response = await axios.get(
                `${this.apiUrl}/payment-operations/${paymentId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            const data = response.data;
            return {
                status: data.status || 'unknown',
                paymentId: data.paymentId || paymentId,
                rawData: data
            };
        } catch (error) {
            console.error('Ошибка проверки статуса платежа:', error.message);
            throw error;
        }
    }

    /**
     * Возврат средств
     * @param {string} paymentId - ID платежа
     * @param {number} amount - Сумма возврата в рублях
     * @returns {Promise<{success, refundId}>}
     */
    async refundPayment(paymentId, amount) {
        if (!this.apiKey || !paymentId) {
            throw new Error('Не указаны credentials или paymentId');
        }

        const amountKopecks = Math.round(amount * 100);

        try {
            const token = this.createAuthToken();
            const response = await axios.post(
                `${this.apiUrl}/payment-operations/${paymentId}/refund`,
                {
                    amount: amountKopecks,
                    currency: 'RUB'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            const data = response.data;
            return {
                success: true,
                refundId: data.refundId || data.refund_id,
                rawData: data
            };
        } catch (error) {
            console.error('Ошибка возврата средств:', error.message);
            throw error;
        }
    }
}

module.exports = TochkaProvider;


