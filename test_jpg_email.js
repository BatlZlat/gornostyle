const EmailService = require('./src/services/emailService');

async function testJpgEmail() {
    console.log('=== Тест отправки email с JPG сертификатом ===');
    
    try {
        const emailService = new EmailService();
        
        // Тестовые данные сертификата
        const certificateData = {
            certificateId: 1,
            certificateCode: '356703', // Используем реальный номер
            recipientName: 'Тестовый Получатель',
            amount: 5000,
            message: '🎉 Поздравляю с праздником! 🎁 Желаю удачи! 🍀',
            pdfUrl: null // Не используем старый PDF
        };
        
        console.log('📧 Отправляем тестовый email с JPG сертификатом...');
        
        const result = await emailService.sendCertificateEmail(
            'test@example.com', // Замените на реальный email для тестирования
            certificateData
        );
        
        if (result.success) {
            console.log('✅ Email с JPG сертификатом отправлен успешно!');
            console.log('Message ID:', result.messageId);
        } else {
            console.log('❌ Ошибка при отправке email:', result.error);
        }
        
    } catch (error) {
        console.error('❌ Ошибка в тесте:', error.message);
    }
    
    console.log('=== Тест завершен ===');
}

testJpgEmail().catch(console.error);
