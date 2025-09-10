const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { notifyAdminWalletRefilled } = require('../bot/admin-notify');
const TelegramBot = require('node-telegram-bot-api');

// Создаем экземпляр клиентского бота для уведомлений
const clientBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Функция генерации уникального 6-значного номера сертификата
async function generateUniqueCertificateNumber() {
    let number;
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 50) {
        number = Math.floor(100000 + Math.random() * 900000).toString();
        
        const result = await pool.query(
            'SELECT id FROM certificates WHERE certificate_number = $1',
            [number]
        );
        
        isUnique = result.rows.length === 0;
        attempts++;
    }
    
    if (!isUnique) {
        throw new Error('Не удалось сгенерировать уникальный номер сертификата');
    }
    
    return number;
}

// 1. Создание (покупка) сертификата
router.post('/purchase', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { 
            purchaser_id,
            nominal_value, 
            design_id, 
            recipient_name, 
            recipient_phone, 
            message 
        } = req.body;

        // Валидация входных данных
        if (!purchaser_id || !nominal_value || !design_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указаны обязательные поля: purchaser_id, nominal_value, design_id',
                code: 'INVALID_REQUEST'
            });
        }

        if (nominal_value < 500 || nominal_value > 50000) {
            return res.status(400).json({
                success: false,
                error: 'Номинал должен быть от 500 до 50 000 руб.',
                code: 'INVALID_NOMINAL'
            });
        }

        await client.query('BEGIN');

        // Проверяем существование покупателя и его кошелька
        const purchaserQuery = `
            SELECT c.id, c.full_name, c.telegram_id, w.id as wallet_id, w.balance, w.wallet_number
            FROM clients c
            LEFT JOIN wallets w ON c.id = w.client_id
            WHERE c.id = $1
        `;
        const purchaserResult = await client.query(purchaserQuery, [purchaser_id]);
        
        if (purchaserResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Покупатель не найден',
                code: 'PURCHASER_NOT_FOUND'
            });
        }

        const purchaser = purchaserResult.rows[0];

        // Проверяем существование кошелька
        if (!purchaser.wallet_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'У покупателя нет кошелька',
                code: 'WALLET_NOT_FOUND'
            });
        }

        // Проверяем баланс
        if (parseFloat(purchaser.balance) < nominal_value) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Недостаточно средств на кошельке',
                code: 'INSUFFICIENT_FUNDS'
            });
        }

        // Проверяем существование дизайна
        const designResult = await client.query(
            'SELECT id, name FROM certificate_designs WHERE id = $1 AND is_active = true',
            [design_id]
        );
        
        if (designResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Дизайн сертификата не найден или неактивен',
                code: 'INVALID_DESIGN'
            });
        }

        // Генерируем уникальный номер сертификата
        const certificateNumber = await generateUniqueCertificateNumber();

        // Создаем сертификат
        const certificateQuery = `
            INSERT INTO certificates (
                certificate_number, purchaser_id, recipient_name, recipient_phone,
                nominal_value, design_id, status, expiry_date, activation_date,
                message, purchase_date, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `;

        // Вычисляем дату истечения (1 год от текущего момента)
        const now = new Date();
        const expiryDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // +1 год в миллисекундах

        const certificateResult = await client.query(certificateQuery, [
            certificateNumber,
            purchaser_id,
            recipient_name || null,
            recipient_phone || null,
            nominal_value,
            design_id,
            'active',
            expiryDate,
            null, // activation_date
            message || null,
            now // purchase_date
        ]);

        const certificate = certificateResult.rows[0];

        // Списываем средства с кошелька
        await client.query(
            'UPDATE wallets SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
            [nominal_value, purchaser.wallet_id]
        );

        // Создаем запись о транзакции
        const transactionDescription = `Покупка сертификата №${certificateNumber} - ${purchaser.full_name}`;
        await client.query(
            `INSERT INTO transactions (wallet_id, amount, type, description, created_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
            [purchaser.wallet_id, -nominal_value, 'payment', transactionDescription]
        );

        await client.query('COMMIT');

        // Формируем URL сертификата
        const certificateUrl = `${process.env.BASE_URL || 'https://gornostyle72.ru'}/certificate/${certificateNumber}`;

        // Ответ клиенту
        res.status(201).json({
            success: true,
            message: 'Сертификат успешно создан',
            certificate: {
                id: certificate.id,
                certificate_number: certificateNumber,
                nominal_value: parseFloat(certificate.nominal_value),
                design_id: certificate.design_id,
                recipient_name: certificate.recipient_name,
                recipient_phone: certificate.recipient_phone,
                message: certificate.message,
                status: certificate.status,
                expiry_date: certificate.expiry_date,
                purchase_date: certificate.purchase_date,
                certificate_url: certificateUrl
            }
        });

        // Отправляем уведомление администратору (асинхронно)
        setImmediate(async () => {
            try {
                await notifyAdminWalletRefilled({
                    clientName: purchaser.full_name,
                    amount: -nominal_value,
                    walletNumber: purchaser.wallet_number,
                    balance: parseFloat(purchaser.balance) - nominal_value,
                    isRefill: false,
                    transactionType: `Покупка сертификата №${certificateNumber}`
                });
            } catch (notifyError) {
                console.error('Ошибка отправки уведомления администратору:', notifyError);
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании сертификата:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    } finally {
        client.release();
    }
});

// 2. Активация сертификата
router.post('/activate', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { certificate_number, client_id } = req.body;

        // Валидация входных данных
        if (!certificate_number || !client_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указаны обязательные поля: certificate_number, client_id',
                code: 'INVALID_REQUEST'
            });
        }

        await client.query('BEGIN');

        // Проверяем существование сертификата
        const certificateQuery = `
            SELECT c.*, cd.name as design_name, cl.full_name as purchaser_name
            FROM certificates c
            JOIN certificate_designs cd ON c.design_id = cd.id
            LEFT JOIN clients cl ON c.purchaser_id = cl.id
            WHERE c.certificate_number = $1
        `;
        const certificateResult = await client.query(certificateQuery, [certificate_number]);
        
        if (certificateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Сертификат не найден',
                code: 'CERTIFICATE_NOT_FOUND'
            });
        }

        const certificate = certificateResult.rows[0];

        // Проверяем статус сертификата
        if (certificate.status !== 'active') {
            await client.query('ROLLBACK');
            let errorMessage = 'Сертификат недоступен для активации';
            let errorCode = 'INVALID_STATUS';
            
            if (certificate.status === 'used') {
                errorMessage = 'Сертификат уже активирован';
                errorCode = 'ALREADY_ACTIVATED';
            } else if (certificate.status === 'expired') {
                errorMessage = 'Срок действия сертификата истек';
                errorCode = 'EXPIRED';
            }
            
            return res.status(400).json({
                success: false,
                error: errorMessage,
                code: errorCode
            });
        }

        // Проверяем срок действия
        const now = new Date();
        if (new Date(certificate.expiry_date) <= now) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Срок действия сертификата истек',
                code: 'EXPIRED'
            });
        }

        // Проверяем существование клиента и его кошелька
        const clientQuery = `
            SELECT c.id, c.full_name, c.telegram_id, w.id as wallet_id, w.balance, w.wallet_number
            FROM clients c
            LEFT JOIN wallets w ON c.id = w.client_id
            WHERE c.id = $1
        `;
        const clientResult = await client.query(clientQuery, [client_id]);
        
        if (clientResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Клиент не найден',
                code: 'CLIENT_NOT_FOUND'
            });
        }

        const clientData = clientResult.rows[0];

        // Создаем кошелек если его нет
        let walletId = clientData.wallet_id;
        let currentBalance = parseFloat(clientData.balance) || 0;

        if (!walletId) {
            // Генерируем уникальный номер кошелька
            let walletNumber;
            let isUnique = false;
            let attempts = 0;
            
            while (!isUnique && attempts < 10) {
                walletNumber = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
                const checkResult = await client.query('SELECT id FROM wallets WHERE wallet_number = $1', [walletNumber]);
                isUnique = checkResult.rows.length === 0;
                attempts++;
            }
            
            if (!isUnique) {
                await client.query('ROLLBACK');
                return res.status(500).json({
                    success: false,
                    error: 'Не удалось создать кошелек',
                    code: 'WALLET_CREATION_ERROR'
                });
            }
            
            const createWalletResult = await client.query(
                'INSERT INTO wallets (client_id, balance, wallet_number, last_updated) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING id',
                [client_id, certificate.nominal_value, walletNumber]
            );
            walletId = createWalletResult.rows[0].id;
            currentBalance = 0;
        } else {
            // Зачисляем средства на существующий кошелек
            await client.query(
                'UPDATE wallets SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
                [certificate.nominal_value, walletId]
            );
        }

        // Активируем сертификат
        const activationDate = new Date();
        await client.query(
            `UPDATE certificates 
             SET status = 'used', activated_by_id = $1, activation_date = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [client_id, activationDate, certificate.id]
        );

        // Создаем запись о транзакции
        const transactionDescription = `Активация сертификата №${certificate_number} - ${clientData.full_name}`;
        await client.query(
            `INSERT INTO transactions (wallet_id, amount, type, description, created_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
            [walletId, certificate.nominal_value, 'refill', transactionDescription]
        );

        const newBalance = currentBalance + parseFloat(certificate.nominal_value);

        await client.query('COMMIT');

        // Ответ клиенту
        res.json({
            success: true,
            message: 'Сертификат успешно активирован',
            certificate: {
                id: certificate.id,
                certificate_number: certificate.certificate_number,
                nominal_value: parseFloat(certificate.nominal_value),
                status: 'used',
                activation_date: activationDate
            },
            wallet: {
                balance: newBalance,
                amount_added: parseFloat(certificate.nominal_value)
            }
        });

        // Отправляем уведомление клиенту (асинхронно)
        if (clientData.telegram_id) {
            setImmediate(async () => {
                try {
                    const message = `
🎉 <b>Поздравляем!</b>
Сертификат успешно активирован!

💳 <b>Номер сертификата:</b> ${certificate_number}
💰 <b>Номинал:</b> ${certificate.nominal_value} руб.
💵 <b>Новый баланс:</b> ${newBalance} руб.

Теперь вы можете записаться на тренировки! 🎿`;

                    await clientBot.sendMessage(clientData.telegram_id, message, { 
                        parse_mode: 'HTML' 
                    });
                } catch (notifyError) {
                    console.error('Ошибка отправки уведомления клиенту:', notifyError);
                }
            });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при активации сертификата:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    } finally {
        client.release();
    }
});

// 3. Получение дизайнов сертификатов
router.get('/designs', async (req, res) => {
    try {
        const query = `
            SELECT id, name, description, image_url, template_url, is_active, sort_order
            FROM certificate_designs
            WHERE is_active = true
            ORDER BY sort_order ASC, name ASC
        `;

        const result = await pool.query(query);

        res.json({
            success: true,
            designs: result.rows.map(design => ({
                id: design.id,
                name: design.name,
                description: design.description,
                image_url: design.image_url,
                template_url: design.template_url,
                is_active: design.is_active,
                sort_order: design.sort_order
            }))
        });

    } catch (error) {
        console.error('Ошибка при получении дизайнов сертификатов:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

// 4. Получение информации о сертификате
router.get('/:number', async (req, res) => {
    try {
        const { number } = req.params;

        if (!number || !/^[0-9]{6}$/.test(number)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный формат номера сертификата',
                code: 'INVALID_NUMBER_FORMAT'
            });
        }

        const query = `
            SELECT 
                c.*,
                cd.name as design_name,
                cd.image_url as design_image,
                cd.template_url as design_template,
                cl1.full_name as purchaser_name,
                cl2.full_name as activated_by_name
            FROM certificates c
            JOIN certificate_designs cd ON c.design_id = cd.id
            LEFT JOIN clients cl1 ON c.purchaser_id = cl1.id
            LEFT JOIN clients cl2 ON c.activated_by_id = cl2.id
            WHERE c.certificate_number = $1
        `;

        const result = await pool.query(query, [number]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Сертификат не найден',
                code: 'CERTIFICATE_NOT_FOUND'
            });
        }

        const certificate = result.rows[0];

        res.json({
            success: true,
            certificate: {
                id: certificate.id,
                certificate_number: certificate.certificate_number,
                nominal_value: parseFloat(certificate.nominal_value),
                design: {
                    id: certificate.design_id,
                    name: certificate.design_name,
                    image_url: certificate.design_image,
                    template_url: certificate.design_template
                },
                status: certificate.status,
                expiry_date: certificate.expiry_date,
                purchase_date: certificate.purchase_date,
                purchaser: certificate.purchaser_name ? {
                    name: certificate.purchaser_name
                } : null,
                recipient_name: certificate.recipient_name,
                recipient_phone: certificate.recipient_phone,
                message: certificate.message,
                activated_by: certificate.activated_by_name ? {
                    name: certificate.activated_by_name
                } : null,
                activation_date: certificate.activation_date
            }
        });

    } catch (error) {
        console.error('Ошибка при получении информации о сертификате:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

// 4. Получение сертификатов клиента
router.get('/client/:client_id', async (req, res) => {
    try {
        const { client_id } = req.params;
        const { status, limit = 50, offset = 0 } = req.query;

        // Валидация параметров
        if (!client_id || isNaN(parseInt(client_id))) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID клиента',
                code: 'INVALID_CLIENT_ID'
            });
        }

        let whereClause = 'WHERE (c.purchaser_id = $1 OR c.activated_by_id = $1)';
        let queryParams = [client_id];

        if (status && ['active', 'used', 'expired', 'cancelled'].includes(status)) {
            whereClause += ' AND c.status = $2';
            queryParams.push(status);
        }

        const query = `
            SELECT 
                c.id,
                c.certificate_number,
                c.nominal_value,
                c.status,
                c.purchase_date,
                c.activation_date,
                c.recipient_name,
                cd.id as design_id,
                cd.name as design_name,
                CASE 
                    WHEN c.purchaser_id = $1 THEN 'purchased'
                    ELSE 'activated'
                END as relationship_type
            FROM certificates c
            JOIN certificate_designs cd ON c.design_id = cd.id
            ${whereClause}
            ORDER BY 
                CASE WHEN c.purchaser_id = $1 THEN c.purchase_date ELSE c.activation_date END DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        queryParams.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, queryParams);

        // Получаем общее количество записей
        const countQuery = `
            SELECT COUNT(*) as total
            FROM certificates c
            ${whereClause}
        `;

        const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
        const total = parseInt(countResult.rows[0].total);

        res.json({
            success: true,
            certificates: result.rows.map(cert => ({
                id: cert.id,
                certificate_number: cert.certificate_number,
                nominal_value: parseFloat(cert.nominal_value),
                design: {
                    id: cert.design_id,
                    name: cert.design_name
                },
                status: cert.status,
                purchase_date: cert.purchase_date,
                activation_date: cert.activation_date,
                recipient_name: cert.recipient_name,
                relationship_type: cert.relationship_type
            })),
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                has_more: (parseInt(offset) + parseInt(limit)) < total
            }
        });

    } catch (error) {
        console.error('Ошибка при получении сертификатов клиента:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

// 6. Получение статистики сертификатов (для админа)
router.get('/admin/statistics', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        let whereClause = '';
        let queryParams = [];

        if (start_date && end_date) {
            whereClause = 'WHERE c.purchase_date BETWEEN $1 AND $2';
            queryParams = [start_date, end_date];
        }

        // Основная статистика
        const statsQuery = `
            SELECT 
                COUNT(*) as total_certificates,
                SUM(c.nominal_value) as total_value,
                COUNT(CASE WHEN c.status = 'active' THEN 1 END) as active_certificates,
                COUNT(CASE WHEN c.status = 'used' THEN 1 END) as used_certificates,
                COUNT(CASE WHEN c.status = 'expired' THEN 1 END) as expired_certificates,
                AVG(c.nominal_value) as average_nominal,
                CASE 
                    WHEN COUNT(*) > 0 THEN 
                        ROUND((COUNT(CASE WHEN c.status = 'used' THEN 1 END) * 100.0 / COUNT(*)), 2)
                    ELSE 0 
                END as activation_rate
            FROM certificates c
            ${whereClause}
        `;

        const statsResult = await pool.query(statsQuery, queryParams);
        const stats = statsResult.rows[0];

        // Популярные номиналы
        const nominalsQuery = `
            SELECT 
                c.nominal_value as nominal,
                COUNT(*) as count
            FROM certificates c
            ${whereClause}
            GROUP BY c.nominal_value
            ORDER BY count DESC
            LIMIT 10
        `;

        const nominalsResult = await pool.query(nominalsQuery, queryParams);

        // Популярные дизайны
        const designsQuery = `
            SELECT 
                cd.id as design_id,
                cd.name as design_name,
                COUNT(*) as count
            FROM certificates c
            JOIN certificate_designs cd ON c.design_id = cd.id
            ${whereClause}
            GROUP BY cd.id, cd.name
            ORDER BY count DESC
        `;

        const designsResult = await pool.query(designsQuery, queryParams);

        res.json({
            success: true,
            statistics: {
                total_certificates: parseInt(stats.total_certificates),
                total_value: parseFloat(stats.total_value) || 0,
                active_certificates: parseInt(stats.active_certificates),
                used_certificates: parseInt(stats.used_certificates),
                expired_certificates: parseInt(stats.expired_certificates),
                average_nominal: parseFloat(stats.average_nominal) || 0,
                popular_nominals: nominalsResult.rows.map(row => ({
                    nominal: parseFloat(row.nominal),
                    count: parseInt(row.count)
                })),
                popular_designs: designsResult.rows.map(row => ({
                    design_id: row.design_id,
                    design_name: row.design_name,
                    count: parseInt(row.count)
                })),
                activation_rate: parseFloat(stats.activation_rate)
            }
        });

    } catch (error) {
        console.error('Ошибка при получении статистики сертификатов:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

module.exports = router;
