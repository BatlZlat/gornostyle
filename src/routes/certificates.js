const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { notifyAdminCertificatePurchase, notifyAdminCertificateActivation } = require('../bot/admin-notify');
const { verifyToken } = require('../middleware/auth');
const TelegramBot = require('node-telegram-bot-api');
const certificateImageGenerator = require('../services/certificateImageGenerator');
const EmailService = require('../services/emailService');
const emailService = new EmailService();

// Создаем экземпляр клиентского бота для уведомлений
const clientBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Функция генерации уникального номера кошелька (из client-bot.js)
async function generateUniqueWalletNumber() {
    const generateNumber = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
    let walletNumber, isUnique = false, attempts = 0;
    while (!isUnique && attempts < 10) {
        walletNumber = generateNumber();
        const result = await pool.query('SELECT COUNT(*) FROM wallets WHERE wallet_number = $1', [walletNumber]);
        if (result.rows[0].count === '0') isUnique = true;
        attempts++;
    }
    if (!isUnique) throw new Error('Не удалось сгенерировать уникальный номер кошелька');
    return walletNumber;
}

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
    console.log('📦 [certificates/purchase] Получен запрос на покупку сертификата');
    console.log('📦 [certificates/purchase] Тело запроса:', {
        purchaser_id: req.body.purchaser_id,
        nominal_value: req.body.nominal_value,
        design_id: req.body.design_id,
        recipient_name: req.body.recipient_name ? req.body.recipient_name.substring(0, 50) : null,
        message: req.body.message ? req.body.message.substring(0, 50) : null
    });
    
    const client = await pool.connect();
    
    try {
        const { 
            purchaser_id,
            nominal_value, 
            design_id, 
            recipient_name, 
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
            SELECT c.id, c.full_name, c.email, c.telegram_id, w.id as wallet_id, w.balance, w.wallet_number
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
                certificate_number, purchaser_id, recipient_name,
                nominal_value, design_id, status, expiry_date, activation_date,
                message, purchase_date, pdf_url, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `;

        // Вычисляем дату истечения (1 год от текущего момента)
        const now = new Date();
        const expiryDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // +1 год в миллисекундах

        // Генерируем только PDF сертификата
        let pdfUrl = null;
        
        try {
            const certificateJpgGenerator = require('../services/certificateJpgGenerator');
            
            // Данные для генерации файлов
            const certificateData = {
                certificate_number: certificateNumber,
                nominal_value: nominal_value,
                recipient_name: recipient_name,
                message: message,
                expiry_date: expiryDate,
                design_id: design_id
            };
            
            // Генерируем JPG из веб-страницы сертификата
            try {
                const jpgResult = await certificateJpgGenerator.generateCertificateJpgForEmail(certificateNumber);
                pdfUrl = jpgResult.jpg_url; // Используем только JPG
                console.log(`✅ JPG сертификат создан: ${pdfUrl}`);
            } catch (jpgError) {
                console.error('Ошибка при генерации JPG сертификата:', jpgError);
                throw jpgError; // Не используем fallback на PDF
            }
            
        } catch (fileError) {
            console.error('Ошибка при генерации файлов сертификата:', fileError);
            // Продолжаем без файлов
        }

        const certificateResult = await client.query(certificateQuery, [
            certificateNumber,
            purchaser_id,
            recipient_name || null,
            nominal_value,
            design_id,
            'active',
            expiryDate,
            null, // activation_date
            message || null,
            now, // purchase_date
            pdfUrl // pdf_url
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
            [purchaser.wallet_id, nominal_value, 'payment', transactionDescription]
        );

        await client.query('COMMIT');
        
        console.log('✅ [certificates/purchase] Сертификат успешно создан:', {
            id: certificate.id,
            certificate_number: certificateNumber,
            purchaser_id: purchaser_id,
            email: purchaser.email
        });

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
                expiry_date: certificate.expiry_date.toISOString(),
                purchase_date: certificate.purchase_date.toISOString(),
                certificate_url: certificateUrl,
                pdf_url: certificate.pdf_url,
                image_url: certificate.image_url,
                print_image_url: certificate.image_url // Для обратной совместимости
            }
        });

        // Отправляем email с сертификатом (асинхронно)
        if (purchaser.email) {
            setImmediate(async () => {
                try {
                    console.log(`📧 Отправка email с сертификатом на: ${purchaser.email}`);
                    
                    // Получаем данные дизайна
                    const designQuery = await pool.query(
                        'SELECT name FROM certificate_designs WHERE id = $1',
                        [design_id]
                    );
                    const designName = designQuery.rows[0]?.name || 'Неизвестный дизайн';
                    
                    // Подготавливаем данные для email
                    const certificateData = {
                        certificateId: certificate.id,
                        certificateCode: certificateNumber,
                        recipientName: recipient_name || purchaser.full_name,
                        amount: nominal_value,
                        message: message || null,
                        pdfUrl: certificate.pdf_url,
                        imageUrl: certificate.image_url,
                        expiry_date: expiryDate.toISOString(),
                        designImageUrl: null, // Можно добавить если нужно
                        certificate_url: certificateUrl
                    };
                    
                    const emailResult = await emailService.sendCertificateEmail(purchaser.email, certificateData);
                    
                    if (emailResult.success) {
                        console.log(`✅ Email с сертификатом успешно отправлен на ${purchaser.email}`);
                    } else {
                        console.error(`❌ Ошибка отправки email на ${purchaser.email}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error('❌ Ошибка при отправке email с сертификатом:', emailError);
                }
            });
        } else {
            console.log(`⚠️  Email не указан для покупателя ${purchaser.full_name}, отправка email пропущена`);
        }

        // Отправляем уведомление администратору (асинхронно)
        setImmediate(async () => {
            try {
                await notifyAdminCertificatePurchase({
                    clientName: purchaser.full_name,
                    certificateNumber: certificateNumber,
                    nominalValue: nominal_value,
                    purchaseDate: now
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
            [walletId, -certificate.nominal_value, 'payment', transactionDescription]
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

        // Отправляем уведомления (асинхронно)
        setImmediate(async () => {
            try {
                // Уведомление клиенту
                if (clientData.telegram_id) {
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
                }

                // Уведомление администратору
                await notifyAdminCertificateActivation({
                    clientName: clientData.full_name,
                    certificateNumber: certificate_number,
                    nominalValue: certificate.nominal_value,
                    activationDate: activationDate
                });
            } catch (notifyError) {
                console.error('Ошибка отправки уведомлений:', notifyError);
            }
        });

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

// ============ АДМИНСКИЕ МАРШРУТЫ ============
// Все админские маршруты защищены авторизацией
// Используем префикс /admin/ для избежания конфликтов

// ADM-1. Получение списка сертификатов с фильтрами (для админа)
router.get('/admin/list', verifyToken, async (req, res) => {
    try {
        const {
            status,           // active|used|expired|cancelled
            search,           // поиск по номеру, имени, телефону
            start_date,       // фильтр по дате покупки (от)
            end_date,         // фильтр по дате покупки (до)
            min_value,        // минимальный номинал
            max_value,        // максимальный номинал
            design_id,        // фильтр по дизайну
            expiring_soon,    // только истекающие в течение 7 дней (boolean)
            sort = 'purchase_date',  // поле сортировки
            order = 'DESC',   // порядок сортировки (ASC|DESC)
            limit = 50,       // количество записей на странице
            offset = 0        // смещение для пагинации
        } = req.query;

        // Построение WHERE условий
        const conditions = [];
        const queryParams = [];
        let paramIndex = 1;

        // Фильтр по статусу
        if (status && ['active', 'used', 'expired', 'cancelled'].includes(status)) {
            conditions.push(`c.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }

        // Фильтр по дате покупки
        if (start_date) {
            conditions.push(`c.purchase_date >= $${paramIndex}::date`);
            queryParams.push(start_date);
            paramIndex++;
        }
        if (end_date) {
            conditions.push(`c.purchase_date <= $${paramIndex}::date`);
            queryParams.push(end_date);
            paramIndex++;
        }

        // Фильтр по номиналу
        if (min_value) {
            conditions.push(`c.nominal_value >= $${paramIndex}`);
            queryParams.push(parseFloat(min_value));
            paramIndex++;
        }
        if (max_value) {
            conditions.push(`c.nominal_value <= $${paramIndex}`);
            queryParams.push(parseFloat(max_value));
            paramIndex++;
        }

        // Фильтр по дизайну
        if (design_id) {
            conditions.push(`c.design_id = $${paramIndex}`);
            queryParams.push(parseInt(design_id));
            paramIndex++;
        }

        // Поиск по номеру, имени, телефону
        if (search) {
            const searchCondition = `(
                c.certificate_number ILIKE $${paramIndex} OR
                c.recipient_name ILIKE $${paramIndex} OR
                cl.full_name ILIKE $${paramIndex} OR
                cl.phone ILIKE $${paramIndex}
            )`;
            conditions.push(searchCondition);
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        // Фильтр "истекающие скоро" (в течение 7 дней)
        if (expiring_soon === 'true' || expiring_soon === true) {
            conditions.push(`c.status = 'active' AND c.expiry_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Валидация параметров сортировки
        const allowedSortFields = {
            'purchase_date': 'c.purchase_date',
            'expiry_date': 'c.expiry_date',
            'nominal_value': 'c.nominal_value',
            'activation_date': 'c.activation_date',
            'certificate_number': 'c.certificate_number'
        };
        const sortField = allowedSortFields[sort] || allowedSortFields['purchase_date'];
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Подсчет общего количества
        const countQuery = `
            SELECT COUNT(*) as total
            FROM certificates c
            LEFT JOIN clients cl ON c.purchaser_id = cl.id
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total);

        // Основной запрос для получения сертификатов
        const certificatesQuery = `
            SELECT 
                c.id,
                c.certificate_number,
                c.recipient_name,
                c.nominal_value,
                c.status,
                c.purchase_date,
                c.expiry_date,
                c.activation_date,
                c.message,
                c.pdf_url,
                c.image_url,
                c.created_at,
                c.updated_at,
                c.design_id,
                cd.name as design_name,
                cl.id as purchaser_id,
                cl.full_name as purchaser_name,
                cl.phone as purchaser_phone,
                cl.email as purchaser_email,
                ca.id as activated_by_id,
                ca.full_name as activated_by_name,
                CASE 
                    WHEN c.expiry_date > NOW() THEN EXTRACT(DAY FROM (c.expiry_date - NOW()))
                    ELSE 0
                END as days_until_expiry
            FROM certificates c
            LEFT JOIN clients cl ON c.purchaser_id = cl.id
            LEFT JOIN clients ca ON c.activated_by_id = ca.id
            LEFT JOIN certificate_designs cd ON c.design_id = cd.id
            ${whereClause}
            ORDER BY ${sortField} ${sortOrder}
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        queryParams.push(parseInt(limit));
        queryParams.push(parseInt(offset));

        const certificatesResult = await pool.query(certificatesQuery, queryParams);
        const certificates = certificatesResult.rows.map(cert => ({
            id: cert.id,
            certificate_number: cert.certificate_number,
            purchaser: cert.purchaser_id ? {
                id: cert.purchaser_id,
                full_name: cert.purchaser_name,
                phone: cert.purchaser_phone,
                email: cert.purchaser_email
            } : null,
            recipient_name: cert.recipient_name,
            nominal_value: parseFloat(cert.nominal_value),
            design: {
                id: cert.design_id,
                name: cert.design_name
            },
            status: cert.status,
            purchase_date: cert.purchase_date.toISOString(),
            expiry_date: cert.expiry_date.toISOString(),
            days_until_expiry: parseInt(cert.days_until_expiry) || 0,
            activated_by: cert.activated_by_id ? {
                id: cert.activated_by_id,
                full_name: cert.activated_by_name
            } : null,
            activation_date: cert.activation_date ? cert.activation_date.toISOString() : null,
            message: cert.message,
            pdf_url: cert.pdf_url,
            image_url: cert.image_url,
            created_at: cert.created_at.toISOString(),
            updated_at: cert.updated_at.toISOString()
        }));

        const totalPages = Math.ceil(total / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        res.json({
            success: true,
            certificates: certificates,
            pagination: {
                total: total,
                page: currentPage,
                limit: parseInt(limit),
                total_pages: totalPages,
                has_next: currentPage < totalPages,
                has_prev: currentPage > 1
            }
        });

    } catch (error) {
        console.error('Ошибка при получении списка сертификатов:', error);
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
const getUserCertificatesHandler = async (req, res) => {
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
};

// Регистрируем маршруты для получения сертификатов клиента
router.get('/client/:client_id', getUserCertificatesHandler);
router.get('/user/:client_id', getUserCertificatesHandler);

// 5. Проверка статуса оплаты сертификата
router.get('/check-payment-status', async (req, res) => {
    try {
        const { clientId, amount } = req.query;
        
        if (!clientId || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Отсутствуют обязательные параметры',
                code: 'MISSING_PARAMETERS'
            });
        }

        // Проверяем, создан ли сертификат для данного клиента за последние 30 минут
        const query = `
            SELECT c.id, c.certificate_number, c.nominal_value, c.status, c.created_at
            FROM certificates c
            WHERE c.purchaser_id = $1 
            AND c.nominal_value = $2
            AND c.created_at >= NOW() - INTERVAL '30 minutes'
            ORDER BY c.created_at DESC
            LIMIT 1
        `;

        const result = await pool.query(query, [clientId, amount]);

        if (result.rows.length > 0) {
            const certificate = result.rows[0];
            return res.json({
                success: true,
                certificateCreated: true,
                certificate: {
                    id: certificate.id,
                    certificate_number: certificate.certificate_number,
                    nominal_value: parseFloat(certificate.nominal_value),
                    status: certificate.status,
                    created_at: certificate.created_at
                }
            });
        } else {
            return res.json({
                success: true,
                certificateCreated: false
            });
        }

    } catch (error) {
        console.error('Ошибка при проверке статуса оплаты:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

// 6. Получение статистики сертификатов (для админа) - РАСШИРЕННАЯ ВЕРСИЯ
router.get('/admin/statistics', verifyToken, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        let whereClause = '';
        let queryParams = [];
        let paramIndex = 1;

        if (start_date && end_date) {
            whereClause = 'WHERE c.purchase_date BETWEEN $1 AND $2';
            queryParams = [start_date, end_date];
            paramIndex = 3;
        }

        // Основная статистика
        const statsQuery = `
            SELECT 
                COUNT(*) as total_certificates,
                SUM(c.nominal_value) as total_value,
                COUNT(CASE WHEN c.status = 'active' THEN 1 END) as active_certificates,
                COUNT(CASE WHEN c.status = 'used' THEN 1 END) as used_certificates,
                COUNT(CASE WHEN c.status = 'expired' THEN 1 END) as expired_certificates,
                COUNT(CASE WHEN c.status = 'cancelled' THEN 1 END) as cancelled_certificates,
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

        // Истекающие скоро (в течение 7 дней)
        const expiringSoonQuery = `
            SELECT COUNT(*) as count
            FROM certificates c
            ${whereClause ? whereClause + ' AND' : 'WHERE'}
            c.status = 'active' AND c.expiry_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        `;
        const expiringSoonResult = await pool.query(expiringSoonQuery, queryParams);
        const expiringSoonCount = parseInt(expiringSoonResult.rows[0].count);

        // Неактивированные сертификаты старше 30 дней
        const notActivated30DaysQuery = `
            SELECT COUNT(*) as count
            FROM certificates c
            ${whereClause ? whereClause + ' AND' : 'WHERE'}
            c.status = 'active' AND c.purchase_date < NOW() - INTERVAL '30 days'
        `;
        const notActivated30DaysResult = await pool.query(notActivated30DaysQuery, queryParams);
        const notActivated30DaysCount = parseInt(notActivated30DaysResult.rows[0].count);

        // Среднее время до активации (в днях)
        const avgActivationTimeQuery = `
            SELECT 
                AVG(EXTRACT(EPOCH FROM (c.activation_date - c.purchase_date)) / 86400) as avg_days
            FROM certificates c
            ${whereClause ? whereClause + ' AND' : 'WHERE'}
            c.status = 'used' AND c.activation_date IS NOT NULL
        `;
        const avgActivationTimeResult = await pool.query(avgActivationTimeQuery, queryParams);
        const averageTimeToActivationDays = parseFloat(avgActivationTimeResult.rows[0].avg_days) || 0;

        // Конверсия (процент активации от всех не истекших)
        const conversionQuery = `
            SELECT 
                COUNT(CASE WHEN c.status = 'used' THEN 1 END) as used_count,
                COUNT(CASE WHEN c.status IN ('active', 'used') THEN 1 END) as active_or_used_count
            FROM certificates c
            ${whereClause}
        `;
        const conversionResult = await pool.query(conversionQuery, queryParams);
        const conversionRate = conversionResult.rows[0].active_or_used_count > 0
            ? parseFloat(((conversionResult.rows[0].used_count / conversionResult.rows[0].active_or_used_count) * 100).toFixed(2))
            : 0;

        // Популярные номиналы
        const nominalsQuery = `
            SELECT 
                c.nominal_value as nominal,
                COUNT(*) as count,
                SUM(c.nominal_value) as total_sum
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
                COUNT(*) as count,
                SUM(c.nominal_value) as total_sum
            FROM certificates c
            JOIN certificate_designs cd ON c.design_id = cd.id
            ${whereClause}
            GROUP BY cd.id, cd.name
            ORDER BY count DESC
        `;

        const designsResult = await pool.query(designsQuery, queryParams);

        // Продажи по дням (за период или за последние 30 дней)
        const periodStart = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const periodEnd = end_date || new Date().toISOString().split('T')[0];
        
        const salesByDayQuery = `
            SELECT 
                DATE(c.purchase_date) as date,
                COUNT(*) as count,
                SUM(c.nominal_value) as total_value
            FROM certificates c
            WHERE c.purchase_date >= $1::date AND c.purchase_date <= $2::date
            GROUP BY DATE(c.purchase_date)
            ORDER BY date ASC
        `;
        const salesByDayResult = await pool.query(salesByDayQuery, [periodStart, periodEnd]);

        res.json({
            success: true,
            statistics: {
                total_certificates: parseInt(stats.total_certificates),
                total_value: parseFloat(stats.total_value) || 0,
                active_certificates: parseInt(stats.active_certificates),
                used_certificates: parseInt(stats.used_certificates),
                expired_certificates: parseInt(stats.expired_certificates),
                cancelled_certificates: parseInt(stats.cancelled_certificates) || 0,
                average_nominal: parseFloat(stats.average_nominal) || 0,
                activation_rate: parseFloat(stats.activation_rate),
                expiring_soon_count: expiringSoonCount,
                not_activated_30_days_count: notActivated30DaysCount,
                average_time_to_activation_days: parseFloat(averageTimeToActivationDays.toFixed(1)),
                conversion_rate: conversionRate,
                popular_nominals: nominalsResult.rows.map(row => ({
                    nominal: parseFloat(row.nominal),
                    count: parseInt(row.count),
                    total_sum: parseFloat(row.total_sum)
                })),
                popular_designs: designsResult.rows.map(row => ({
                    design_id: row.design_id,
                    design_name: row.design_name,
                    count: parseInt(row.count),
                    total_sum: parseFloat(row.total_sum)
                })),
                sales_by_day: salesByDayResult.rows.map(row => ({
                    date: row.date.toISOString().split('T')[0],
                    count: parseInt(row.count),
                    total_value: parseFloat(row.total_value)
                }))
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

// ADM-2. Получение детальной информации о сертификате (для админа)
// Важно: этот маршрут должен быть после /admin/statistics, чтобы не было конфликта
router.get('/admin/certificate/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const certificateId = parseInt(id);

        if (!certificateId || isNaN(certificateId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID сертификата',
                code: 'INVALID_ID'
            });
        }

        // Получаем детальную информацию о сертификате
        const certificateQuery = `
            SELECT 
                c.id,
                c.certificate_number,
                c.recipient_name,
                c.nominal_value,
                c.status,
                c.purchase_date,
                c.expiry_date,
                c.activation_date,
                c.message,
                c.pdf_url,
                c.image_url,
                c.created_at,
                c.updated_at,
                c.design_id,
                cd.name as design_name,
                cd.image_url as design_image_url,
                cl.id as purchaser_id,
                cl.full_name as purchaser_name,
                cl.phone as purchaser_phone,
                cl.email as purchaser_email,
                cl.telegram_id as purchaser_telegram_id,
                cl.telegram_username as purchaser_telegram_username,
                ca.id as activated_by_id,
                ca.full_name as activated_by_name,
                ca.phone as activated_by_phone,
                CASE 
                    WHEN c.expiry_date > NOW() THEN EXTRACT(DAY FROM (c.expiry_date - NOW()))
                    ELSE 0
                END as days_until_expiry
            FROM certificates c
            LEFT JOIN clients cl ON c.purchaser_id = cl.id
            LEFT JOIN clients ca ON c.activated_by_id = ca.id
            LEFT JOIN certificate_designs cd ON c.design_id = cd.id
            WHERE c.id = $1
        `;

        const certificateResult = await pool.query(certificateQuery, [certificateId]);

        if (certificateResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Сертификат не найден',
                code: 'CERTIFICATE_NOT_FOUND'
            });
        }

        const cert = certificateResult.rows[0];

        // Получаем транзакции, связанные с сертификатом
        const transactionsQuery = `
            SELECT 
                t.id,
                t.amount,
                t.type,
                t.description,
                t.created_at,
                w.wallet_number
            FROM transactions t
            LEFT JOIN wallets w ON t.wallet_id = w.id
            WHERE (
                (t.description ILIKE '%сертификат%' AND t.description ILIKE $1)
                OR (EXISTS (
                    SELECT 1 FROM wallets w2 
                    WHERE w2.client_id = $2 AND w2.id = t.wallet_id
                ))
            )
            ORDER BY t.created_at DESC
            LIMIT 10
        `;

        const transactionsResult = await pool.query(transactionsQuery, [
            `%${cert.certificate_number}%`,
            cert.purchaser_id
        ]);

        const transactions = transactionsResult.rows.map(trans => ({
            id: trans.id,
            amount: parseFloat(trans.amount),
            type: trans.type,
            description: trans.description,
            wallet_number: trans.wallet_number,
            created_at: trans.created_at.toISOString()
        }));

        const certificate = {
            id: cert.id,
            certificate_number: cert.certificate_number,
            purchaser: cert.purchaser_id ? {
                id: cert.purchaser_id,
                full_name: cert.purchaser_name,
                phone: cert.purchaser_phone,
                email: cert.purchaser_email,
                telegram_id: cert.purchaser_telegram_id,
                telegram_username: cert.purchaser_telegram_username
            } : null,
            recipient_name: cert.recipient_name,
            nominal_value: parseFloat(cert.nominal_value),
            design: {
                id: cert.design_id,
                name: cert.design_name,
                image_url: cert.design_image_url
            },
            status: cert.status,
            purchase_date: cert.purchase_date.toISOString(),
            expiry_date: cert.expiry_date.toISOString(),
            days_until_expiry: parseInt(cert.days_until_expiry) || 0,
            activated_by: cert.activated_by_id ? {
                id: cert.activated_by_id,
                full_name: cert.activated_by_name,
                phone: cert.activated_by_phone
            } : null,
            activation_date: cert.activation_date ? cert.activation_date.toISOString() : null,
            message: cert.message,
            pdf_url: cert.pdf_url,
            image_url: cert.image_url,
            transactions: transactions,
            created_at: cert.created_at.toISOString(),
            updated_at: cert.updated_at.toISOString()
        };

        res.json({
            success: true,
            certificate: certificate
        });

    } catch (error) {
        console.error('Ошибка при получении детальной информации о сертификате:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ADM-3. Продление срока действия сертификата
router.put('/admin/certificate/:id/extend', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { new_expiry_date, extend_days } = req.body;
        const certificateId = parseInt(id);

        if (!certificateId || isNaN(certificateId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID сертификата',
                code: 'INVALID_ID'
            });
        }

        if (!new_expiry_date && !extend_days) {
            return res.status(400).json({
                success: false,
                error: 'Необходимо указать new_expiry_date или extend_days',
                code: 'MISSING_PARAMETERS'
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Получаем текущую информацию о сертификате
            const certResult = await client.query(
                'SELECT id, expiry_date, status FROM certificates WHERE id = $1',
                [certificateId]
            );

            if (certResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Сертификат не найден',
                    code: 'CERTIFICATE_NOT_FOUND'
                });
            }

            const cert = certResult.rows[0];
            let newExpiryDate;

            if (new_expiry_date) {
                newExpiryDate = new Date(new_expiry_date);
                if (isNaN(newExpiryDate.getTime())) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Неверный формат даты',
                        code: 'INVALID_DATE'
                    });
                }
            } else if (extend_days) {
                const days = parseInt(extend_days);
                if (isNaN(days) || days <= 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Количество дней должно быть положительным числом',
                        code: 'INVALID_DAYS'
                    });
                }
                newExpiryDate = new Date(cert.expiry_date);
                newExpiryDate.setDate(newExpiryDate.getDate() + days);
            }

            // Обновляем срок действия
            const updateQuery = `
                UPDATE certificates 
                SET expiry_date = $1, 
                    status = CASE WHEN status = 'expired' THEN 'active' ELSE status END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING *
            `;
            const updateResult = await client.query(updateQuery, [newExpiryDate, certificateId]);

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Срок действия сертификата продлен',
                certificate: {
                    id: updateResult.rows[0].id,
                    certificate_number: updateResult.rows[0].certificate_number,
                    expiry_date: updateResult.rows[0].expiry_date.toISOString(),
                    status: updateResult.rows[0].status
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Ошибка при продлении срока сертификата:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ADM-4. Редактирование данных сертификата
router.put('/admin/certificate/:id/edit', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { recipient_name, message } = req.body;
        const certificateId = parseInt(id);

        if (!certificateId || isNaN(certificateId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID сертификата',
                code: 'INVALID_ID'
            });
        }

        if (!recipient_name && !message) {
            return res.status(400).json({
                success: false,
                error: 'Необходимо указать recipient_name или message для изменения',
                code: 'MISSING_PARAMETERS'
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Получаем текущую информацию о сертификате
            const certResult = await client.query(
                'SELECT id, certificate_number, recipient_name, message, design_id, nominal_value, expiry_date FROM certificates WHERE id = $1',
                [certificateId]
            );

            if (certResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Сертификат не найден',
                    code: 'CERTIFICATE_NOT_FOUND'
                });
            }

            const cert = certResult.rows[0];
            const updatedRecipientName = recipient_name !== undefined ? recipient_name : cert.recipient_name;
            const updatedMessage = message !== undefined ? message : cert.message;

            // Обновляем данные
            const updateQuery = `
                UPDATE certificates 
                SET recipient_name = $1,
                    message = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
                RETURNING *
            `;
            const updateResult = await client.query(updateQuery, [
                updatedRecipientName,
                updatedMessage,
                certificateId
            ]);

            // Если изменились данные, перегенерируем JPG
            const needRegenerate = recipient_name !== undefined || message !== undefined;
            let newImageUrl = updateResult.rows[0].image_url;
            let newPdfUrl = updateResult.rows[0].pdf_url;

            if (needRegenerate) {
                try {
                    const certificateJpgGenerator = require('../services/certificateJpgGenerator');
                    const certificateData = {
                        certificate_number: cert.certificate_number,
                        nominal_value: parseFloat(cert.nominal_value),
                        recipient_name: updatedRecipientName,
                        message: updatedMessage,
                        expiry_date: cert.expiry_date,
                        design_id: cert.design_id
                    };
                    const jpgResult = await certificateJpgGenerator.generateCertificateJpgForEmail(
                        cert.certificate_number,
                        certificateData
                    );
                    
                    if (jpgResult.jpg_url) {
                        newImageUrl = jpgResult.jpg_url;
                        newPdfUrl = jpgResult.jpg_url; // Используем JPG и для pdf_url
                        
                        await client.query(
                            'UPDATE certificates SET image_url = $1, pdf_url = $2 WHERE id = $3',
                            [newImageUrl, newPdfUrl, certificateId]
                        );
                    }
                } catch (jpgError) {
                    console.error('Ошибка при перегенерации JPG сертификата:', jpgError);
                    // Не прерываем операцию, просто логируем ошибку
                }
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Данные сертификата обновлены',
                certificate: {
                    id: updateResult.rows[0].id,
                    certificate_number: updateResult.rows[0].certificate_number,
                    recipient_name: updateResult.rows[0].recipient_name,
                    message: updateResult.rows[0].message,
                    image_url: newImageUrl,
                    pdf_url: newPdfUrl
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Ошибка при редактировании сертификата:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ADM-5. Повторная отправка сертификата
router.post('/admin/certificate/:id/resend', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const certificateId = parseInt(id);

        if (!certificateId || isNaN(certificateId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID сертификата',
                code: 'INVALID_ID'
            });
        }

        // Получаем информацию о сертификате и покупателе
        const certQuery = `
            SELECT 
                c.*,
                cl.full_name as purchaser_name,
                cl.email as purchaser_email,
                cl.telegram_id as purchaser_telegram_id,
                cd.name as design_name
            FROM certificates c
            LEFT JOIN clients cl ON c.purchaser_id = cl.id
            LEFT JOIN certificate_designs cd ON c.design_id = cd.id
            WHERE c.id = $1
        `;
        const certResult = await pool.query(certQuery, [certificateId]);

        if (certResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Сертификат не найден',
                code: 'CERTIFICATE_NOT_FOUND'
            });
        }

        const cert = certResult.rows[0];

        if (!cert.purchaser_email) {
            return res.status(400).json({
                success: false,
                error: 'У покупателя не указан email',
                code: 'NO_EMAIL'
            });
        }

        // Отправляем email с сертификатом
        const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
        const certificateUrl = `${baseUrl}/certificate/${cert.certificate_number}`;

        const certificateData = {
            certificateId: cert.id,
            certificateCode: cert.certificate_number,
            recipientName: cert.recipient_name || cert.purchaser_name,
            amount: parseFloat(cert.nominal_value),
            message: cert.message || null,
            pdfUrl: cert.pdf_url,
            imageUrl: cert.image_url,
            expiry_date: cert.expiry_date.toISOString(),
            certificate_url: certificateUrl
        };

        const emailResult = await emailService.sendCertificateEmail(cert.purchaser_email, certificateData);

        if (!emailResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Не удалось отправить email',
                details: emailResult.error,
                code: 'EMAIL_SEND_FAILED'
            });
        }

        res.json({
            success: true,
            message: 'Сертификат успешно отправлен повторно',
            email: cert.purchaser_email
        });

    } catch (error) {
        console.error('Ошибка при повторной отправке сертификата:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ADM-6. Ручное создание сертификата админом
router.post('/admin/create', verifyToken, async (req, res) => {
    console.log('🎁 [certificates/admin/create] Получен запрос на ручное создание сертификата');
    
    const client = await pool.connect();
    
    try {
        const { 
            purchaser_id,
            recipient_name,
            recipient_phone,
            nominal_value, 
            design_id, 
            message,
            expiry_date,
            skip_payment = false,
            reason
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

        if (!reason) {
            return res.status(400).json({
                success: false,
                error: 'Необходимо указать причину создания сертификата',
                code: 'MISSING_REASON'
            });
        }

        await client.query('BEGIN');

        // Проверяем существование покупателя
        const purchaserQuery = `
            SELECT c.id, c.full_name, c.email, c.telegram_id, w.id as wallet_id, w.balance, w.wallet_number
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

        // Если не пропускаем оплату, проверяем кошелек и баланс
        if (!skip_payment) {
            if (!purchaser.wallet_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'У покупателя нет кошелька',
                    code: 'WALLET_NOT_FOUND'
                });
            }

            if (parseFloat(purchaser.balance) < nominal_value) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Недостаточно средств на кошельке',
                    code: 'INSUFFICIENT_FUNDS'
                });
            }
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

        // Вычисляем дату истечения
        const now = new Date();
        let expiryDate;
        if (expiry_date) {
            expiryDate = new Date(expiry_date);
            if (isNaN(expiryDate.getTime())) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Неверный формат даты истечения',
                    code: 'INVALID_EXPIRY_DATE'
                });
            }
        } else {
            expiryDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // +1 год
        }

        // Генерируем JPG файл
        let pdfUrl = null;
        
        try {
            const certificateJpgGenerator = require('../services/certificateJpgGenerator');
            
            const certificateData = {
                certificate_number: certificateNumber,
                nominal_value: nominal_value,
                recipient_name: recipient_name || null,
                message: message || null,
                expiry_date: expiryDate,
                design_id: design_id
            };
            
            const jpgResult = await certificateJpgGenerator.generateCertificateJpgForEmail(certificateNumber, certificateData);
            pdfUrl = jpgResult.jpg_url;
            console.log(`✅ JPG сертификат создан: ${pdfUrl}`);
        } catch (fileError) {
            console.error('Ошибка при генерации JPG сертификата:', fileError);
            // Продолжаем без файла
        }

        // Создаем сертификат
        const certificateQuery = `
            INSERT INTO certificates (
                certificate_number, purchaser_id, recipient_name, recipient_phone,
                nominal_value, design_id, status, expiry_date, activation_date,
                message, purchase_date, pdf_url, image_url, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `;

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
            now, // purchase_date
            pdfUrl // pdf_url и image_url
        ]);

        const certificate = certificateResult.rows[0];

        // Если не пропускаем оплату, списываем средства
        if (!skip_payment && purchaser.wallet_id) {
            await client.query(
                'UPDATE wallets SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
                [nominal_value, purchaser.wallet_id]
            );

            const transactionDescription = `Покупка сертификата №${certificateNumber} - ${purchaser.full_name} (создан админом: ${reason})`;
            await client.query(
                `INSERT INTO transactions (wallet_id, amount, type, description, created_at)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                [purchaser.wallet_id, -nominal_value, 'payment', transactionDescription]
            );
        }

        await client.query('COMMIT');
        
        console.log('✅ [certificates/admin/create] Сертификат успешно создан:', {
            id: certificate.id,
            certificate_number: certificateNumber,
            purchaser_id: purchaser_id,
            skip_payment: skip_payment,
            reason: reason
        });

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
                expiry_date: certificate.expiry_date.toISOString(),
                purchase_date: certificate.purchase_date.toISOString(),
                certificate_url: certificateUrl,
                pdf_url: certificate.pdf_url,
                image_url: certificate.image_url,
                skip_payment: skip_payment,
                reason: reason
            }
        });

        // Отправляем email с сертификатом (асинхронно)
        if (purchaser.email) {
            setImmediate(async () => {
                try {
                    console.log(`📧 Отправка email с сертификатом на: ${purchaser.email}`);
                    
                    const certificateData = {
                        certificateId: certificate.id,
                        certificateCode: certificateNumber,
                        recipientName: recipient_name || purchaser.full_name,
                        amount: nominal_value,
                        message: message || null,
                        pdfUrl: certificate.pdf_url,
                        imageUrl: certificate.image_url,
                        expiry_date: expiryDate.toISOString(),
                        certificate_url: certificateUrl
                    };
                    
                    const emailResult = await emailService.sendCertificateEmail(purchaser.email, certificateData);
                    
                    if (emailResult.success) {
                        console.log(`✅ Email с сертификатом успешно отправлен на ${purchaser.email}`);
                    } else {
                        console.error(`❌ Ошибка отправки email на ${purchaser.email}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error('❌ Ошибка при отправке email с сертификатом:', emailError);
                }
            });
        }

        // Отправляем уведомление администратору (асинхронно)
        setImmediate(async () => {
            try {
                await notifyAdminCertificatePurchase({
                    clientName: purchaser.full_name,
                    certificateNumber: certificateNumber,
                    nominalValue: nominal_value,
                    purchaseDate: now,
                    isAdminCreated: true,
                    reason: reason,
                    skipPayment: skip_payment
                });
            } catch (notifyError) {
                console.error('Ошибка отправки уведомления администратору:', notifyError);
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при ручном создании сертификата:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    } finally {
        client.release();
    }
});

// ADM-6. Ручное создание сертификата администратором
router.post('/admin/create', verifyToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const {
            purchaser_id,
            recipient_name,
            recipient_phone,
            nominal_value,
            design_id,
            message,
            expiry_date,
            skip_payment = false,
            reason
        } = req.body;

        // Валидация обязательных полей
        if (!purchaser_id || !nominal_value || !design_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указаны обязательные поля: purchaser_id, nominal_value, design_id',
                code: 'MISSING_REQUIRED_FIELDS'
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

        // Проверяем существование покупателя
        const purchaserQuery = `
            SELECT c.id, c.full_name, c.email, c.telegram_id, w.id as wallet_id, w.balance
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

        // Определяем дату истечения
        let expiryDate;
        if (expiry_date) {
            expiryDate = new Date(expiry_date);
            if (isNaN(expiryDate.getTime())) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Неверный формат даты истечения',
                    code: 'INVALID_EXPIRY_DATE'
                });
            }
        } else {
            // По умолчанию +1 год
            expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        }

        // Генерируем уникальный номер сертификата
        const certificateNumber = await generateUniqueCertificateNumber();

        const now = new Date();
        let pdfUrl = null;
        let imageUrl = null;

        // Генерируем JPG сертификата
        try {
            const certificateJpgGenerator = require('../services/certificateJpgGenerator');
            
            const certificateData = {
                certificate_number: certificateNumber,
                nominal_value: nominal_value,
                recipient_name: recipient_name || purchaser.full_name,
                message: message,
                expiry_date: expiryDate,
                design_id: design_id
            };
            
            const jpgResult = await certificateJpgGenerator.generateCertificateJpgForEmail(certificateNumber, certificateData);
            pdfUrl = jpgResult.jpg_url || null;
            imageUrl = jpgResult.jpg_url || null;
            console.log(`✅ JPG сертификат создан: ${pdfUrl}`);
        } catch (fileError) {
            console.error('Ошибка при генерации JPG сертификата:', fileError);
            // Продолжаем без файлов
        }

        // Создаем сертификат
        const certificateQuery = `
            INSERT INTO certificates (
                certificate_number, purchaser_id, recipient_name, recipient_phone,
                nominal_value, design_id, status, expiry_date, activation_date,
                message, purchase_date, pdf_url, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `;

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
            now, // purchase_date
            pdfUrl // pdf_url
        ]);

        const certificate = certificateResult.rows[0];

        // Обновляем image_url если есть
        if (imageUrl) {
            await client.query(
                'UPDATE certificates SET image_url = $1 WHERE id = $2',
                [imageUrl, certificate.id]
            );
        }

        // Списываем средства с кошелька (если не skip_payment)
        if (!skip_payment) {
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

            // Списываем средства
            await client.query(
                'UPDATE wallets SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
                [nominal_value, purchaser.wallet_id]
            );

            // Создаем запись о транзакции
            const transactionDescription = reason 
                ? `Покупка сертификата №${certificateNumber} (${reason}) - ${purchaser.full_name}`
                : `Покупка сертификата №${certificateNumber} - ${purchaser.full_name}`;
            
            await client.query(
                `INSERT INTO transactions (wallet_id, amount, type, description, created_at)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                [purchaser.wallet_id, -nominal_value, 'payment', transactionDescription]
            );
        }

        await client.query('COMMIT');
        
        console.log(`✅ [admin/create] Сертификат успешно создан администратором:`, {
            id: certificate.id,
            certificate_number: certificateNumber,
            purchaser_id: purchaser_id,
            skip_payment: skip_payment,
            reason: reason || 'нет'
        });

        const certificateUrl = `${process.env.BASE_URL || 'https://gornostyle72.ru'}/certificate/${certificateNumber}`;

        // Ответ
        res.status(201).json({
            success: true,
            message: skip_payment 
                ? 'Сертификат успешно создан (без списания средств)'
                : 'Сертификат успешно создан',
            certificate: {
                id: certificate.id,
                certificate_number: certificateNumber,
                nominal_value: parseFloat(certificate.nominal_value),
                design_id: certificate.design_id,
                recipient_name: certificate.recipient_name,
                recipient_phone: certificate.recipient_phone,
                message: certificate.message,
                status: certificate.status,
                expiry_date: certificate.expiry_date.toISOString(),
                purchase_date: certificate.purchase_date.toISOString(),
                certificate_url: certificateUrl,
                pdf_url: certificate.pdf_url,
                image_url: certificate.image_url || certificate.pdf_url,
                skip_payment: skip_payment
            }
        });

        // Отправляем email с сертификатом (асинхронно)
        if (purchaser.email) {
            setImmediate(async () => {
                try {
                    console.log(`📧 Отправка email с сертификатом на: ${purchaser.email}`);
                    
                    const certificateData = {
                        certificateId: certificate.id,
                        certificateCode: certificateNumber,
                        recipientName: recipient_name || purchaser.full_name,
                        amount: nominal_value,
                        message: message || null,
                        pdfUrl: certificate.pdf_url,
                        imageUrl: certificate.image_url || certificate.pdf_url,
                        expiry_date: expiryDate.toISOString(),
                        certificate_url: certificateUrl
                    };
                    
                    const emailResult = await emailService.sendCertificateEmail(purchaser.email, certificateData);
                    
                    if (emailResult.success) {
                        console.log(`✅ Email с сертификатом успешно отправлен на ${purchaser.email}`);
                    } else {
                        console.error(`❌ Ошибка отправки email на ${purchaser.email}:`, emailResult.error);
                    }
                } catch (emailError) {
                    console.error('❌ Ошибка при отправке email с сертификатом:', emailError);
                }
            });
        }

        // Отправляем уведомление администратору (асинхронно)
        setImmediate(async () => {
            try {
                await notifyAdminCertificatePurchase({
                    clientName: purchaser.full_name,
                    certificateNumber: certificateNumber,
                    nominalValue: nominal_value,
                    purchaseDate: now,
                    adminCreated: true,
                    skipPayment: skip_payment,
                    reason: reason
                });
            } catch (notifyError) {
                console.error('Ошибка отправки уведомления администратору:', notifyError);
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при ручном создании сертификата:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    } finally {
        client.release();
    }
});

// 7. Регистрация клиента для покупки сертификата через сайт
async function registerHandler(req, res) {
    const client = await pool.connect();
    
    try {
        const {
            fullName,
            birthDate,
            phone,
            email,
            recipientName,
            message,
            amount,
            design
        } = req.body;

        // Валидация обязательных полей
        if (!fullName || !birthDate || !phone || !email || !amount || !design) {
            return res.status(400).json({
                success: false,
                error: 'Отсутствуют обязательные поля',
                code: 'MISSING_REQUIRED_FIELDS'
            });
        }

        // Валидация email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный формат email',
                code: 'INVALID_EMAIL'
            });
        }

        // Валидация телефона
        const phoneRegex = /^[\+]?[7|8][\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный формат телефона',
                code: 'INVALID_PHONE'
            });
        }

        // Валидация суммы
        const nominalValue = parseInt(amount);
        if (!nominalValue || nominalValue < 500 || nominalValue > 50000) {
            return res.status(400).json({
                success: false,
                error: 'Сумма должна быть от 500 до 50 000 рублей',
                code: 'INVALID_AMOUNT'
            });
        }

        // Валидация дизайна
        const designId = parseInt(design);
        if (!designId || designId < 1 || designId > 4) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID дизайна',
                code: 'INVALID_DESIGN'
            });
        }

        // Валидация даты рождения
        const birthDateObj = new Date(birthDate);
        const now = new Date();
        const age = now.getFullYear() - birthDateObj.getFullYear();
        if (age < 6 || age > 100) {
            return res.status(400).json({
                success: false,
                error: 'Проверьте корректность даты рождения',
                code: 'INVALID_BIRTH_DATE'
            });
        }

        console.log('Начало регистрации клиента для покупки сертификата:', {
            fullName, phone, email, amount: nominalValue
        });

        await client.query('BEGIN');

        // Проверяем, не существует ли уже клиент с таким телефоном (основной идентификатор)
        const existingClientQuery = `
            SELECT id, email, phone, full_name, birth_date 
            FROM clients 
            WHERE phone = $1
        `;
        const existingClient = await client.query(existingClientQuery, [phone]);

        let clientId;
        
        if (existingClient.rows.length > 0) {
            // Клиент уже существует - обновляем данные и добавляем email если его не было
            clientId = existingClient.rows[0].id;
            const currentEmail = existingClient.rows[0].email;
            
            console.log('Найден существующий клиент, ID:', clientId, 'email был:', !!currentEmail);
            
            // Обновляем только email, сохраняем существующие данные
            const updateClientQuery = `
                UPDATE clients 
                SET email = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `;
            await client.query(updateClientQuery, [email, clientId]);
            
            console.log('Клиент обновлен, email обновлен:', currentEmail === email ? 'тот же' : `с "${currentEmail}" на "${email}"`);
            console.log('Существующие данные сохранены: имя и дата рождения не изменены');
        } else {
            // Создаем нового клиента
            const insertClientQuery = `
                INSERT INTO clients (full_name, birth_date, phone, email, skill_level, created_at, updated_at) 
                VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
                RETURNING id
            `;
            const clientResult = await client.query(insertClientQuery, [fullName, birthDate, phone, email]);
            clientId = clientResult.rows[0].id;
            console.log('Создан новый клиент, ID:', clientId);
        }

        // Проверяем, есть ли уже кошелек у клиента
        const walletQuery = 'SELECT id, wallet_number FROM wallets WHERE client_id = $1';
        const walletResult = await client.query(walletQuery, [clientId]);

        let walletNumber;
        if (walletResult.rows.length > 0) {
            // Кошелек уже существует
            walletNumber = walletResult.rows[0].wallet_number;
            console.log('Найден существующий кошелек:', walletNumber);
        } else {
            // Создаем новый кошелек
            walletNumber = await generateUniqueWalletNumber();
            const insertWalletQuery = `
                INSERT INTO wallets (client_id, wallet_number, balance, last_updated) 
                VALUES ($1, $2, 0, CURRENT_TIMESTAMP)
            `;
            await client.query(insertWalletQuery, [clientId, walletNumber]);
            console.log('Создан новый кошелек:', walletNumber);
        }

        // Сохраняем согласие на обработку персональных данных
        try {
            // Получаем активную политику конфиденциальности
            const policyQuery = 'SELECT id FROM privacy_policies WHERE is_active = true ORDER BY created_at DESC LIMIT 1';
            const policyResult = await client.query(policyQuery);
            
            if (policyResult.rows.length > 0) {
                const policyId = policyResult.rows[0].id;
                
                // Проверяем, есть ли уже согласие с типом 'certificate_purchase'
                const existingConsentQuery = `
                    SELECT id FROM privacy_consents 
                    WHERE client_id = $1 AND consent_type = 'certificate_purchase' AND policy_id = $2
                `;
                const existingConsent = await client.query(existingConsentQuery, [clientId, policyId]);
                
                if (existingConsent.rows.length === 0) {
                    // Создаем новое согласие
                    const insertConsentQuery = `
                        INSERT INTO privacy_consents (client_id, policy_id, consent_type, consented_at, is_legacy)
                        VALUES ($1, $2, 'certificate_purchase', CURRENT_TIMESTAMP, false)
                    `;
                    await client.query(insertConsentQuery, [clientId, policyId]);
                    console.log('Создано согласие на обработку ПД для клиента:', clientId);
                } else {
                    console.log('Согласие на обработку ПД уже существует для клиента:', clientId);
                }
            } else {
                console.warn('Активная политика конфиденциальности не найдена');
            }
        } catch (consentError) {
            console.error('Ошибка при сохранении согласия на обработку ПД:', consentError);
            // Не прерываем транзакцию, просто логируем ошибку
        }

        // Сохраняем данные о планируемом сертификате во временной таблице или сессии
        // Для простоты создадим временную запись в таблице pending_certificates
        const createPendingQuery = `
            CREATE TABLE IF NOT EXISTS pending_certificates (
                id SERIAL PRIMARY KEY,
                client_id INTEGER,
                wallet_number VARCHAR(16),
                recipient_name VARCHAR(100),
                message TEXT,
                nominal_value DECIMAL(10,2),
                design_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour')
            )
        `;
        await client.query(createPendingQuery);

        // Удаляем старые записи для этого клиента
        await client.query('DELETE FROM pending_certificates WHERE client_id = $1', [clientId]);

        // Создаем новую запись
        const insertPendingQuery = `
            INSERT INTO pending_certificates (client_id, wallet_number, recipient_name, message, nominal_value, design_id)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await client.query(insertPendingQuery, [
            clientId, 
            walletNumber, 
            recipientName || null, 
            message || null, 
            nominalValue, 
            designId
        ]);

        await client.query('COMMIT');
        console.log('Регистрация успешно завершена');

        // Форматируем номер кошелька для отображения
        const formattedWalletNumber = walletNumber.replace(/(.{4})/g, '$1 ').trim();

        res.json({
            success: true,
            message: 'Регистрация успешно завершена',
            data: {
                clientId: clientId,
                walletNumber: formattedWalletNumber,
                amount: nominalValue
            }
        });

    } catch (error) {
        console.error('Ошибка при регистрации клиента для покупки сертификата:', error);
        await client.query('ROLLBACK');
        
        res.status(500).json({
            success: false,
            error: 'Произошла ошибка при обработке заявки',
            code: 'INTERNAL_ERROR'
        });
    } finally {
        client.release();
    }
}

// Добавляем обработчик в роутер
router.post('/register', registerHandler);

// 8. Предварительный просмотр сертификата (без сохранения в БД)
async function previewHandler(req, res) {
    try {
        const { 
            nominal_value, 
            design_id, 
            recipient_name, 
            message 
        } = req.body;

        // Валидация входных данных
        if (!nominal_value || !design_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указаны обязательные поля: nominal_value, design_id',
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

        // Проверяем существование дизайна
        const designResult = await pool.query(
            'SELECT id, name FROM certificate_designs WHERE id = $1 AND is_active = true',
            [design_id]
        );
        
        if (designResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Дизайн сертификата не найден или неактивен',
                code: 'INVALID_DESIGN'
            });
        }

        // Генерируем временный номер сертификата для превью
        const previewNumber = 'PREVIEW';
        
        // Вычисляем дату истечения (1 год от текущего момента)
        const now = new Date();
        const expiryDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

        // Импортируем генератор сертификатов
        const certificateJpgGenerator = require('../services/certificateJpgGenerator');
        
        // Данные для генерации превью
        const certificateData = {
            certificate_number: previewNumber,
            nominal_value: nominal_value,
            recipient_name: recipient_name || null,
            message: message || null,
            expiry_date: expiryDate,
            design_id: design_id
        };
        
        const previewPayload = await certificateJpgGenerator.generateCertificatePreview(certificateData);

        // Возвращаем HTML
        res.json({
            success: true,
            html: previewPayload.html,
            image: `data:image/jpeg;base64,${previewPayload.imageBase64}`,
            data: {
                nominal_value: parseFloat(nominal_value),
                design_id: design_id,
                recipient_name: recipient_name,
                message: message
            }
        });

    } catch (error) {
        console.error('Ошибка при генерации превью сертификата:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            code: 'INTERNAL_ERROR'
        });
    }
}

// Добавляем обработчик в роутер (для защищенных маршрутов)
router.post('/preview', previewHandler);

module.exports = router;
module.exports.registerHandler = registerHandler;
module.exports.previewHandler = previewHandler;
