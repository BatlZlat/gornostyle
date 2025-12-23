require('dotenv').config();
const { Pool } = require('pg');
const path = require('path');

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
                c.certificate_number, 
                c.nominal_value, 
                c.recipient_name, 
                c.message, 
                c.design_id, 
                c.expiry_date,
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
        console.log(`   Номинал: ${cert.nominal_value} руб.`);
        console.log(`   Получатель: ${cert.recipient_name || 'не указан'}`);
        console.log(`   Сообщение: ${cert.message || 'не указано'}`);
        console.log(`   Дизайн: ${cert.design_name} (ID: ${cert.design_id})`);
        console.log(`   Срок действия до: ${cert.expiry_date}\n`);
        
        // Формируем данные для генерации
        const certificateData = {
            certificate_number: cert.certificate_number,
            nominal_value: parseFloat(cert.nominal_value),
            recipient_name: cert.recipient_name,
            message: cert.message,
            expiry_date: cert.expiry_date,
            design_id: cert.design_id
        };
        
        console.log('🖼️  Генерация JPG файла...\n');
        
        // Генерируем JPG (модуль экспортирует экземпляр, а не класс)
        const generator = require('../src/services/certificateJpgGenerator');
        
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
            
            console.log(`✅ URL файла обновлен в базе данных\n`);
            console.log(`📁 Файл сохранен в: public/generated/certificates/certificate_${certificateNumber}.jpg\n`);
        } else {
            console.log(`❌ Не удалось создать JPG файл\n`);
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

