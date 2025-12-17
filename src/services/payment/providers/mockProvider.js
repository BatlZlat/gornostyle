/**
 * MockProvider
 * 
 * Мок-провайдер для тестирования без реальных API вызовов.
 */

class MockProvider {
    constructor() {
        this.name = 'mock';
    }

    async initPayment({ orderId, amount, description, paymentMethod = 'card' }) {
        // Имитируем задержку API
        await new Promise(resolve => setTimeout(resolve, 100));

        return {
            paymentId: `mock-${Date.now()}`,
            paymentURL: `https://mock-payment.example.com/pay?order=${orderId}`,
            qrCodeUrl: paymentMethod === 'sbp' ? `https://mock-payment.example.com/qr?order=${orderId}` : null,
            status: 'pending',
            rawData: { mock: true }
        };
    }

    verifyWebhookSignature(payload, headers) {
        // В моке всегда возвращаем true
        return true;
    }

    parseWebhookData(payload) {
        return {
            orderId: payload.orderId || payload.OrderId,
            paymentId: payload.paymentId || payload.PaymentId,
            status: payload.status || payload.Status || 'CONFIRMED',
            amount: payload.amount || payload.Amount || 0,
            paymentMethod: payload.paymentMethod || 'card',
            rawData: payload
        };
    }

    async checkPaymentStatus(paymentId) {
        return {
            status: 'CONFIRMED',
            paymentId,
            rawData: { mock: true }
        };
    }

    async refundPayment(paymentId, amount) {
        return {
            success: true,
            refundId: `refund-${Date.now()}`,
            rawData: { mock: true }
        };
    }
}

module.exports = MockProvider;







