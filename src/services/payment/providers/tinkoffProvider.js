/**
 * TinkoffProvider
 * 
 * Провайдер для обратной совместимости с Тинькофф (если понадобится).
 * Сейчас не используется, так как Tinkoff не был внедрен.
 */

const axios = require('axios');
const crypto = require('crypto');

class TinkoffProvider {
    constructor() {
        this.terminalKey = process.env.TINKOFF_TERMINAL_KEY;
        this.password = process.env.TINKOFF_PASSWORD;
        this.apiUrl = process.env.TINKOFF_API_URL || 'https://securepay.tinkoff.ru/v2';
        
        if (!this.terminalKey || !this.password) {
            console.warn('⚠️  Tinkoff: отсутствуют credentials');
        }
    }

    generateToken(params) {
        const prepared = { ...params };
        delete prepared.Token;
        prepared.Password = this.password;

        const sortedKeys = Object.keys(prepared).sort();
        const concatenated = sortedKeys.map((key) => prepared[key]).join('');

        return crypto.createHash('sha256').update(concatenated).digest('hex');
    }

    async initPayment({ orderId, amount, description, customerPhone, customerEmail, items }) {
        throw new Error('Tinkoff провайдер не реализован. Используйте Tochka Bank.');
    }

    verifyWebhookSignature(payload) {
        if (!payload.Token) return false;
        const expectedToken = this.generateToken({ ...payload });
        return payload.Token === expectedToken;
    }

    parseWebhookData(payload) {
        return {
            orderId: payload.OrderId,
            paymentId: payload.PaymentId,
            status: payload.Status,
            amount: payload.Amount ? payload.Amount / 100 : null,
            paymentMethod: 'card',
            rawData: payload
        };
    }

    async checkPaymentStatus(paymentId) {
        throw new Error('Tinkoff провайдер не реализован');
    }

    async refundPayment(paymentId, amount) {
        throw new Error('Tinkoff провайдер не реализован');
    }
}

module.exports = TinkoffProvider;



