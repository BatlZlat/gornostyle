/**
 * Скрипт для тестирования автоматического сгорания просроченных сертификатов
 * Можно запустить вручную для проверки работы задачи
 * 
 * Использование:
 * node scripts/test-certificate-expiration.js
 */

const { pool } = require('../src/db');

async function testCertificateExpiration() {
    console.log('🎟️ Запуск тестирования автоматического сгорания сертификатов...\n');
    
    try {
        // 1. Проверяем текущее состояние
        console.log('📊 Текущее состояние сертификатов:');
        const currentStats = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count,
                SUM(nominal_value) as total_value
            FROM certificates
            GROUP BY status
            ORDER BY status
        `);
        
        console.table(currentStats.rows.map(row => ({
            'Статус': row.status,
            'Количество': parseInt(row.count),
            'Сумма (₽)': parseFloat(row.total_value).toLocaleString('ru-RU')
        })));
        
        // 2. Проверяем просроченные сертификаты
        console.log('\n🔍 Просроченные сертификаты (status = active, expiry_date < NOW):');
        const expiredCheck = await pool.query(`
            SELECT 
                id,
                certificate_number,
                recipient_name,
                nominal_value,
                status,
                expiry_date,
                purchase_date
            FROM certificates
            WHERE status = 'active' AND expiry_date < NOW()
            ORDER BY expiry_date DESC
            LIMIT 20
        `);
        
        if (expiredCheck.rows.length === 0) {
            console.log('✅ Просроченных активных сертификатов не найдено');
        } else {
            console.log(`⚠️ Найдено ${expiredCheck.rows.length} просроченных сертификатов:\n`);
            console.table(expiredCheck.rows.map(cert => ({
                'ID': cert.id,
                'Номер': cert.certificate_number,
                'Получатель': cert.recipient_name || '—',
                'Номинал (₽)': parseFloat(cert.nominal_value).toLocaleString('ru-RU'),
                'Статус': cert.status,
                'Истек': new Date(cert.expiry_date).toLocaleDateString('ru-RU'),
                'Дней просрочки': Math.floor((new Date() - new Date(cert.expiry_date)) / (1000 * 60 * 60 * 24))
            })));
            
            const totalValue = expiredCheck.rows.reduce((sum, cert) => sum + parseFloat(cert.nominal_value), 0);
            console.log(`\n💰 Общая сумма просроченных: ${totalValue.toLocaleString('ru-RU')} ₽\n`);
        }
        
        // 3. Спрашиваем подтверждение
        if (expiredCheck.rows.length > 0) {
            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise(resolve => {
                readline.question(`❓ Пометить эти сертификаты как 'expired'? (да/нет): `, resolve);
            });
            
            readline.close();
            
            if (answer.toLowerCase() === 'да' || answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
                console.log('\n⚙️ Обновление статуса просроченных сертификатов...');
                
                const result = await pool.query(`
                    UPDATE certificates 
                    SET status = 'expired', updated_at = CURRENT_TIMESTAMP 
                    WHERE status = 'active' AND expiry_date < NOW()
                    RETURNING id, certificate_number, recipient_name, nominal_value
                `);
                
                console.log(`✅ Обновлено сертификатов: ${result.rows.length}\n`);
                
                if (result.rows.length > 0) {
                    console.log('📝 Обновленные сертификаты:');
                    console.table(result.rows.map(cert => ({
                        'ID': cert.id,
                        'Номер': cert.certificate_number,
                        'Получатель': cert.recipient_name || '—',
                        'Номинал (₽)': parseFloat(cert.nominal_value).toLocaleString('ru-RU')
                    })));
                }
                
                // 4. Проверяем результат
                console.log('\n📊 Итоговое состояние сертификатов:');
                const finalStats = await pool.query(`
                    SELECT 
                        status,
                        COUNT(*) as count,
                        SUM(nominal_value) as total_value
                    FROM certificates
                    GROUP BY status
                    ORDER BY status
                `);
                
                console.table(finalStats.rows.map(row => ({
                    'Статус': row.status,
                    'Количество': parseInt(row.count),
                    'Сумма (₽)': parseFloat(row.total_value).toLocaleString('ru-RU')
                })));
                
                console.log('\n✅ Тестирование завершено успешно!');
            } else {
                console.log('\n❌ Отмена операции. Сертификаты не были обновлены.');
            }
        }
        
    } catch (error) {
        console.error('\n❌ Ошибка при тестировании:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Запуск
testCertificateExpiration()
    .then(() => {
        console.log('\n👋 Завершение работы скрипта');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Фатальная ошибка:', error);
        process.exit(1);
    });

