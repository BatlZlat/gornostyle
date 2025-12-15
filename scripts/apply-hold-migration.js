require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function applyMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 Применение миграции: добавление hold для слотов...\n');
        
        const migrationPath = path.join(__dirname, '../migrations/add_hold_to_kuliga_slots.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        await client.query('BEGIN');
        
        console.log('📝 Выполнение SQL...');
        await client.query(migrationSQL);
        
        await client.query('COMMIT');
        
        console.log('\n✅ Миграция успешно применена!');
        console.log('\nДобавлено:');
        console.log('  - Статус "hold" для временной блокировки слотов');
        console.log('  - Поле hold_until (время истечения hold)');
        console.log('  - Поле hold_transaction_id (связь с транзакцией)');
        console.log('  - Функция clear_expired_holds() для автоматической очистки');
        console.log('  - Индексы для быстрого поиска');
        
        // Тестируем функцию очистки
        console.log('\n🧪 Тестирование функции clear_expired_holds()...');
        const result = await client.query('SELECT clear_expired_holds()');
        console.log(`   Освобождено слотов: ${result.rows[0].clear_expired_holds}`);
        
        process.exit(0);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Ошибка применения миграции:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

applyMigration();

