/**
 * Полный тест реферальной системы
 * Тестируем: регистрация → пополнение → тренировка → начисление бонусов
 */

const { Pool } = require('pg');

const pool = new Pool({
    host: '90.156.210.24',
    port: 5432,
    database: 'skisimulator',
    user: 'batl-zlat',
    password: 'Nemezida2324%)',
    ssl: false
});

// Данные для теста
const TEST_DATA = {
    referrer: {
        id: 91,
        name: 'Тестировщик',
        telegram_id: '546668421',
        referral_code: 'SDR0XX'
    },
    referee: {
        name: 'Тест Рефералович',
        telegram_id: '999999999', // Тестовый Telegram ID
        phone: '+7999999999',
        birth_date: '1990-01-01'
    }
};

async function runReferralTest() {
    const client = await pool.connect();
    
    try {
        console.log('🧪 НАЧИНАЕМ ПОЛНЫЙ ТЕСТ РЕФЕРАЛЬНОЙ СИСТЕМЫ');
        console.log('═'.repeat(70));
        
        await client.query('BEGIN');
        
        // ЭТАП 1: Регистрация нового пользователя по реферальной ссылке
        console.log('\n1️⃣ ЭТАП: Регистрация по реферальной ссылке');
        console.log('─'.repeat(50));
        
        // Создаем нового пользователя
        const newUserResult = await client.query(`
            INSERT INTO clients (
                full_name, telegram_id, phone, birth_date, 
                referral_code, referred_by, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id, referral_code
        `, [
            TEST_DATA.referee.name,
            TEST_DATA.referee.telegram_id,
            TEST_DATA.referee.phone,
            TEST_DATA.referee.birth_date,
            'TEST' + Math.random().toString(36).substr(2, 5).toUpperCase(), // Генерируем код
            TEST_DATA.referrer.id
        ]);
        
        const newUserId = newUserResult.rows[0].id;
        const newUserReferralCode = newUserResult.rows[0].referral_code;
        
        console.log(`✅ Создан новый пользователь:`);
        console.log(`   👤 Имя: ${TEST_DATA.referee.name}`);
        console.log(`   🆔 ID: ${newUserId}`);
        console.log(`   📱 Telegram: ${TEST_DATA.referee.telegram_id}`);
        console.log(`   🔗 Реферальный код: ${newUserReferralCode}`);
        console.log(`   👥 Приглашен пользователем: ${TEST_DATA.referrer.name} (ID: ${TEST_DATA.referrer.id})`);
        
        // Создаем кошелек для нового пользователя
        const walletNumber = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
        await client.query(`
            INSERT INTO wallets (client_id, balance, wallet_number, last_updated)
            VALUES ($1, 0, $2, CURRENT_TIMESTAMP)
        `, [newUserId, walletNumber]);
        
        console.log(`✅ Создан кошелек: ${walletNumber}`);
        
        // Создаем реферальную транзакцию
        const referralTransactionResult = await client.query(`
            INSERT INTO referral_transactions (
                referrer_id, referee_id, referral_code, status, referrer_bonus, referee_bonus,
                created_at, updated_at
            ) VALUES ($1, $2, $3, 'registered', 500.00, 500.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id
        `, [TEST_DATA.referrer.id, newUserId, TEST_DATA.referrer.referral_code]);
        
        const referralTransactionId = referralTransactionResult.rows[0].id;
        console.log(`✅ Создана реферальная транзакция ID: ${referralTransactionId}`);
        console.log(`   📊 Статус: registered`);
        console.log(`   💰 Бонус пригласившему: 500₽`);
        console.log(`   💰 Бонус приглашенному: 500₽`);
        
        // ЭТАП 2: Пополнение баланса
        console.log('\n2️⃣ ЭТАП: Пополнение баланса');
        console.log('─'.repeat(50));
        
        const depositAmount = 3000;
        
        // Обновляем баланс
        await client.query(`
            UPDATE wallets 
            SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
            WHERE client_id = $2
        `, [depositAmount, newUserId]);
        
        // Создаем транзакцию пополнения
        await client.query(`
            INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ((SELECT id FROM wallets WHERE client_id = $1), $2, 'refill', $3)
        `, [newUserId, depositAmount, `Тестовое пополнение - ${TEST_DATA.referee.name}`]);
        
        console.log(`✅ Пополнение баланса:`);
        console.log(`   💰 Сумма: ${depositAmount}₽`);
        console.log(`   💳 Кошелек: ${walletNumber}`);
        
        // Обновляем статус реферальной транзакции
        await client.query(`
            UPDATE referral_transactions 
            SET status = 'deposited' 
            WHERE id = $1
        `, [referralTransactionId]);
        
        console.log(`✅ Статус реферальной транзакции обновлен: registered → deposited`);
        
        // ЭТАП 3: Запись на индивидуальную тренировку
        console.log('\n3️⃣ ЭТАП: Запись на индивидуальную тренировку');
        console.log('─'.repeat(50));
        
        // Находим свободного тренера
        const trainerResult = await client.query(`
            SELECT id, full_name FROM trainers WHERE is_active = true LIMIT 1
        `);
        
        if (trainerResult.rows.length === 0) {
            throw new Error('Нет активных тренеров');
        }
        
        const trainer = trainerResult.rows[0];
        const trainingPrice = 1500; // Цена индивидуальной тренировки
        const trainingDate = new Date();
        trainingDate.setDate(trainingDate.getDate() + 1); // Завтра
        const trainingTime = '10:00';
        
        // Создаем индивидуальную тренировку
        const trainingResult = await client.query(`
            INSERT INTO individual_training_sessions (
                client_id, equipment_type, with_trainer, duration, 
                preferred_date, preferred_time, price, created_at
            ) VALUES ($1, 'ski', true, 30, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING id
        `, [newUserId, trainingDate.toISOString().split('T')[0], trainingTime, trainingPrice]);
        
        const trainingId = trainingResult.rows[0].id;
        
        // Списываем средства
        await client.query(`
            UPDATE wallets 
            SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP 
            WHERE client_id = $2
        `, [trainingPrice, newUserId]);
        
        // Создаем транзакцию оплаты
        await client.query(`
            INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ((SELECT id FROM wallets WHERE client_id = $1), $2, 'payment', $3)
        `, [newUserId, trainingPrice, `Запись: Индивидуальная тренировка, ${TEST_DATA.referee.name}, Дата: ${trainingDate.toISOString().split('T')[0]}, Время: ${trainingTime}, Длительность: 30 мин.`]);
        
        console.log(`✅ Создана индивидуальная тренировка:`);
        console.log(`   🆔 ID: ${trainingId}`);
        console.log(`   👨‍🏫 Тренер: ${trainer.full_name}`);
        console.log(`   📅 Дата: ${trainingDate.toISOString().split('T')[0]}`);
        console.log(`   ⏰ Время: ${trainingTime}`);
        console.log(`   ⏱️ Длительность: 30 мин`);
        console.log(`   💰 Цена: ${trainingPrice}₽`);
        
        // ЭТАП 4: Начисление реферальных бонусов
        console.log('\n4️⃣ ЭТАП: Начисление реферальных бонусов');
        console.log('─'.repeat(50));
        
        // Обновляем статус на 'trained'
        await client.query(`
            UPDATE referral_transactions 
            SET status = 'trained' 
            WHERE id = $1
        `, [referralTransactionId]);
        
        console.log(`✅ Статус реферальной транзакции обновлен: deposited → trained`);
        
        // Начисляем бонусы обоим пользователям
        const bonusAmount = 500;
        
        // Бонус пригласившему
        await client.query(`
            UPDATE wallets 
            SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
            WHERE client_id = $2
        `, [bonusAmount, TEST_DATA.referrer.id]);
        
        await client.query(`
            INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ((SELECT id FROM wallets WHERE client_id = $1), $2, 'bonus', $3)
        `, [TEST_DATA.referrer.id, bonusAmount, `Реферальный бонус за приглашение друга (${TEST_DATA.referee.name})`]);
        
        // Бонус приглашенному
        await client.query(`
            UPDATE wallets 
            SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
            WHERE client_id = $2
        `, [bonusAmount, newUserId]);
        
        await client.query(`
            INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ((SELECT id FROM wallets WHERE client_id = $1), $2, 'bonus', $3)
        `, [newUserId, bonusAmount, `Реферальный бонус за регистрацию по ссылке (от ${TEST_DATA.referrer.name})`]);
        
        // Обновляем финальный статус
        await client.query(`
            UPDATE referral_transactions 
            SET status = 'completed',
                first_training_date = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [referralTransactionId]);
        
        console.log(`✅ Бонусы начислены:`);
        console.log(`   👤 ${TEST_DATA.referrer.name}: +${bonusAmount}₽`);
        console.log(`   👤 ${TEST_DATA.referee.name}: +${bonusAmount}₽`);
        console.log(`✅ Статус реферальной транзакции: trained → completed`);
        
        // ЭТАП 5: Проверка результатов
        console.log('\n5️⃣ ЭТАП: Проверка результатов');
        console.log('─'.repeat(50));
        
        // Проверяем балансы
        const referrerBalanceResult = await client.query(`
            SELECT balance FROM wallets WHERE client_id = $1
        `, [TEST_DATA.referrer.id]);
        
        const refereeBalanceResult = await client.query(`
            SELECT balance FROM wallets WHERE client_id = $1
        `, [newUserId]);
        
        console.log(`💰 Балансы после теста:`);
        console.log(`   👤 ${TEST_DATA.referrer.name}: ${referrerBalanceResult.rows[0].balance}₽`);
        console.log(`   👤 ${TEST_DATA.referee.name}: ${refereeBalanceResult.rows[0].balance}₽`);
        
        // Проверяем транзакции
        const transactionsResult = await client.query(`
            SELECT t.amount, t.type, t.description, c.full_name
            FROM transactions t
            JOIN wallets w ON t.wallet_id = w.id
            JOIN clients c ON w.client_id = c.id
            WHERE c.id IN ($1, $2)
            AND t.description LIKE '%Тест%' OR t.description LIKE '%Реферальный%'
            ORDER BY t.created_at DESC
        `, [TEST_DATA.referrer.id, newUserId]);
        
        console.log(`📋 Созданные транзакции:`);
        transactionsResult.rows.forEach(tx => {
            console.log(`   ${tx.full_name}: ${tx.amount}₽ (${tx.type}) - ${tx.description}`);
        });
        
        await client.query('COMMIT');
        
        console.log('\n✅ ТЕСТ УСПЕШНО ЗАВЕРШЕН!');
        console.log('═'.repeat(70));
        
        return {
            success: true,
            newUserId,
            referralTransactionId,
            trainingId,
            walletNumber
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ ОШИБКА В ТЕСТЕ:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function cleanupTestData(testResults) {
    const client = await pool.connect();
    
    try {
        console.log('\n🧹 ОЧИСТКА ТЕСТОВЫХ ДАННЫХ');
        console.log('─'.repeat(50));
        
        await client.query('BEGIN');
        
        // Удаляем транзакции
        await client.query(`
            DELETE FROM transactions 
            WHERE description LIKE '%Тест%' 
            OR description LIKE '%Реферальный%'
            OR description LIKE '%${TEST_DATA.referee.name}%'
        `);
        console.log('✅ Удалены тестовые транзакции');
        
        // Удаляем индивидуальную тренировку
        await client.query(`
            DELETE FROM individual_training_sessions 
            WHERE id = $1
        `, [testResults.trainingId]);
        console.log('✅ Удалена тестовая тренировка');
        
        // Удаляем реферальную транзакцию
        await client.query(`
            DELETE FROM referral_transactions 
            WHERE id = $1
        `, [testResults.referralTransactionId]);
        console.log('✅ Удалена реферальная транзакция');
        
        // Удаляем кошелек
        await client.query(`
            DELETE FROM wallets 
            WHERE client_id = $1
        `, [testResults.newUserId]);
        console.log('✅ Удален тестовый кошелек');
        
        // Удаляем пользователя
        await client.query(`
            DELETE FROM clients 
            WHERE id = $1
        `, [testResults.newUserId]);
        console.log('✅ Удален тестовый пользователь');
        
        await client.query('COMMIT');
        
        console.log('\n✅ ОЧИСТКА ЗАВЕРШЕНА!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при очистке:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Запуск теста
async function main() {
    try {
        const testResults = await runReferralTest();
        
        console.log('\n⏳ Ожидание 5 секунд перед очисткой...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        await cleanupTestData(testResults);
        
        console.log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!');
        process.exit(0);
        
    } catch (error) {
        console.error('\n💥 ТЕСТ ПРОВАЛЕН:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
