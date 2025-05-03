require('dotenv').config();
const { pool } = require('../db/index');

async function createSimulators() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Создаем тренажеры с фиксированными ID
        const simulators = [
            { id: 1, name: 'Тренажер 1' },
            { id: 2, name: 'Тренажер 2' }
        ];

        for (const simulator of simulators) {
            try {
                await client.query(
                    'INSERT INTO simulators (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
                    [simulator.id, simulator.name]
                );
                console.log(`Создан тренажер: ${simulator.name} (ID: ${simulator.id})`);
            } catch (error) {
                console.error('Ошибка при создании тренажера:', error);
                throw error;
            }
        }

        await client.query('COMMIT');
        console.log('Тренажеры успешно созданы');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании тренажеров:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Запускаем создание тренажеров
createSimulators().catch(console.error); 