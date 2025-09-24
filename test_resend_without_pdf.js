const { Resend } = require('resend');
require('dotenv').config();

async function testResendWithoutPDF() {
    console.log('🧪 Тестируем Resend БЕЗ PDF вложения...');
    
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    const fromName = process.env.RESEND_FROM_NAME;
    
    if (!apiKey) {
        console.error('❌ RESEND_API_KEY не найден');
        return;
    }
    
    try {
        const resend = new Resend(apiKey);
        
        // Тест с тем же получателем, что и при покупке
        const testEmailData = {
            from: `${fromName} <${fromEmail}>`,
            to: ['gornostyle72@yandex.ru'], // Тот же email, что и при покупке
            subject: '🧪 Тест БЕЗ PDF вложения',
            html: `
                <h2>Тест без PDF</h2>
                <p>Это тестовое письмо БЕЗ PDF вложения.</p>
                <p><strong>Время:</strong> ${new Date().toLocaleString('ru-RU')}</p>
                <p><strong>Получатель:</strong> gornostyle72@yandex.ru</p>
                <hr>
                <p><em>Если это письмо пришло, значит проблема в PDF вложении!</em></p>
            `
        };
        
        console.log('📤 Отправляем тест БЕЗ PDF...');
        const response = await resend.emails.send(testEmailData);
        
        if (response.error) {
            console.error('❌ Ошибка при отправке БЕЗ PDF:');
            console.error(`Код: ${response.error.statusCode}`);
            console.error(`Сообщение: ${response.error.message}`);
        } else {
            console.log('✅ Письмо БЕЗ PDF отправлено успешно!');
            console.log(`📧 Message ID: ${response.data?.id}`);
            console.log('\n🎯 Если это письмо пришло, значит проблема в PDF вложении!');
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error.message);
    }
}

testResendWithoutPDF().catch(console.error);
