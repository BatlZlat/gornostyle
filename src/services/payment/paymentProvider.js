/**
 * PaymentProviderFactory
 * 
 * Фабрика для создания платежных провайдеров.
 * Поддерживает несколько провайдеров и автоматическое определение по webhook.
 */

class PaymentProviderFactory {
    /**
     * Создает экземпляр платежного провайдера
     * @param {string|null} providerName - Имя провайдера ('tochka', 'tinkoff', 'mock')
     * @returns {PaymentProvider} Экземпляр провайдера
     */
    static create(providerName = null) {
        const provider = providerName || process.env.PAYMENT_PROVIDER || 'tochka';

        switch (provider.toLowerCase()) {
            case 'tochka':
                const TochkaProvider = require('./providers/tochkaProvider');
                return new TochkaProvider();
            
            case 'tinkoff':
                // Для обратной совместимости, если понадобится
                const TinkoffProvider = require('./providers/tinkoffProvider');
                return new TinkoffProvider();
            
            case 'mock':
                const MockProvider = require('./providers/mockProvider');
                return new MockProvider();
            
            default:
                throw new Error(`Неизвестный платежный провайдер: ${provider}`);
        }
    }

    /**
     * Определяет провайдера по структуре webhook payload
     * @param {object} payload - Данные webhook
     * @returns {string} Имя провайдера
     */
    static detectProviderFromWebhook(payload) {
        if (!payload || typeof payload !== 'object') {
            return process.env.PAYMENT_PROVIDER || 'tochka';
        }

        // Точка Банк использует JWT в заголовке или специфичные поля
        if (payload.paymentId || payload.payment_id || payload.operationId) {
            return 'tochka';
        }

        // Тинькофф использует Token и OrderId
        if (payload.Token && payload.OrderId && payload.PaymentId) {
            return 'tinkoff';
        }

        // По умолчанию используем текущий провайдер из env
        return process.env.PAYMENT_PROVIDER || 'tochka';
    }
}

module.exports = PaymentProviderFactory;





