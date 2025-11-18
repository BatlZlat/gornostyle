const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
    // Подключение через SSH туннель
    const client = new Client({
        host: '127.0.0.1',
        port: 6432,
        database: 'skisimulator',
        user: 'batl-zlat',
        password: 'Nemezida2324%)'
    });

    try {
        console.log('🔌 Подключение к базе данных...');
        await client.connect();
        console.log('✅ Подключено к базе данных');

        // Проверяем текущее состояние
        console.log('\n📊 ПРОВЕРКА ТЕКУЩЕГО СОСТОЯНИЯ:');
        
        const kuligaClientsCheck = await client.query(`
            SELECT COUNT(*) as count FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'kuliga_clients'
        `);
        
        if (kuligaClientsCheck.rows[0].count === '0') {
            console.log('⚠️ Таблица kuliga_clients уже удалена. Миграция уже выполнена.');
            return;
        }

        const kuligaClientsCount = await client.query('SELECT COUNT(*) FROM kuliga_clients');
        const kuligaBookingsCount = await client.query('SELECT COUNT(*) FROM kuliga_bookings');
        const clientsCount = await client.query('SELECT COUNT(*) FROM clients');

        console.log(`   📦 kuliga_clients: ${kuligaClientsCount.rows[0].count} записей`);
        console.log(`   📦 kuliga_bookings: ${kuligaBookingsCount.rows[0].count} записей`);
        console.log(`   📦 clients: ${clientsCount.rows[0].count} записей`);

        // Проверяем, есть ли данные в kuliga_bookings
        if (parseInt(kuligaBookingsCount.rows[0].count) > 0) {
            console.log('\n⚠️ ВНИМАНИЕ: В kuliga_bookings есть записи!');
            console.log('   Миграция автоматически перенесет данные из kuliga_clients в clients');
        }

        console.log('\n🚀 Запуск миграции...');

        // Читаем SQL миграции
        const migrationPath = path.join(__dirname, '..', 'src', 'db', 'migrations', '033_unify_clients_tables.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        // Выполняем миграцию
        await client.query(migrationSQL);

        console.log('✅ Миграция успешно выполнена!');

        // Проверяем результат
        console.log('\n📊 ПРОВЕРКА ПОСЛЕ МИГРАЦИИ:');
        
        const kuligaClientsAfter = await client.query(`
            SELECT COUNT(*) as count FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'kuliga_clients'
        `);
        
        console.log(`   ❌ kuliga_clients: ${kuligaClientsAfter.rows[0].count === '0' ? 'УДАЛЕНА' : 'ВСЕ ЕЩЕ СУЩЕСТВУЕТ'}`);

        // Проверяем внешние ключи
        const fkCheck = await client.query(`
            SELECT 
                conname AS constraint_name,
                conrelid::regclass AS table_name,
                confrelid::regclass AS referenced_table
            FROM pg_constraint
            WHERE conrelid IN ('kuliga_bookings'::regclass, 'kuliga_transactions'::regclass, 'kuliga_program_bookings'::regclass)
            AND contype = 'f'
            AND conname LIKE '%client_id%'
        `);

        console.log('\n📋 ВНЕШНИЕ КЛЮЧИ:');
        fkCheck.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}.${row.constraint_name} -> ${row.referenced_table}`);
        });

        console.log('\n✨ Миграция завершена успешно!');

    } catch (error) {
        console.error('\n❌ ОШИБКА при выполнении миграции:');
        console.error(error);
        process.exit(1);
    } finally {
        await client.end();
        console.log('\n🔌 Соединение с базой данных закрыто');
    }
}

// Запуск миграции
runMigration();

