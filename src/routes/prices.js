const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { verifyToken } = require('../middleware/auth');

// Получение прайса
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                type,
                with_trainer,
                duration,
                participants,
                price
            FROM prices
            ORDER BY 
                type,
                with_trainer,
                duration,
                participants
        `);
        // Формируем объект с ключами для фронта
        const pricesObj = {};
        result.rows.forEach(row => {
            const key = `${row.type}_${row.with_trainer ? 'true' : 'false'}_${row.duration}_${row.participants}`;
            pricesObj[key] = Number(row.price);
        });
        res.json(pricesObj);
    } catch (error) {
        console.error('Ошибка при получении прайса:', error);
        res.status(500).json({ error: 'Ошибка при получении прайса' });
    }
});

// Обновление прайса (защищённый маршрут)
router.put('/', verifyToken, async (req, res) => {
    try {
        const prices = req.body; // ожидается объект: { [ключ]: значение }
        for (const key in prices) {
            const parts = key.split('_');
            if (parts.length !== 4) {
                console.warn('Некорректный ключ прайса:', key);
                continue;
            }
            const [type, with_trainer, duration, participants] = parts;
            const numDuration = Number(duration);
            const numParticipants = Number(participants);
            const boolWithTrainer = with_trainer === 'true' || with_trainer === true;
            if (isNaN(numDuration) || isNaN(numParticipants)) {
                console.warn('Некорректные параметры для UPDATE:', { key, duration, participants });
                continue;
            }
            console.log('Обновление прайса:', { type, boolWithTrainer, numDuration, numParticipants, price: prices[key] });
            await pool.query(
                `UPDATE prices SET price = $1 WHERE type = $2 AND with_trainer = $3 AND duration = $4 AND participants = $5`,
                [prices[key], type, boolWithTrainer, numDuration, numParticipants]
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка при обновлении прайса:', error);
        res.status(500).json({ error: 'Ошибка при обновлении прайса' });
    }
});

module.exports = router; 