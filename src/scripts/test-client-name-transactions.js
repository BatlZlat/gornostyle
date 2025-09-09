const { pool } = require('../db');

/**
 * Тестовый скрипт для проверки добавления ФИО клиента в описание транзакций
 */
async function testClientNameTransactions() {
    console.log('🧪 Начинаем тестирование добавления ФИО клиента в описание транзакций...\n');

    try {
        // Тест 1: Проверяем последние транзакции пополнения
        console.log('📋 Тест 1: Проверка последних транзакций пополнения...');
        const query = `
            SELECT t.*, c.full_name 
            FROM transactions t
            JOIN wallets w ON t.wallet_id = w.id
            JOIN clients c ON w.client_id = c.id
            WHERE t.type = 'refill'
            ORDER BY t.created_at DESC
            LIMIT 5
        `;
        
        const result = await pool.query(query);
        console.log(`✅ Найдено ${result.rows.length} последних транзакций пополнения\n`);
        
        if (result.rows.length > 0) {
            console.log('📊 Детали транзакций:');
            result.rows.forEach((transaction, index) => {
                console.log(`  ${index + 1}. ID: ${transaction.id}`);
                console.log(`     Клиент: ${transaction.full_name}`);
                console.log(`     Сумма: ${transaction.amount} руб.`);
                console.log(`     Описание: ${transaction.description}`);
                console.log(`     Дата: ${transaction.created_at}`);
                console.log('');
            });
            
            // Проверяем формат описания
            const hasClientName = result.rows.some(t => 
                t.description.includes(' - ') && 
                (t.description.includes('Пополнение через СБП') || t.description.includes('Пополнение администратором'))
            );
            
            if (hasClientName) {
                console.log('✅ УСПЕХ: ФИО клиента добавлено в описание транзакций!');
            } else {
                console.log('⚠️  ВНИМАНИЕ: ФИО клиента не найдено в описании. Возможно, это старые транзакции.');
            }
        } else {
            console.log('ℹ️  Транзакций пополнения не найдено');
        }

        // Тест 2: Проверяем структуру таблицы transactions
        console.log('\n📋 Тест 2: Проверка структуры таблицы transactions...');
        const structureQuery = `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'transactions'
            ORDER BY ordinal_position
        `;
        
        const structureResult = await pool.query(structureQuery);
        console.log('✅ Структура таблицы transactions:');
        structureResult.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        });

        console.log('\n🎉 Все тесты завершены успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
        process.exit(1);
    }
}

// Запускаем тест
if (require.main === module) {
    testClientNameTransactions()
        .then(() => {
            console.log('\n✅ Тестирование завершено');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Тестирование провалено:', error);
            process.exit(1);
        });
}

module.exports = { testClientNameTransactions };
