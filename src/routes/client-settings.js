const express = require('express');
const router = express.Router();
const { 
    getClientSilentModeById, 
    updateClientSilentModeById,
    getClientWithSettings 
} = require('../services/silent-notification-helper');
const { pool } = require('../db');

/**
 * GET /api/clients/:id/settings
 * Получение настроек клиента
 */
router.get('/:id/settings', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'SELECT id, full_name, telegram_id, silent_notifications FROM clients WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        
        res.json({
            client: result.rows[0],
            settings: {
                silent_notifications: result.rows[0].silent_notifications || false
            }
        });
    } catch (error) {
        console.error('Ошибка при получении настроек клиента:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

/**
 * PUT /api/clients/:id/silent-notifications
 * Переключение беззвучного режима
 */
router.put('/:id/silent-notifications', async (req, res) => {
    try {
        const { id } = req.params;
        const { silent } = req.body;
        
        if (typeof silent !== 'boolean') {
            return res.status(400).json({ error: 'Параметр silent должен быть boolean' });
        }
        
        const success = await updateClientSilentModeById(parseInt(id), silent);
        
        if (!success) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        
        res.json({ 
            success: true, 
            silent_notifications: silent,
            message: silent ? 'Беззвучный режим включен' : 'Беззвучный режим выключен'
        });
    } catch (error) {
        console.error('Ошибка при обновлении настроек беззвучного режима:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

/**
 * GET /api/clients/by-telegram/:telegramId/settings
 * Получение настроек клиента по Telegram ID
 */
router.get('/by-telegram/:telegramId/settings', async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        const client = await getClientWithSettings(telegramId);
        
        if (!client) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        
        res.json({
            client: client,
            settings: {
                silent_notifications: client.silent_notifications || false
            }
        });
    } catch (error) {
        console.error('Ошибка при получении настроек клиента:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;

