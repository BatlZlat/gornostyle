const { pool } = require('./src/db');
const { processPendingCertificate } = require('./src/routes/sms');

async function testJpgOnly() {
    console.log('=== Тест только JPG генерации ===');
    
    const client = await pool.connect();
    
    try {
        // 1. Создаем тестового клиента
        console.log('👤 Создаем тестового клиента...');
        const clientResult = await client.query(`
            INSERT INTO clients (full_name, phone, email, telegram_id, birth_date, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id
        `, ['Тест JPG Only', '+79991234580', 'test-jpg@example.com', (Date.now() + 4).toString(), '1990-01-01']);
        
        const clientId = clientResult.rows[0].id;
        console.log(`✅ Клиент создан с ID: ${clientId}`);
        
        // 2. Создаем pending certificate
        console.log('📝 Создаем pending certificate...');
        const pendingResult = await client.query(`
            INSERT INTO pending_certificates (
                client_id, recipient_name, message, nominal_value, design_id, wallet_number, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id
        `, [
            clientId,
            'Тест JPG',
            '🎉 ТЕСТ ТОЛЬКО JPG! 🎁 Серая рамка должна быть фиксированной! 🏂⛷️🎿🎯',
            1500,
            2, // sport design
            '6666666666'
        ]);
        
        const pendingId = pendingResult.rows[0].id;
        console.log(`✅ Pending certificate создан с ID: ${pendingId}`);
        
        // 3. Имитируем оплату
        console.log('💳 Имитируем оплату...');
        await processPendingCertificate('6666666666', 1500, client);
        
        // 4. Проверяем созданный сертификат
        console.log('🔍 Проверяем созданный сертификат...');
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
        console.log(`📄 URL в базе: ${certificate.pdf_url}`);
        console.log(`💬 Сообщение: ${certificate.message}`);
        
        // 5. Проверяем файлы в директории
        console.log('📁 Проверяем файлы в public/generated/certificates/...');
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
            const files = await fs.readdir(path.join(__dirname, 'public/generated/certificates/'));
            const certFiles = files.filter(f => f.includes(certificate.certificate_number));
            console.log('📄 Файлы сертификата:', certFiles);
            
            for (const file of certFiles) {
                const filePath = path.join(__dirname, 'public/generated/certificates/', file);
                const stats = await fs.stat(filePath);
                console.log(`📊 ${file}: ${(stats.size / 1024).toFixed(1)} KB`);
                
                if (file.endsWith('.pdf')) {
                    console.log('❌ ОШИБКА: PDF файл все еще создается!');
                } else if (file.endsWith('.jpg')) {
                    console.log('✅ JPG файл создан успешно!');
                }
            }
        } catch (error) {
            console.log('❌ Ошибка при чтении директории:', error.message);
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
testJpgOnly().catch(console.error);
