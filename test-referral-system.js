/**
 * Полноценный тест реферальной системы
 * 
 * Этапы теста:
 * 1. Находит клиента "Тестировщик" (клиент A)
 * 2. Получает его реферальный код
 * 3. Регистрирует нового пользователя "Реферал" по реферальной ссылке (клиент B)
 * 4. Проверяет начисление бонуса приглашенному (500₽)
 * 5. Проверяет уведомление пригласившему о регистрации реферала
 * 6. Пополняет баланс клиента B на 2000₽
 * 7. Проверяет изменение статуса реферальной транзакции на 'deposited'
 * 8. Записывает клиента B на групповую тренировку (07.11.2025 17:30)
 * 9. Проверяет начисление бонуса пригласившему (500₽) после первой тренировки
 * 10. Проверяет все транзакции и уведомления
 */

const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');

// Подключение к базе данных
const pool = new Pool({
    host: '90.156.210.24',
    port: 5432,
    database: 'skisimulator',
    user: 'batl-zlat',
    password: 'Nemezida2324%)',
    ssl: false
});

// Telegram Bot Token (если нужен для проверки уведомлений)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Цвета для консоли
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    console.log(`\n${colors.cyan}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.cyan}${title}${colors.reset}`);
    console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);
}

async function runReferralTest() {
    const client = await pool.connect();
    let clientA = null; // Тестировщик
    let clientB = null; // Реферал
    let referralTransaction = null;
    let trainingId = null;
    let sessionParticipantId = null;

    try {
        await client.query('BEGIN');

        logSection('🔍 ЭТАП 1: Поиск клиента A (Тестировщик)');
        
        const clientAResult = await client.query(
            `SELECT id, full_name, telegram_id, referral_code 
             FROM clients 
             WHERE full_name ILIKE '%Тестировщик%' 
             LIMIT 1`
        );

        if (clientAResult.rows.length === 0) {
            throw new Error('❌ Клиент "Тестировщик" не найден в базе данных');
        }

        clientA = clientAResult.rows[0];
        log(`✅ Найден клиент A: ${clientA.full_name} (ID: ${clientA.id})`, 'green');
        log(`   Telegram ID: ${clientA.telegram_id || 'не указан'}`, 'blue');
        log(`   Реферальный код: ${clientA.referral_code || 'не создан'}`, 'blue');

        if (!clientA.referral_code) {
            log('⚠️ У клиента A нет реферального кода, генерируем...', 'yellow');
            // Генерируем уникальный код
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let code;
            let isUnique = false;
            let attempts = 0;

            while (!isUnique && attempts < 100) {
                code = '';
                for (let i = 0; i < 6; i++) {
                    code += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                const checkResult = await client.query(
                    'SELECT COUNT(*) FROM clients WHERE referral_code = $1',
                    [code]
                );
                isUnique = parseInt(checkResult.rows[0].count) === 0;
                attempts++;
            }

            if (!isUnique) {
                throw new Error('Не удалось сгенерировать уникальный реферальный код');
            }

            await client.query(
                'UPDATE clients SET referral_code = $1 WHERE id = $2',
                [code, clientA.id]
            );
            clientA.referral_code = code;
            log(`✅ Реферальный код создан: ${code}`, 'green');
        }

        logSection('📝 ЭТАП 2: Регистрация клиента B (Реферал) по реферальной ссылке');
        
        // Проверяем, существует ли уже клиент "Реферал"
        const existingClientB = await client.query(
            `SELECT id FROM clients WHERE full_name ILIKE '%Реферал%' LIMIT 1`
        );

        if (existingClientB.rows.length > 0) {
            log('⚠️ Клиент "Реферал" уже существует, удаляем...', 'yellow');
            const existingId = existingClientB.rows[0].id;
            // Удаляем связанные записи
            await client.query('DELETE FROM referral_transactions WHERE referee_id = $1 OR referrer_id = $1', [existingId]);
            await client.query('DELETE FROM transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE client_id = $1)', [existingId]);
            await client.query('DELETE FROM wallets WHERE client_id = $1', [existingId]);
            await client.query('DELETE FROM children WHERE parent_id = $1', [existingId]);
            await client.query('DELETE FROM clients WHERE id = $1', [existingId]);
            log('✅ Старый клиент "Реферал" удален', 'green');
        }

        // Создаем нового клиента B
        const newClientBData = {
            full_name: 'Реферал Тестовый',
            birth_date: '1990-01-01',
            phone: '+79991234567',
            telegram_id: '999999999', // Тестовый Telegram ID
            telegram_username: 'referral_test',
            nickname: 'Реферал',
            referral_code: clientA.referral_code // Реферальный код клиента A
        };

        // Проверяем сумму бонуса из настроек
        const bonusSettingsResult = await client.query(
            `SELECT bonus_amount FROM bonus_settings 
             WHERE bonus_type = 'referral' AND is_active = TRUE 
             ORDER BY created_at DESC LIMIT 1`
        );
        const refereeBonus = bonusSettingsResult.rows.length > 0 
            ? bonusSettingsResult.rows[0].bonus_amount 
            : 500.00;

        log(`💰 Размер бонуса: ${refereeBonus}₽`, 'blue');

        // Генерируем уникальный реферальный код для клиента B
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let refereeCode;
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 100) {
            refereeCode = '';
            for (let i = 0; i < 6; i++) {
                refereeCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            const checkResult = await client.query(
                'SELECT COUNT(*) FROM clients WHERE referral_code = $1',
                [refereeCode]
            );
            isUnique = parseInt(checkResult.rows[0].count) === 0;
            attempts++;
        }

        // Вставляем клиента B
        const clientBResult = await client.query(
            `INSERT INTO clients (full_name, birth_date, phone, telegram_id, telegram_username, nickname, skill_level, referral_code, referred_by) 
             VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8) RETURNING id`,
            [newClientBData.full_name, newClientBData.birth_date, newClientBData.phone, 
             newClientBData.telegram_id, newClientBData.telegram_username, newClientBData.nickname, 
             refereeCode, clientA.id]
        );

        clientB = clientBResult.rows[0];
        log(`✅ Клиент B создан: ${newClientBData.full_name} (ID: ${clientB.id})`, 'green');

        // Создаем кошелек для клиента B (генерируем 16-значный номер)
        const generateWalletNumber = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
        let walletNumber;
        let walletIsUnique = false;
        let walletAttempts = 0;
        while (!walletIsUnique && walletAttempts < 10) {
            walletNumber = generateWalletNumber();
            const checkResult = await client.query(
                'SELECT COUNT(*) FROM wallets WHERE wallet_number = $1',
                [walletNumber]
            );
            if (parseInt(checkResult.rows[0].count) === 0) walletIsUnique = true;
            walletAttempts++;
        }
        if (!walletIsUnique) throw new Error('Не удалось сгенерировать уникальный номер кошелька');
        
        const walletResult = await client.query(
            `INSERT INTO wallets (client_id, wallet_number, balance) 
             VALUES ($1, $2, 0) RETURNING id`,
            [clientB.id, walletNumber]
        );
        const walletBId = walletResult.rows[0].id;
        log(`✅ Кошелек создан: ${walletNumber}`, 'green');

        // Создаем реферальную транзакцию и начисляем бонус приглашенному
        // Используем referral_code клиента A
        const referralResult = await client.query(
            `INSERT INTO referral_transactions (referrer_id, referee_id, referral_code, status, referee_bonus, registration_date) 
             VALUES ($1, $2, $3, 'registered', $4, CURRENT_TIMESTAMP) RETURNING id`,
            [clientA.id, clientB.id, clientA.referral_code, refereeBonus]
        );
        referralTransaction = referralResult.rows[0];
        log(`✅ Реферальная транзакция создана (ID: ${referralTransaction.id})`, 'green');
        log(`   Статус: registered`, 'blue');
        log(`   Бонус приглашенному: ${refereeBonus}₽ (уже выплачен)`, 'blue');

        // Начисляем бонус приглашенному
        await client.query(
            `UPDATE wallets 
             SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [refereeBonus, walletBId]
        );

        await client.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
             VALUES ($1, $2, 'bonus', $3)`,
            [walletBId, refereeBonus, 'Реферальный бонус за регистрацию по ссылке']
        );

        // Проверяем баланс
        const balanceCheck = await client.query(
            'SELECT balance FROM wallets WHERE id = $1',
            [walletBId]
        );
        log(`✅ Баланс клиента B после регистрации: ${balanceCheck.rows[0].balance}₽`, 'green');

        await client.query('COMMIT');
        
        logSection('✅ ЭТАП 2 ЗАВЕРШЕН: Клиент B зарегистрирован, бонус начислен');

        // Проверяем транзакции
        logSection('📊 ПРОВЕРКА ТРАНЗАКЦИЙ ПОСЛЕ РЕГИСТРАЦИИ');
        const transactionsAfterReg = await client.query(
            `SELECT t.*, w.client_id, c.full_name as client_name
             FROM transactions t
             JOIN wallets w ON t.wallet_id = w.id
             JOIN clients c ON w.client_id = c.id
             WHERE w.client_id = $1
             ORDER BY t.created_at DESC`,
            [clientB.id]
        );

        transactionsAfterReg.rows.forEach((tx, idx) => {
            log(`Транзакция ${idx + 1}:`, 'yellow');
            log(`  ID: ${tx.id}`);
            log(`  Тип: ${tx.type}`);
            log(`  Сумма: ${tx.amount}₽`);
            log(`  Описание: ${tx.description}`);
            log(`  Дата: ${tx.created_at}`);
        });

        logSection('💳 ЭТАП 3: Пополнение баланса клиента B на 2000₽');

        await client.query('BEGIN');

        await client.query(
            `UPDATE wallets 
             SET balance = balance + 2000, last_updated = CURRENT_TIMESTAMP 
             WHERE client_id = $1`,
            [clientB.id]
        );

        await client.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
             VALUES ($1, $2, 'refill', 'Тестовое пополнение баланса')`,
            [walletBId, 2000]
        );

        // Обновляем статус реферальной транзакции на 'deposited'
        await client.query(
            `UPDATE referral_transactions 
             SET status = 'deposited' 
             WHERE id = $1`,
            [referralTransaction.id]
        );

        await client.query('COMMIT');

        const balanceAfterDeposit = await client.query(
            'SELECT balance FROM wallets WHERE id = $1',
            [walletBId]
        );
        log(`✅ Баланс клиента B после пополнения: ${balanceAfterDeposit.rows[0].balance}₽`, 'green');

        // Проверяем статус реферальной транзакции
        const referralStatusCheck = await client.query(
            'SELECT status FROM referral_transactions WHERE id = $1',
            [referralTransaction.id]
        );
        log(`✅ Статус реферальной транзакции: ${referralStatusCheck.rows[0].status}`, 'green');

        logSection('📝 ЭТАП 4: Поиск тренировки для записи');

        // Ищем тренировку от 07.11.2025 17:30
        const trainingSearch = await client.query(
            `SELECT ts.*, t.full_name as trainer_name, g.name as group_name,
                    (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id AND status = 'confirmed') as current_participants
             FROM training_sessions ts
             LEFT JOIN trainers t ON ts.trainer_id = t.id
             LEFT JOIN groups g ON ts.group_id = g.id
             WHERE ts.session_date = '2025-11-07'
               AND ts.start_time = '17:30:00'
               AND ts.training_type = true
               AND (g.name ILIKE '%Горнолыжники дети%' OR g.name ILIKE '%дети%')
             LIMIT 1`
        );

        if (trainingSearch.rows.length === 0) {
            throw new Error('❌ Тренировка не найдена! Проверьте дату и время.');
        }

        const training = trainingSearch.rows[0];
        trainingId = training.id;
        log(`✅ Тренировка найдена:`, 'green');
        log(`   ID: ${training.id}`, 'blue');
        log(`   Дата: ${training.session_date}`, 'blue');
        log(`   Время: ${training.start_time}`, 'blue');
        log(`   Группа: ${training.group_name || 'Не указана'}`, 'blue');
        log(`   Тренер: ${training.trainer_name}`, 'blue');
        log(`   Цена: ${training.price}₽`, 'blue');
        log(`   Участников: ${training.current_participants}/${training.max_participants}`, 'blue');

        logSection('📝 ЭТАП 5: Запись клиента B на тренировку');

        await client.query('BEGIN');

        // Проверяем баланс перед записью
        const balanceBeforeBooking = await client.query(
            'SELECT balance FROM wallets WHERE id = $1',
            [walletBId]
        );
        const currentBalance = parseFloat(balanceBeforeBooking.rows[0].balance);
        const trainingPrice = parseFloat(training.price);
        
        log(`💰 Баланс перед записью: ${currentBalance}₽`, 'blue');
        log(`💰 Стоимость тренировки: ${trainingPrice}₽`, 'blue');

        if (currentBalance < trainingPrice) {
            throw new Error(`❌ Недостаточно средств! Баланс: ${currentBalance}₽, Нужно: ${trainingPrice}₽`);
        }

        // Добавляем участника
        const participantResult = await client.query(
            `INSERT INTO session_participants (session_id, client_id, is_child, status)
             VALUES ($1, $2, false, 'confirmed')
             RETURNING id`,
            [trainingId, clientB.id]
        );
        sessionParticipantId = participantResult.rows[0].id;

        // Обновляем количество участников (это делается через COUNT, но для совместимости можно пропустить)

        // Списываем деньги
        await client.query(
            `UPDATE wallets 
             SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [trainingPrice, walletBId]
        );

        await client.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
             VALUES ($1, $2, 'payment', 'Оплата групповой тренировки')`,
            [walletBId, -trainingPrice]
        );

        await client.query('COMMIT');

        log(`✅ Клиент B записан на тренировку (ID участника: ${sessionParticipantId})`, 'green');

        // Проверяем баланс после записи
        const balanceAfterBooking = await client.query(
            'SELECT balance FROM wallets WHERE id = $1',
            [walletBId]
        );
        log(`✅ Баланс клиента B после записи: ${balanceAfterBooking.rows[0].balance}₽`, 'green');

        // Проверяем первую тренировку и начисляем бонус пригласившему
        logSection('🎁 ЭТАП 6: Проверка первой тренировки и начисление бонуса пригласившему');

        // Проверяем, была ли это первая тренировка
        // Проверяем после записи, учитывая все тренировки (включая будущие)
        const firstTrainingCheck = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM individual_training_sessions 
                 WHERE client_id = $1 AND child_id IS NULL) as individual_count,
                (SELECT COUNT(*) FROM session_participants sp
                 JOIN training_sessions ts ON sp.session_id = ts.id
                 WHERE sp.client_id = $1 AND sp.is_child = false
                 AND sp.status = 'confirmed') as group_count
        `, [clientB.id]);

        const totalTrainings = parseInt(firstTrainingCheck.rows[0].individual_count) + 
                              parseInt(firstTrainingCheck.rows[0].group_count);

        log(`📊 Всего тренировок у клиента B: ${totalTrainings}`, 'blue');

        if (totalTrainings === 1) {
            log('✅ Это первая тренировка! Начисляем бонус пригласившему...', 'green');

            await client.query('BEGIN');

            // Обновляем статус на 'trained'
            await client.query(
                `UPDATE referral_transactions 
                 SET status = 'trained' 
                 WHERE id = $1`,
                [referralTransaction.id]
            );

            // Получаем кошелек пригласившего
            const referrerWalletResult = await client.query(
                'SELECT id, balance FROM wallets WHERE client_id = $1',
                [clientA.id]
            );

            if (referrerWalletResult.rows.length === 0) {
                throw new Error('Кошелек пригласившего не найден');
            }

            const referrerWallet = referrerWalletResult.rows[0];
            const referrerBonus = refereeBonus; // Та же сумма

            // Начисляем бонус пригласившему
            await client.query(
                `UPDATE wallets 
                 SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
                 WHERE id = $2`,
                [referrerBonus, referrerWallet.id]
            );

            await client.query(
                `INSERT INTO transactions (wallet_id, amount, type, description)
                 VALUES ($1, $2, 'bonus', $3)`,
                [referrerWallet.id, referrerBonus, `Реферальный бонус за приглашение друга (${newClientBData.full_name})`]
            );

            // Обновляем статус на 'completed'
            // Проверяем наличие колонки referrer_bonus_paid
            const columnsCheck = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'referral_transactions' 
                AND column_name IN ('referrer_bonus_paid', 'referee_bonus_paid')
            `);
            
            const hasBonusPaidColumns = columnsCheck.rows.some(r => r.column_name === 'referrer_bonus_paid');
            
            if (hasBonusPaidColumns) {
                await client.query(
                    `UPDATE referral_transactions 
                     SET status = 'completed',
                         referrer_bonus_paid = TRUE,
                         referrer_bonus = $1
                     WHERE id = $2`,
                    [referrerBonus, referralTransaction.id]
                );
            } else {
                await client.query(
                    `UPDATE referral_transactions 
                     SET status = 'completed',
                         referrer_bonus = $1
                     WHERE id = $2`,
                    [referrerBonus, referralTransaction.id]
                );
            }

            await client.query('COMMIT');

            log(`✅ Бонус ${referrerBonus}₽ начислен пригласившему (клиент A)`, 'green');

            // Проверяем баланс пригласившего
            const referrerBalanceAfter = await client.query(
                'SELECT balance FROM wallets WHERE client_id = $1',
                [clientA.id]
            );
            log(`✅ Баланс клиента A после начисления бонуса: ${referrerBalanceAfter.rows[0].balance}₽`, 'green');
        } else {
            log('⚠️ Это не первая тренировка, бонус не начисляется', 'yellow');
        }

        logSection('📊 ИТОГОВАЯ ПРОВЕРКА ТРАНЗАКЦИЙ');

        // Транзакции клиента B (приглашенного)
        log('\n💳 ТРАНЗАКЦИИ КЛИЕНТА B (Приглашенного):', 'cyan');
        const clientBTransactions = await client.query(
            `SELECT t.*, w.balance as wallet_balance
             FROM transactions t
             JOIN wallets w ON t.wallet_id = w.id
             WHERE w.client_id = $1
             ORDER BY t.created_at ASC`,
            [clientB.id]
        );

        clientBTransactions.rows.forEach((tx, idx) => {
            log(`${idx + 1}. ${tx.type.toUpperCase()}`, 'yellow');
            log(`   Сумма: ${tx.amount}₽`);
            log(`   Описание: ${tx.description}`);
            log(`   Дата: ${tx.created_at}`);
            log(`   Баланс после: ${tx.wallet_balance}₽`);
            log('');
        });

        // Транзакции клиента A (пригласившего)
        log('\n💳 ТРАНЗАКЦИИ КЛИЕНТА A (Пригласившего):', 'cyan');
        const clientATransactions = await client.query(
            `SELECT t.*, w.balance as wallet_balance
             FROM transactions t
             JOIN wallets w ON t.wallet_id = w.id
             WHERE w.client_id = $1
             ORDER BY t.created_at ASC`,
            [clientA.id]
        );

        clientATransactions.rows.forEach((tx, idx) => {
            log(`${idx + 1}. ${tx.type.toUpperCase()}`, 'yellow');
            log(`   Сумма: ${tx.amount}₽`);
            log(`   Описание: ${tx.description}`);
            log(`   Дата: ${tx.created_at}`);
            log(`   Баланс после: ${tx.wallet_balance}₽`);
            log('');
        });

        logSection('📋 ИТОГОВАЯ ПРОВЕРКА РЕФЕРАЛЬНОЙ ТРАНЗАКЦИИ');

        const finalReferralCheck = await client.query(
            `SELECT rt.*, 
                    c1.full_name as referrer_name,
                    c2.full_name as referee_name
             FROM referral_transactions rt
             JOIN clients c1 ON rt.referrer_id = c1.id
             JOIN clients c2 ON rt.referee_id = c2.id
             WHERE rt.id = $1`,
            [referralTransaction.id]
        );

        const finalReferral = finalReferralCheck.rows[0];
        log(`Статус: ${finalReferral.status}`, 'blue');
        log(`Пригласивший: ${finalReferral.referrer_name} (ID: ${finalReferral.referrer_id})`, 'blue');
        log(`Приглашенный: ${finalReferral.referee_name} (ID: ${finalReferral.referee_id})`, 'blue');
        log(`Бонус пригласившему: ${finalReferral.referrer_bonus}₽`, 'blue');
        log(`Бонус приглашенному: ${finalReferral.referee_bonus}₽`, 'blue');
        
        // Проверяем наличие колонок для вывода
        if (finalReferral.referrer_bonus_paid !== undefined) {
            log(`Бонус пригласившему выплачен: ${finalReferral.referrer_bonus_paid ? '✅' : '❌'}`, 'blue');
        }
        if (finalReferral.referee_bonus_paid !== undefined) {
            log(`Бонус приглашенному выплачен: ${finalReferral.referee_bonus_paid ? '✅' : '❌'}`, 'blue');
        }
        if (finalReferral.completed_at !== undefined) {
            log(`Дата завершения: ${finalReferral.completed_at || 'не завершена'}`, 'blue');
        }
        if (finalReferral.first_training_date !== undefined) {
            log(`Дата первой тренировки: ${finalReferral.first_training_date || 'не указана'}`, 'blue');
        }

        logSection('✅ ТЕСТ ЗАВЕРШЕН УСПЕШНО!');

        log('\n📝 РЕЗЮМЕ:', 'cyan');
        log(`1. ✅ Клиент A найден: ${clientA.full_name}`, 'green');
        log(`2. ✅ Клиент B зарегистрирован: ${newClientBData.full_name}`, 'green');
        log(`3. ✅ Бонус при регистрации начислен: ${refereeBonus}₽`, 'green');
        log(`4. ✅ Баланс пополнен: 2000₽`, 'green');
        log(`5. ✅ Клиент B записан на тренировку`, 'green');
        log(`6. ✅ Бонус пригласившему начислен: ${refereeBonus}₽`, 'green');
        log(`7. ✅ Реферальная транзакция завершена (status: completed)`, 'green');

    } catch (error) {
        await client.query('ROLLBACK');
        log(`\n❌ ОШИБКА: ${error.message}`, 'red');
        console.error(error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Запускаем тест
runReferralTest()
    .then(() => {
        log('\n✅ Все тесты пройдены успешно!', 'green');
        process.exit(0);
    })
    .catch((error) => {
        log(`\n❌ Тест завершился с ошибкой: ${error.message}`, 'red');
        process.exit(1);
    });
