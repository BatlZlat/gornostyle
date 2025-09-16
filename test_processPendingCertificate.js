const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Копируем функцию processPendingCertificate из src/routes/sms.js
async function processPendingCertificate(walletNumber, amount, dbClient) {
    console.log(`🔍 [processPendingCertificate] НАЧАЛО: кошелек ${walletNumber}, сумма ${amount}₽`);
    try {
        // Проверяем, есть ли ожидающий сертификат для этого кошелька
        // Ищем по номеру кошелька и проверяем, что сумма в разумных пределах
        console.log(`🔍 [processPendingCertificate] Поиск pending_certificate для кошелька ${walletNumber}`);
        const pendingQuery = `
            SELECT pc.*, c.full_name, c.email, c.phone, c.birth_date, cd.name as design_name
            FROM pending_certificates pc
            JOIN clients c ON pc.client_id = c.id
            LEFT JOIN certificate_designs cd ON pc.design_id = cd.id
            WHERE pc.wallet_number = $1 
            AND pc.expires_at > CURRENT_TIMESTAMP
            AND $2 >= 10  -- Минимальная сумма сертификата (временно для тестов)
            AND $2 <= 50000  -- Максимальная сумма сертификата
            ORDER BY pc.created_at DESC
            LIMIT 1
        `;
        
        const pendingResult = await dbClient.query(pendingQuery, [walletNumber, amount]);
        console.log(`🔍 [processPendingCertificate] Результат поиска: найдено ${pendingResult.rows.length} записей`);
        
        if (pendingResult.rows.length === 0) {
            console.log(`❌ [processPendingCertificate] Нет ожидающих сертификатов для кошелька ${walletNumber} на сумму ${amount}`);
            return;
        }

        const pendingCert = pendingResult.rows[0];
        console.log(`✅ [processPendingCertificate] Найден ожидающий сертификат для клиента ${pendingCert.full_name}`);
        console.log(`🔍 [processPendingCertificate] Данные pending_certificate: ID=${pendingCert.id}, получатель=${pendingCert.recipient_name}, сумма=${pendingCert.nominal_value}₽`);
        
        // Логируем изменение суммы, если она отличается от ожидаемой
        if (amount !== parseFloat(pendingCert.nominal_value)) {
            console.log(`⚠️ [processPendingCertificate] Сумма изменена: ожидалось ${pendingCert.nominal_value}₽, переведено ${amount}₽`);
        }

        console.log(`🔍 [processPendingCertificate] Начинаем транзакцию создания сертификата`);
        await dbClient.query('BEGIN');

        // Списываем деньги с кошелька
        console.log(`🔍 [processPendingCertificate] Списываем ${amount}₽ с кошелька ${walletNumber}`);
        await dbClient.query(
            `UPDATE wallets SET balance = balance - $1 WHERE wallet_number = $2`,
            [amount, walletNumber]
        );

        // Создаем транзакцию списания
        console.log(`🔍 [processPendingCertificate] Создаем транзакцию списания`);
        const transactionDescription = amount !== parseFloat(pendingCert.nominal_value) 
            ? `Покупка сертификата (${amount}₽ вместо ${pendingCert.nominal_value}₽) - ${pendingCert.full_name}`
            : `Покупка сертификата - ${pendingCert.full_name}`;
            
        await dbClient.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ((SELECT id FROM wallets WHERE wallet_number = $1), $2, 'payment', $3)`,
            [walletNumber, -amount, transactionDescription]
        );

        // Создаем сертификат на сумму, которую клиент реально перевел
        console.log(`🔍 [processPendingCertificate] Создаем сертификат для клиента ${pendingCert.client_id}`);
        const certificateQuery = `
            INSERT INTO certificates (
                purchaser_id, nominal_value, recipient_name, message, design_id, 
                certificate_number, status, purchase_date, expiry_date
            ) VALUES ($1, $2, $3, $4, $5, $6, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 year')
            RETURNING id, certificate_number
        `;
        
        // Генерируем уникальный 6-значный номер сертификата
        const certificateNumber = Math.floor(Math.random() * 900000 + 100000).toString();
        
        const certResult = await dbClient.query(certificateQuery, [
            pendingCert.client_id,
            amount,  // Используем реальную переведенную сумму вместо pendingCert.nominal_value
            pendingCert.recipient_name,
            pendingCert.message,
            pendingCert.design_id,
            certificateNumber
        ]);

        const certificateId = certResult.rows[0].id;
        console.log(`✅ [processPendingCertificate] Создан сертификат ID: ${certificateId}, номер: ${certificateNumber}, сумма: ${amount}₽`);

        // Удаляем запись из pending_certificates
        console.log(`🔍 [processPendingCertificate] Удаляем pending_certificate ID: ${pendingCert.id}`);
        await dbClient.query('DELETE FROM pending_certificates WHERE id = $1', [pendingCert.id]);

        console.log(`🔍 [processPendingCertificate] Завершаем транзакцию COMMIT`);
        await dbClient.query('COMMIT');

        console.log(`✅ [processPendingCertificate] ФУНКЦИЯ ЗАВЕРШЕНА УСПЕШНО`);

    } catch (error) {
        console.error(`❌ [processPendingCertificate] ОШИБКА при обработке ожидающего сертификата:`, error);
        console.error(`❌ [processPendingCertificate] Детали ошибки:`, error.message);
        console.error(`❌ [processPendingCertificate] Стек ошибки:`, error.stack);
        await dbClient.query('ROLLBACK');
        throw error;
    }
}

async function testProcessPendingCertificate() {
  console.log('🧪 ТЕСТИРОВАНИЕ ФУНКЦИИ processPendingCertificate');
  
  const client = await pool.connect();
  try {
    // Проверяем текущее состояние
    console.log('\n=== ТЕКУЩЕЕ СОСТОЯНИЕ ===');
    
    const pending = await client.query('SELECT * FROM pending_certificates ORDER BY created_at DESC LIMIT 1');
    console.log(`Pending_certificates: ${pending.rows.length}`);
    if (pending.rows.length > 0) {
      const pc = pending.rows[0];
      console.log(`- ID: ${pc.id}, кошелек: ${pc.wallet_number}, сумма: ${pc.nominal_value}₽, получатель: ${pc.recipient_name}`);
    }
    
    const transactions = await client.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 1');
    console.log(`Последняя транзакция: ${transactions.rows.length}`);
    if (transactions.rows.length > 0) {
      const t = transactions.rows[0];
      console.log(`- ID: ${t.id}, сумма: ${t.amount}₽, тип: ${t.type}, описание: ${t.description}`);
    }
    
    const certificates = await client.query('SELECT * FROM certificates ORDER BY purchase_date DESC LIMIT 1');
    console.log(`Последний сертификат: ${certificates.rows.length}`);
    if (certificates.rows.length > 0) {
      const c = certificates.rows[0];
      console.log(`- ID: ${c.id}, номер: ${c.certificate_number}, сумма: ${c.nominal_value}₽, получатель: ${c.recipient_name}`);
    }
    
    // Тестируем функцию
    if (pending.rows.length > 0) {
      const pc = pending.rows[0];
      console.log(`\n🧪 ВЫЗЫВАЕМ processPendingCertificate для кошелька ${pc.wallet_number} на сумму ${pc.nominal_value}₽`);
      
      try {
        await processPendingCertificate(pc.wallet_number, parseFloat(pc.nominal_value), client);
        console.log('✅ Функция выполнена успешно');
      } catch (error) {
        console.error('❌ Ошибка при выполнении функции:', error);
      }
    } else {
      console.log('❌ Нет pending_certificates для тестирования');
    }
    
    // Проверяем результат
    console.log('\n=== РЕЗУЛЬТАТ ===');
    
    const pendingAfter = await client.query('SELECT * FROM pending_certificates ORDER BY created_at DESC LIMIT 1');
    console.log(`Pending_certificates после: ${pendingAfter.rows.length}`);
    
    const certificatesAfter = await client.query('SELECT * FROM certificates ORDER BY purchase_date DESC LIMIT 1');
    console.log(`Сертификаты после: ${certificatesAfter.rows.length}`);
    if (certificatesAfter.rows.length > 0) {
      const c = certificatesAfter.rows[0];
      console.log(`- ID: ${c.id}, номер: ${c.certificate_number}, сумма: ${c.nominal_value}₽, получатель: ${c.recipient_name}`);
    }
    
  } finally {
    client.release();
    await pool.end();
  }
}

testProcessPendingCertificate().catch(console.error);
