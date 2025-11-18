const { Client } = require('pg');
require('dotenv').config();

async function fixClientReferences() {
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
        console.log('✅ Подключено к базе данных\n');

        // Начинаем транзакцию
        await client.query('BEGIN');

        // Получаем все записи из kuliga_clients
        const kuligaClientsRes = await client.query('SELECT * FROM kuliga_clients ORDER BY id');
        console.log(`📦 Найдено ${kuligaClientsRes.rows.length} клиентов в kuliga_clients:\n`);

        for (const kuligaClient of kuligaClientsRes.rows) {
            console.log(`🔍 Обрабатываю клиента ID ${kuligaClient.id}: ${kuligaClient.full_name} (${kuligaClient.phone})`);

            // Нормализуем телефон (убираем пробелы, дефисы, скобки)
            const normalizedPhone = kuligaClient.phone.replace(/[\s\-\(\)]/g, '');

            // Проверяем, есть ли клиент в clients по телефону
            const existingClientRes = await client.query(
                `SELECT id, full_name, phone, email, telegram_id FROM clients 
                 WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = $1 
                 LIMIT 1`,
                [normalizedPhone]
            );

            let clientId;

            if (existingClientRes.rows.length > 0) {
                // Клиент найден в clients
                const existingClient = existingClientRes.rows[0];
                clientId = existingClient.id;
                console.log(`   ✓ Найден существующий клиент в clients (ID: ${clientId})`);

                // Обновляем telegram_id если есть в kuliga_clients, но нет в clients
                if (kuligaClient.telegram_id && !existingClient.telegram_id) {
                    await client.query(
                        'UPDATE clients SET telegram_id = $1, telegram_username = $2 WHERE id = $3',
                        [kuligaClient.telegram_id, kuligaClient.telegram_username, clientId]
                    );
                    console.log(`   ✓ Обновлен telegram_id: ${kuligaClient.telegram_id}`);
                }

                // Обновляем email если есть в kuliga_clients, но нет в clients
                if (kuligaClient.email && !existingClient.email) {
                    await client.query(
                        'UPDATE clients SET email = $1 WHERE id = $2',
                        [kuligaClient.email, clientId]
                    );
                    console.log(`   ✓ Обновлен email: ${kuligaClient.email}`);
                }
            } else {
                // Клиент не найден, создаем нового в clients
                console.log(`   ⚠️ Клиент не найден в clients, создаю нового...`);

                // Создаем клиента с датой рождения 1900-01-01 (будет заменена при первом /start в боте)
                const insertRes = await client.query(
                    `INSERT INTO clients (full_name, phone, email, birth_date, telegram_id, telegram_username, created_at, updated_at)
                     VALUES ($1, $2, $3, '1900-01-01', $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                     RETURNING id`,
                    [
                        kuligaClient.full_name,
                        kuligaClient.phone,
                        kuligaClient.email || null,
                        kuligaClient.telegram_id || null,
                        kuligaClient.telegram_username || null
                    ]
                );

                clientId = insertRes.rows[0].id;
                console.log(`   ✓ Создан новый клиент в clients (ID: ${clientId})`);
            }

            // Обновляем все ссылки в kuliga_bookings
            const updateBookingsRes = await client.query(
                'UPDATE kuliga_bookings SET client_id = $1 WHERE client_id = $2',
                [clientId, kuligaClient.id]
            );
            console.log(`   ✓ Обновлено ${updateBookingsRes.rowCount} бронирований`);

            // Обновляем все ссылки в kuliga_transactions
            const updateTransactionsRes = await client.query(
                'UPDATE kuliga_transactions SET client_id = $1 WHERE client_id = $2',
                [clientId, kuligaClient.id]
            );
            console.log(`   ✓ Обновлено ${updateTransactionsRes.rowCount} транзакций`);

            // Обновляем все ссылки в kuliga_program_bookings
            const updateProgramBookingsRes = await client.query(
                'UPDATE kuliga_program_bookings SET client_id = $1 WHERE client_id = $2',
                [clientId, kuligaClient.id]
            );
            console.log(`   ✓ Обновлено ${updateProgramBookingsRes.rowCount} записей на программы\n`);
        }

        // Проверяем, остались ли некорректные ссылки
        const invalidRefs = await client.query(`
            SELECT kb.id, kb.client_id 
            FROM kuliga_bookings kb
            LEFT JOIN clients c ON kb.client_id = c.id
            WHERE c.id IS NULL
        `);

        if (invalidRefs.rows.length > 0) {
            console.log('❌ ОШИБКА: Все еще есть некорректные ссылки:');
            console.log(invalidRefs.rows);
            await client.query('ROLLBACK');
            return;
        }

        // Подтверждаем транзакцию
        await client.query('COMMIT');
        console.log('✅ Все данные успешно исправлены!\n');
        console.log('🚀 Теперь можно запустить миграцию: node scripts/run-unify-clients-migration.js');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ ОШИБКА:');
        console.error(error);
        process.exit(1);
    } finally {
        await client.end();
        console.log('\n🔌 Соединение с базой данных закрыто');
    }
}

// Запуск скрипта
fixClientReferences();

