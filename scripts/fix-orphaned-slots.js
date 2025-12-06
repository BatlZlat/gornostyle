/**
 * Скрипт для очистки "осиротевших" слотов со статусом 'group' без связанных тренировок
 * Запуск: node scripts/fix-orphaned-slots.js
 */

require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function fixOrphanedSlots() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('🔍 Поиск "осиротевших" слотов со статусом "group" без связанных тренировок...');

        // Находим все слоты со статусом 'group', у которых нет связанных тренировок
        const orphanedSlotsResult = await client.query(
            `SELECT kss.id, kss.instructor_id, kss.date, kss.start_time, kss.end_time, ki.full_name as instructor_name
             FROM kuliga_schedule_slots kss
             LEFT JOIN kuliga_group_trainings kgt ON kss.id = kgt.slot_id
             LEFT JOIN kuliga_instructors ki ON kss.instructor_id = ki.id
             WHERE kss.status = 'group'
               AND kgt.id IS NULL`
        );

        if (orphanedSlotsResult.rows.length === 0) {
            console.log('✅ "Осиротевших" слотов не найдено');
            await client.query('ROLLBACK');
            return;
        }

        console.log(`⚠️ Найдено ${orphanedSlotsResult.rows.length} "осиротевших" слотов:`);
        orphanedSlotsResult.rows.forEach(slot => {
            console.log(`  - ID=${slot.id}, Инструктор: ${slot.instructor_name || 'Не указан'}, Дата: ${slot.date}, Время: ${slot.start_time}-${slot.end_time}`);
        });

        // Освобождаем все найденные слоты
        const updateResult = await client.query(
            `UPDATE kuliga_schedule_slots 
             SET status = 'available', updated_at = CURRENT_TIMESTAMP 
             WHERE id = ANY($1) AND status = 'group'`,
            [orphanedSlotsResult.rows.map(s => s.id)]
        );

        await client.query('COMMIT');

        console.log(`✅ Освобождено ${updateResult.rowCount} слотов`);
        console.log('✅ Все "осиротевшие" слоты успешно очищены');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при очистке слотов:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Запускаем скрипт
fixOrphanedSlots()
    .then(() => {
        console.log('✅ Скрипт завершен успешно');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Ошибка выполнения скрипта:', error);
        process.exit(1);
    });

