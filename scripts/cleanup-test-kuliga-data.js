/**
 * Скрипт для очистки тестовых данных зимних тренировок (Кулига)
 * 
 * Использование:
 *   CLEANUP_INSTRUCTOR_ID=1 CLEANUP_DATE=2025-12-05 DRY_RUN=true node scripts/cleanup-test-kuliga-data.js
 * 
 * Переменные окружения:
 *   CLEANUP_INSTRUCTOR_ID - ID инструктора для очистки (обязательно)
 *   CLEANUP_DATE - Дата отсечки (формат: YYYY-MM-DD), по умолчанию: 2025-12-05
 *   DRY_RUN - true = только показать (безопасно), false = удалить (по умолчанию: true)
 */

const { pool } = require('../src/db/index');
require('dotenv').config();

const INSTRUCTOR_ID = process.env.CLEANUP_INSTRUCTOR_ID ? parseInt(process.env.CLEANUP_INSTRUCTOR_ID) : null;
const CLEANUP_DATE = process.env.CLEANUP_DATE || '2025-12-05';
const DRY_RUN = process.env.DRY_RUN !== 'false'; // По умолчанию безопасный режим

async function cleanupTestData() {
    const client = await pool.connect();
    
    try {
        if (!INSTRUCTOR_ID) {
            console.error('❌ Укажите CLEANUP_INSTRUCTOR_ID в переменных окружения');
            console.error('   Пример: CLEANUP_INSTRUCTOR_ID=1 CLEANUP_DATE=2025-12-05 DRY_RUN=true node scripts/cleanup-test-kuliga-data.js');
            process.exit(1);
        }

        // Проверяем, существует ли инструктор
        const instructorCheck = await client.query(
            'SELECT id, full_name FROM kuliga_instructors WHERE id = $1',
            [INSTRUCTOR_ID]
        );

        if (instructorCheck.rows.length === 0) {
            console.error(`❌ Инструктор с ID ${INSTRUCTOR_ID} не найден`);
            process.exit(1);
        }

        const instructorName = instructorCheck.rows[0].full_name;

        console.log('='.repeat(60));
        console.log('🧹 ОЧИСТКА ТЕСТОВЫХ ДАННЫХ ЗИМНИХ ТРЕНИРОВОК');
        console.log('='.repeat(60));
        console.log(`👤 Инструктор: ${instructorName} (ID: ${INSTRUCTOR_ID})`);
        console.log(`📅 Дата отсечки: ${CLEANUP_DATE}`);
        console.log(`🔍 Режим: ${DRY_RUN ? 'ПРОСМОТР (DRY RUN - данные НЕ будут удалены)' : 'УДАЛЕНИЕ (данные БУДУТ удалены)'}`);
        console.log('='.repeat(60));
        console.log('');

        if (!DRY_RUN) {
            console.log('⚠️  ВНИМАНИЕ: Режим УДАЛЕНИЯ активен!');
            console.log('⚠️  Убедитесь, что у вас есть резервная копия базы данных!');
            console.log('');
        }

        await client.query('BEGIN');

        const stats = {
            transactions: 0,
            bookings: 0,
            groupTrainings: 0,
            slots: 0,
            payouts: 0
        };

        // 1. Проверка транзакций
        console.log('1️⃣ Проверка транзакций...');
        const transactionsResult = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_transactions 
            WHERE booking_id IN (
                SELECT id FROM kuliga_bookings 
                WHERE (instructor_id = $1 OR group_training_id IN (
                    SELECT id FROM kuliga_group_trainings WHERE instructor_id = $1
                ))
                AND date < $2::date
            )
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        stats.transactions = parseInt(transactionsResult.rows[0].count);
        console.log(`   📊 Найдено транзакций: ${stats.transactions}`);

        if (stats.transactions > 0) {
            if (!DRY_RUN) {
                const deleteResult = await client.query(`
                    DELETE FROM kuliga_transactions 
                    WHERE booking_id IN (
                        SELECT id FROM kuliga_bookings 
                        WHERE (instructor_id = $1 OR group_training_id IN (
                            SELECT id FROM kuliga_group_trainings WHERE instructor_id = $1
                        ))
                        AND date < $2::date
                    )
                `, [INSTRUCTOR_ID, CLEANUP_DATE]);
                console.log(`   ✅ Удалено транзакций: ${deleteResult.rowCount}`);
            } else {
                console.log(`   ⚠️  Будут удалены ${stats.transactions} транзакций`);
            }
        }

        // 2. Проверка бронирований
        console.log('\n2️⃣ Проверка бронирований...');
        const bookingsResult = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_bookings 
            WHERE (instructor_id = $1 OR group_training_id IN (
                SELECT id FROM kuliga_group_trainings WHERE instructor_id = $1
            ))
            AND date < $2::date
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        stats.bookings = parseInt(bookingsResult.rows[0].count);
        console.log(`   📊 Найдено бронирований: ${stats.bookings}`);

        if (stats.bookings > 0) {
            if (!DRY_RUN) {
                const deleteResult = await client.query(`
                    DELETE FROM kuliga_bookings 
                    WHERE (instructor_id = $1 OR group_training_id IN (
                        SELECT id FROM kuliga_group_trainings WHERE instructor_id = $1
                    ))
                    AND date < $2::date
                `, [INSTRUCTOR_ID, CLEANUP_DATE]);
                console.log(`   ✅ Удалено бронирований: ${deleteResult.rowCount}`);
            } else {
                console.log(`   ⚠️  Будут удалены ${stats.bookings} бронирований`);
            }
        }

        // 3. Проверка групповых тренировок
        console.log('\n3️⃣ Проверка групповых тренировок...');
        const trainingsResult = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_group_trainings 
            WHERE instructor_id = $1
            AND date < $2::date
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        stats.groupTrainings = parseInt(trainingsResult.rows[0].count);
        console.log(`   📊 Найдено групповых тренировок: ${stats.groupTrainings}`);

        if (stats.groupTrainings > 0) {
            if (!DRY_RUN) {
                const deleteResult = await client.query(`
                    DELETE FROM kuliga_group_trainings 
                    WHERE instructor_id = $1
                    AND date < $2::date
                `, [INSTRUCTOR_ID, CLEANUP_DATE]);
                console.log(`   ✅ Удалено групповых тренировок: ${deleteResult.rowCount}`);
            } else {
                console.log(`   ⚠️  Будут удалены ${stats.groupTrainings} групповых тренировок`);
            }
        }

        // 4. Проверка слотов
        console.log('\n4️⃣ Проверка слотов расписания...');
        const slotsResult = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_schedule_slots 
            WHERE instructor_id = $1
            AND date < $2::date
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        stats.slots = parseInt(slotsResult.rows[0].count);
        console.log(`   📊 Найдено слотов: ${stats.slots}`);

        if (stats.slots > 0) {
            if (!DRY_RUN) {
                const deleteResult = await client.query(`
                    DELETE FROM kuliga_schedule_slots 
                    WHERE instructor_id = $1
                    AND date < $2::date
                `, [INSTRUCTOR_ID, CLEANUP_DATE]);
                console.log(`   ✅ Удалено слотов: ${deleteResult.rowCount}`);
            } else {
                console.log(`   ⚠️  Будут удалены ${stats.slots} слотов`);
            }
        }

        // 5. Проверка выплат (только pending)
        console.log('\n5️⃣ Проверка выплат (только неоплаченные)...');
        const payoutsResult = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_instructor_payouts 
            WHERE instructor_id = $1
            AND period_start < $2::date
            AND status = 'pending'
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        stats.payouts = parseInt(payoutsResult.rows[0].count);
        console.log(`   📊 Найдено неоплаченных выплат: ${stats.payouts}`);

        if (stats.payouts > 0) {
            if (!DRY_RUN) {
                const deleteResult = await client.query(`
                    DELETE FROM kuliga_instructor_payouts 
                    WHERE instructor_id = $1
                    AND period_start < $2::date
                    AND status = 'pending'
                `, [INSTRUCTOR_ID, CLEANUP_DATE]);
                console.log(`   ✅ Удалено выплат: ${deleteResult.rowCount}`);
            } else {
                console.log(`   ⚠️  Будут удалены ${stats.payouts} неоплаченных выплат`);
            }
        }

        // Итоговая статистика
        const total = stats.transactions + stats.bookings + stats.groupTrainings + stats.slots + stats.payouts;

        console.log('\n' + '='.repeat(60));
        console.log('📊 ИТОГОВАЯ СТАТИСТИКА');
        console.log('='.repeat(60));
        console.log(`   Транзакций: ${stats.transactions}`);
        console.log(`   Бронирований: ${stats.bookings}`);
        console.log(`   Групповых тренировок: ${stats.groupTrainings}`);
        console.log(`   Слотов: ${stats.slots}`);
        console.log(`   Выплат: ${stats.payouts}`);
        console.log(`   ─────────────────────────────────`);
        console.log(`   ВСЕГО записей: ${total}`);
        console.log('='.repeat(60));

        if (DRY_RUN) {
            await client.query('ROLLBACK');
            console.log('\n✅ DRY RUN завершен. Данные НЕ были удалены.');
            console.log('   Для реального удаления запустите:');
            console.log(`   CLEANUP_INSTRUCTOR_ID=${INSTRUCTOR_ID} CLEANUP_DATE=${CLEANUP_DATE} DRY_RUN=false node scripts/cleanup-test-kuliga-data.js`);
        } else {
            await client.query('COMMIT');
            console.log('\n✅ Очистка завершена успешно!');
            console.log(`   Удалено записей: ${total}`);
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Ошибка при очистке:', error.message);
        console.error(error.stack);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Запуск скрипта
cleanupTestData()
    .then(() => {
        console.log('\n✨ Скрипт завершен');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 Критическая ошибка:', error);
        process.exit(1);
    });

