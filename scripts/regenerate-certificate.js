require('dotenv').config();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function regenerateCertificate(certificateNumber) {
    const client = await pool.connect();
    
    try {
        console.log(`\n🔍 Поиск сертификата ${certificateNumber}...\n`);
        
        // Получаем данные сертификата из базы
        const certResult = await client.query(
            `SELECT 
                c.id,
                c.certificate_number, 
                c.nominal_value, 
                c.recipient_name, 
                c.message, 
                c.design_id, 
                c.expiry_date,
                c.pdf_url,
                c.image_url,
                cd.name as design_name
            FROM certificates c 
            LEFT JOIN certificate_designs cd ON c.design_id = cd.id 
            WHERE c.certificate_number = $1`,
            [certificateNumber]
        );
        
        if (certResult.rows.length === 0) {
            console.log(`❌ Сертификат ${certificateNumber} не найден в базе данных`);
            return;
        }
        
        const cert = certResult.rows[0];
        console.log(`✅ Сертификат найден:`);
        console.log(`   ID: ${cert.id}`);
        console.log(`   Номинал: ${cert.nominal_value} руб.`);
        console.log(`   Получатель: ${cert.recipient_name || 'не указан'}`);
        console.log(`   Сообщение: ${cert.message || 'не указано'}`);
        console.log(`   Дизайн: ${cert.design_name} (ID: ${cert.design_id})`);
        console.log(`   Срок действия до: ${new Date(cert.expiry_date).toLocaleString('ru-RU')}`);
        console.log(`   Текущий URL: ${cert.image_url || cert.pdf_url || 'не указан'}\n`);
        
        // Формируем данные для генерации (используем новую логику предпросмотра)
        const certificateData = {
            certificate_number: cert.certificate_number,
            nominal_value: parseFloat(cert.nominal_value),
            recipient_name: cert.recipient_name,
            message: cert.message,
            expiry_date: cert.expiry_date,
            design_id: cert.design_id
        };
        
        // Загружаем генератор (модуль экспортирует экземпляр)
        const generator = require('../src/services/certificateJpgGenerator');
        
        console.log('🗑️  Удаление старого файла (если существует)...');
        
        // Удаляем старый файл перед генерацией нового
        const oldFilePath = path.join(generator.outputDir, `certificate_${certificateNumber}.jpg`);
        
        try {
            await fs.access(oldFilePath);
            await fs.unlink(oldFilePath);
            console.log(`   ✅ Старый файл удален: ${oldFilePath}\n`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn(`   ⚠️  Не удалось удалить старый файл: ${error.message}`);
            } else {
                console.log(`   ℹ️  Старый файл не найден (это нормально)\n`);
            }
        }
        
        console.log('🖼️  Генерация JPG файла (используется метод предпросмотра)...\n');
        
        // Генерируем JPG используя новую логику предпросмотра
        // Передаем certificateData, чтобы использовался метод generateCertificateJpgFromHTMLForPurchase
        // Этот метод использует ту же логику, что и предварительный просмотр - более надежный и красивый
        const jpgResult = await generator.generateCertificateJpgForEmail(
            certificateNumber,
            certificateData
        );
        
        if (jpgResult.jpg_url) {
            console.log(`✅ JPG файл успешно создан: ${jpgResult.jpg_url}\n`);
            
            // Обновляем URL в базе данных
            await client.query(
                'UPDATE certificates SET pdf_url = $1, image_url = $1 WHERE certificate_number = $2',
                [jpgResult.jpg_url, certificateNumber]
            );
            
            console.log(`✅ URL файла обновлен в базе данных`);
            console.log(`📁 Файл сохранен в: public/generated/certificates/certificate_${certificateNumber}.jpg\n`);
        } else {
            console.log(`❌ Не удалось создать JPG файл\n`);
            throw new Error('Не удалось получить URL созданного файла');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при пересоздании сертификата:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Получаем номер сертификата из аргументов командной строки
const certificateNumber = process.argv[2];

if (!certificateNumber) {
    console.error('❌ Укажите номер сертификата: node regenerate-certificate.js <номер>');
    process.exit(1);
}

if (!/^[0-9]{6}$/.test(certificateNumber)) {
    console.error('❌ Неверный формат номера сертификата. Номер должен состоять из 6 цифр.');
    process.exit(1);
}

regenerateCertificate(certificateNumber)
    .then(() => {
        console.log('✅ Готово!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Критическая ошибка:', error);
        process.exit(1);
    });

