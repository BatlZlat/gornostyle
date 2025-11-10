const express = require('express');
const { pool } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Все маршруты защищены авторизацией админа
router.use(verifyToken);

// ============ ИНСТРУКТОРЫ ============

// Получить список инструкторов с фильтрами
router.get('/instructors', async (req, res) => {
    const { status = 'active', sport = 'all' } = req.query;

    try {
        let query = 'SELECT * FROM kuliga_instructors WHERE 1=1';
        const params = [];

        if (status === 'active') {
            query += ' AND is_active = TRUE';
        } else if (status === 'inactive') {
            query += ' AND is_active = FALSE';
        }

        if (sport !== 'all') {
            params.push(sport);
            query += ` AND sport_type = $${params.length}`;
        }

        query += ' ORDER BY full_name ASC';

        const { rows } = await pool.query(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Ошибка получения инструкторов Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список инструкторов' });
    }
});

// Создать нового инструктора
router.post('/instructors', async (req, res) => {
    const {
        fullName,
        phone,
        email,
        photoUrl,
        description,
        sportType,
        adminPercentage = 20.0,
        hireDate,
        isActive = true,
    } = req.body;

    if (!fullName || !phone || !sportType) {
        return res.status(400).json({ success: false, error: 'Укажите обязательные поля: ФИО, телефон, вид спорта' });
    }

    if (!['ski', 'snowboard', 'both'].includes(sportType)) {
        return res.status(400).json({ success: false, error: 'Недопустимый вид спорта' });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO kuliga_instructors (
                full_name, phone, email, photo_url, description, sport_type, 
                admin_percentage, hire_date, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [fullName, phone, email || null, photoUrl || null, description || null, sportType, adminPercentage, hireDate || new Date(), isActive]
        );

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Ошибка создания инструктора Кулиги:', error);
        if (error.code === '23505') {
            res.status(409).json({ success: false, error: 'Инструктор с таким телефоном уже существует' });
        } else {
            res.status(500).json({ success: false, error: 'Не удалось создать инструктора' });
        }
    }
});

// Обновить инструктора
router.put('/instructors/:id', async (req, res) => {
    const { id } = req.params;
    const {
        fullName,
        phone,
        email,
        photoUrl,
        description,
        sportType,
        adminPercentage,
        hireDate,
        isActive,
    } = req.body;

    if (!fullName || !phone || !sportType) {
        return res.status(400).json({ success: false, error: 'Укажите обязательные поля' });
    }

    try {
        const { rows } = await pool.query(
            `UPDATE kuliga_instructors
             SET full_name = $1, phone = $2, email = $3, photo_url = $4, description = $5,
                 sport_type = $6, admin_percentage = $7, hire_date = $8, is_active = $9,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $10
             RETURNING *`,
            [fullName, phone, email || null, photoUrl || null, description || null, sportType, adminPercentage, hireDate, isActive, id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Инструктор не найден' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Ошибка обновления инструктора Кулиги:', error);
        if (error.code === '23505') {
            res.status(409).json({ success: false, error: 'Инструктор с таким телефоном уже существует' });
        } else {
            res.status(500).json({ success: false, error: 'Не удалось обновить инструктора' });
        }
    }
});

// Изменить статус инструктора (активен/неактивен)
router.patch('/instructors/:id', async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Укажите статус активности' });
    }

    try {
        const { rows } = await pool.query(
            `UPDATE kuliga_instructors
             SET is_active = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING *`,
            [isActive, id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Инструктор не найден' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Ошибка изменения статуса инструктора Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось изменить статус инструктора' });
    }
});

// ============ НАСТРОЙКИ ============

// Получить настройки
router.get('/settings', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT key, value FROM kuliga_admin_settings
             WHERE key IN ('default_admin_percentage', 'group_check_time')`
        );

        const settings = {
            default_admin_percentage: 20.0,
            group_check_time: '22:00',
        };

        rows.forEach((row) => {
            if (row.key === 'default_admin_percentage') {
                settings.default_admin_percentage = parseFloat(row.value);
            } else if (row.key === 'group_check_time') {
                settings.group_check_time = row.value;
            }
        });

        res.json({ success: true, data: settings });
    } catch (error) {
        console.error('Ошибка получения настроек Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить настройки' });
    }
});

// Обновить настройки
router.put('/settings', async (req, res) => {
    const { defaultAdminPercentage, groupCheckTime } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (defaultAdminPercentage !== undefined) {
            await client.query(
                `INSERT INTO kuliga_admin_settings (key, value, description)
                 VALUES ('default_admin_percentage', $1, 'Процент администратора по умолчанию для новых инструкторов')
                 ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
                [String(defaultAdminPercentage)]
            );
        }

        if (groupCheckTime) {
            await client.query(
                `INSERT INTO kuliga_admin_settings (key, value, description)
                 VALUES ('group_check_time', $1, 'Время проверки минимального количества участников в групповых тренировках')
                 ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
                [groupCheckTime]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Настройки успешно обновлены' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка обновления настроек Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось обновить настройки' });
    } finally {
        client.release();
    }
});

// ============ ФИНАНСЫ ============

// Получить финансовую отчётность
router.get('/finances', async (req, res) => {
    const { from, to } = req.query;

    if (!from || !to) {
        return res.status(400).json({ success: false, error: 'Укажите период (from, to)' });
    }

    try {
        // Общая статистика
        const summaryResult = await pool.query(
            `SELECT 
                COUNT(DISTINCT b.id) as total_trainings,
                COALESCE(SUM(b.price_total), 0) as total_revenue
             FROM kuliga_bookings b
             WHERE b.status = 'confirmed'
               AND b.date BETWEEN $1 AND $2`,
            [from, to]
        );

        const summary = summaryResult.rows[0] || {};
        const totalRevenue = parseFloat(summary.total_revenue || 0);

        // Детализация по инструкторам
        const detailsResult = await pool.query(
            `SELECT 
                i.id as instructor_id,
                i.full_name as instructor_name,
                i.admin_percentage,
                COUNT(b.id) as trainings_count,
                COALESCE(SUM(b.price_total), 0) as total_amount,
                COALESCE(SUM(b.price_total * i.admin_percentage / 100), 0) as admin_revenue,
                COALESCE(SUM(b.price_total * (1 - i.admin_percentage / 100)), 0) as instructor_revenue
             FROM kuliga_instructors i
             LEFT JOIN kuliga_bookings b ON b.instructor_id = i.id
                 AND b.status = 'confirmed'
                 AND b.date BETWEEN $1 AND $2
             GROUP BY i.id, i.full_name, i.admin_percentage
             HAVING COUNT(b.id) > 0
             ORDER BY total_amount DESC`,
            [from, to]
        );

        const details = detailsResult.rows.map((row) => ({
            ...row,
            total_amount: parseFloat(row.total_amount),
            admin_revenue: parseFloat(row.admin_revenue),
            instructor_revenue: parseFloat(row.instructor_revenue),
        }));

        const adminRevenue = details.reduce((sum, item) => sum + item.admin_revenue, 0);
        const instructorsRevenue = details.reduce((sum, item) => sum + item.instructor_revenue, 0);

        res.json({
            success: true,
            data: {
                summary: {
                    totalRevenue,
                    adminRevenue,
                    instructorsRevenue,
                    totalTrainings: parseInt(summary.total_trainings || 0, 10),
                },
                details,
            },
        });
    } catch (error) {
        console.error('Ошибка получения финансов Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить финансовую отчётность' });
    }
});

module.exports = router;

