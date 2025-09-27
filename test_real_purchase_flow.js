const { pool } = require('./src/db');
const { processPendingCertificate } = require('./src/routes/sms');
const EmailService = require('./src/services/emailService');

async function testRealPurchaseFlow() {
    console.log('=== Тест полного цикла покупки через сайт ===');
    
    const client = await pool.connect();
    
    try {
        // 1. Создаем тестового клиента
        console.log('👤 Создаем тестового клиента...');
        const clientResult = await client.query(`
            INSERT INTO clients (full_name, phone, email, telegram_id, birth_date, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id
        `, ['Тестовый Покупатель', '+79991234567', 'test-buyer@example.com', Date.now().toString(), '1990-01-01']);
        
        const clientId = clientResult.rows[0].id;
        console.log(`✅ Клиент создан с ID: ${clientId}`);
        
        // 2. Создаем pending certificate (как при покупке через сайт)
        console.log('📝 Создаем pending certificate...');
        const pendingResult = await client.query(`
            INSERT INTO pending_certificates (
                client_id, recipient_name, message, nominal_value, design_id, wallet_number, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id
        `, [
            clientId,
            'Получатель Сертификата',
            '🎉 Поздравляю с праздником! 🎁 Желаю удачи в спорте! 🏂⛷️',
            5000,
            1, // classic design
            '1234567890'
        ]);
        
        const pendingId = pendingResult.rows[0].id;
        console.log(`✅ Pending certificate создан с ID: ${pendingId}`);
        
        // 3. Имитируем оплату (вызываем processPendingCertificate)
        console.log('💳 Имитируем оплату...');
        await processPendingCertificate('1234567890', 5000, client);
        
        // 4. Получаем созданный сертификат
        console.log('🔍 Получаем созданный сертификат...');
        const certResult = await client.query(`
            SELECT * FROM certificates 
            WHERE purchaser_id = $1 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [clientId]);
        
        if (certResult.rows.length === 0) {
            throw new Error('Сертификат не был создан');
        }
        
        const certificate = certResult.rows[0];
        console.log(`✅ Сертификат создан: ${certificate.certificate_number}`);
        console.log(`📄 PDF URL: ${certificate.pdf_url}`);
        
        // 5. Отправляем email с JPG на ваш адрес
        console.log('📧 Отправляем email с JPG сертификатом...');
        const emailService = new EmailService();
        
        const certificateData = {
            certificateId: certificate.id,
            certificateCode: certificate.certificate_number,
            recipientName: certificate.recipient_name,
            amount: certificate.nominal_value,
            message: certificate.message,
            pdfUrl: certificate.pdf_url
        };
        
        const emailResult = await emailService.sendCertificateEmail(
            'batl-zlat@yandex.ru', // Ваш реальный email
            certificateData
        );
        
        if (emailResult.success) {
            console.log('🎉 Email с JPG сертификатом отправлен успешно!');
            console.log('Message ID:', emailResult.messageId);
            console.log('📧 Проверьте почту: batl-zlat@yandex.ru');
        } else {
            console.log('❌ Ошибка при отправке email:', emailResult.error);
        }
        
    } catch (error) {
        console.error('❌ Ошибка в тесте:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        client.release();
    }
    
    console.log('=== Тест завершен ===');
}

// Запускаем тест
testRealPurchaseFlow().catch(console.error);
