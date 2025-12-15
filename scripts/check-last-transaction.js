require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function checkLastTransaction() {
    try {
        console.log('🔍 Проверяю последние транзакции...\n');
        
        // Последние транзакции
        const txResult = await pool.query(
            `SELECT id, client_id, booking_id, amount, status, 
                    provider_payment_id, provider_order_id, provider_status,
                    description, created_at
             FROM kuliga_transactions
             ORDER BY created_at DESC
             LIMIT 3`
        );
        
        console.log('📊 Последние 3 транзакции:');
        txResult.rows.forEach(tx => {
            console.log(`\n  ID: ${tx.id}`);
            console.log(`  Booking ID: ${tx.booking_id || '❌ НЕТ (бронирование не создано)'}`);
            console.log(`  Сумма: ${tx.amount}₽`);
            console.log(`  Статус: ${tx.status}`);
            console.log(`  Provider Status: ${tx.provider_status || 'N/A'}`);
            console.log(`  Provider Payment ID: ${tx.provider_payment_id || 'N/A'}`);
            console.log(`  Provider Order ID: ${tx.provider_order_id || 'N/A'}`);
            console.log(`  Описание: ${tx.description}`);
            console.log(`  Создано: ${tx.created_at}`);
        });
        
        // Последние webhook'и
        const webhookResult = await pool.query(
            `SELECT provider, webhook_type, payment_id, order_id, status,
                    processed, error_message, created_at
             FROM webhook_logs
             ORDER BY created_at DESC
             LIMIT 5`
        );
        
        console.log('\n\n📨 Последние 5 webhook\'ов:');
        if (webhookResult.rows.length === 0) {
            console.log('  ❌ Webhook\'ов не найдено!');
            console.log('  Это означает, что банк НЕ отправил уведомление об оплате.');
        } else {
            webhookResult.rows.forEach(wh => {
                console.log(`\n  Provider: ${wh.provider}`);
                console.log(`  Type: ${wh.webhook_type}`);
                console.log(`  Payment ID: ${wh.payment_id}`);
                console.log(`  Order ID: ${wh.order_id}`);
                console.log(`  Status: ${wh.status}`);
                console.log(`  Processed: ${wh.processed ? '✅' : '❌'}`);
                console.log(`  Error: ${wh.error_message || 'N/A'}`);
                console.log(`  Создано: ${wh.created_at}`);
            });
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

checkLastTransaction();

