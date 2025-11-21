const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const normalizePhone = (value = '') => value.replace(/[^0-9+]/g, '');
const normalizeDate = (value) => (value ? value : new Date().toISOString().split('T')[0]);
const normalizePercentage = (value, fallback = 20) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeWeekdays = (value) => {
    const arrayValue = Array.isArray(value) ? value : value !== undefined ? [value] : [];
    const weekdays = arrayValue
        .map((item) => parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
    const unique = Array.from(new Set(weekdays));
    if (unique.length === 0) {
        throw new Error('Укажите хотя бы один день недели');
    }
    return unique;
};

const normalizeTimeSlots = (value) => {
    const arrayValue = Array.isArray(value) ? value : value !== undefined ? [value] : [];
    const slots = arrayValue
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .map((time) => {
            if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
                throw new Error(`Некорректное время: ${time}`);
            }
            const [hours, minutes] = time.split(':');
            const h = parseInt(hours, 10);
            const m = parseInt(minutes, 10);
            if (h < 0 || h > 23 || m < 0 || m > 59) {
                throw new Error(`Некорректное время: ${time}`);
            }
            return time.length === 5 ? `${time}:00` : time;
        });

    if (slots.length === 0) {
        throw new Error('Добавьте хотя бы один временной слот');
    }
    return Array.from(new Set(slots)).sort();
};

const normalizeBool = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return fallback;
};

const transliterateToFilename = (fullName) => {
    const translitMap = {
        а: 'a',
        б: 'b',
        в: 'v',
        г: 'g',
        д: 'd',
        е: 'e',
        ё: 'e',
        ж: 'zh',
        з: 'z',
        и: 'i',
        й: 'y',
        к: 'k',
        л: 'l',
        м: 'm',
        н: 'n',
        о: 'o',
        п: 'p',
        р: 'r',
        с: 's',
        т: 't',
        у: 'u',
        ф: 'f',
        х: 'h',
        ц: 'ts',
        ч: 'ch',
        ш: 'sh',
        щ: 'sch',
        ъ: '',
        ы: 'y',
        ь: '',
        э: 'e',
        ю: 'yu',
        я: 'ya',
    };

    return fullName
        .toLowerCase()
        .split('')
        .map((char) => translitMap[char] || char)
        .join('')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Можно загружать только изображения'), false);
        }
    },
});

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

// Получить одного инструктора по ID
router.get('/instructors/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { rows } = await pool.query('SELECT * FROM kuliga_instructors WHERE id = $1', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Инструктор не найден' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Ошибка получения инструктора Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить инструктора' });
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
        return res
            .status(400)
            .json({ success: false, error: 'Укажите обязательные поля: ФИО, телефон, вид спорта' });
    }

    if (!['ski', 'snowboard', 'both'].includes(sportType)) {
        return res.status(400).json({ success: false, error: 'Недопустимый вид спорта' });
    }

    try {
        const normalizedHireDate = normalizeDate(hireDate);
        const normalizedPhone = normalizePhone(phone);
        const percentage = normalizePercentage(adminPercentage);

        const { rows } = await pool.query(
            `INSERT INTO kuliga_instructors (
                full_name, phone, email, photo_url, description, sport_type, 
                admin_percentage, hire_date, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                fullName,
                normalizedPhone,
                email || null,
                photoUrl || null,
                description || null,
                sportType,
                percentage,
                normalizedHireDate,
                isActive,
            ]
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
        username,
        password,
    } = req.body;

    if (!fullName || !phone || !sportType) {
        return res.status(400).json({ success: false, error: 'Укажите обязательные поля' });
    }

    if (!['ski', 'snowboard', 'both'].includes(sportType)) {
        return res.status(400).json({ success: false, error: 'Недопустимый вид спорта' });
    }

    try {
        const normalizedPhone = normalizePhone(phone);
        const percentage = normalizePercentage(adminPercentage);
        const normalizedHireDate = hireDate ? hireDate : null;

        // Подготовка обновляемых полей
        const updateFields = [
            'full_name = $1',
            'phone = $2',
            'email = $3',
            'photo_url = $4',
            'description = $5',
            'sport_type = $6',
            'admin_percentage = $7',
            'hire_date = COALESCE($8, hire_date)',
            'is_active = $9',
            'updated_at = CURRENT_TIMESTAMP',
        ];
        
        const updateValues = [
            fullName,
            normalizedPhone,
            email || null,
            photoUrl === undefined ? null : photoUrl,
            description || null,
            sportType,
            percentage,
            normalizedHireDate,
            typeof isActive === 'boolean' ? isActive : true,
        ];
        
        let paramIndex = updateValues.length + 1; // Следующий индекс для параметров
        
        // Обработка username
        if (username !== undefined) {
            if (username && username.trim()) {
                updateFields.push(`username = $${paramIndex}`);
                updateValues.push(username.trim());
                paramIndex++;
            } else {
                // Если username пустой, обнуляем его
                updateFields.push('username = NULL');
            }
        }
        
        // Обработка password (хешируем только если указан)
        if (password && password.trim()) {
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password.trim(), saltRounds);
            updateFields.push(`password_hash = $${paramIndex}`);
            updateValues.push(passwordHash);
            paramIndex++;
        }
        
        // Добавляем ID в конец для WHERE условия
        updateValues.push(id);
        
        const query = `
            UPDATE kuliga_instructors
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const { rows } = await pool.query(query, updateValues);

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

// Получить расписание инструктора
router.get('/schedule', async (req, res) => {
    const { instructor_id, start_date, end_date } = req.query;

    if (!instructor_id) {
        return res.status(400).json({ success: false, error: 'Укажите ID инструктора' });
    }

    try {
        let query = 'SELECT * FROM kuliga_schedule_slots WHERE instructor_id = $1';
        const params = [instructor_id];

        if (start_date) {
            params.push(start_date);
            query += ` AND date >= $${params.length}`;
        }

        if (end_date) {
            params.push(end_date);
            query += ` AND date <= $${params.length}`;
        }

        query += ' ORDER BY date ASC, start_time ASC';

        const { rows } = await pool.query(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Ошибка получения расписания инструктора:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить расписание' });
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

// Загрузка фото инструктора
router.post('/instructors/:id/upload-photo', upload.single('photo'), async (req, res) => {
    const { id } = req.params;

    if (!req.file) {
        return res.status(400).json({ success: false, error: 'Файл не загружен' });
    }

    try {
        const instructorResult = await pool.query(
            'SELECT full_name FROM kuliga_instructors WHERE id = $1',
            [id]
        );

        if (instructorResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Инструктор не найден' });
        }

        const instructor = instructorResult.rows[0];
        const filename = `${transliterateToFilename(instructor.full_name)}.webp`;
        const outputDir = path.join(__dirname, '../../public/images/kuliga');
        const outputPath = path.join(outputDir, filename);

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        await sharp(req.file.buffer)
            .resize({ height: 400, fit: 'cover', position: 'centre' })
            .webp({ quality: 85, effort: 6 })
            .toFile(outputPath);

        const timestamp = Date.now();
        const photoUrl = `/images/kuliga/${filename}?v=${timestamp}`;

        await pool.query(
            `UPDATE kuliga_instructors
             SET photo_url = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [photoUrl, id]
        );

        res.json({ success: true, photoUrl });
    } catch (error) {
        console.error('Ошибка загрузки фото инструктора Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось загрузить фото' });
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

// ============ ПРОГРАММЫ ============

router.get('/programs', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM kuliga_programs ORDER BY is_active DESC, created_at DESC`
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Ошибка получения программ Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список программ' });
    }
});

router.post('/programs', async (req, res) => {
    const {
        name,
        description,
        sportType,
        maxParticipants,
        trainingDuration,
        warmupDuration,
        weekdays,
        timeSlots,
        equipmentProvided,
        skipassProvided,
        price,
        isActive = true,
    } = req.body;

    if (!name || !sportType) {
        return res.status(400).json({ success: false, error: 'Укажите название и вид спорта' });
    }

    if (!['ski', 'snowboard', 'both'].includes(sportType)) {
        return res.status(400).json({ success: false, error: 'Недопустимый вид спорта' });
    }

    const maxParticipantsValue = parseInt(maxParticipants, 10);
    if (!Number.isInteger(maxParticipantsValue) || maxParticipantsValue < 2 || maxParticipantsValue > 8) {
        return res.status(400).json({ success: false, error: 'Максимум участников должен быть от 2 до 8' });
    }

    const trainingValue = parseInt(trainingDuration, 10);
    if (![60, 90, 120].includes(trainingValue)) {
        return res.status(400).json({ success: false, error: 'Время тренировки должно быть 60, 90 или 120 минут' });
    }

    const warmupValue = parseInt(warmupDuration, 10);
    if (![15, 20, 30].includes(warmupValue)) {
        return res.status(400).json({ success: false, error: 'Разминка должна быть 15, 20 или 30 минут' });
    }

    if (warmupValue > trainingValue) {
        return res.status(400).json({ success: false, error: 'Разминка не может превышать время тренировки' });
    }

    const priceValue = parseFloat(price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
        return res.status(400).json({ success: false, error: 'Укажите корректную цену' });
    }

    try {
        const normalizedWeekdays = normalizeWeekdays(weekdays);
        const normalizedTimeSlots = normalizeTimeSlots(timeSlots);

        const { rows } = await pool.query(
            `INSERT INTO kuliga_programs (
                name,
                description,
                sport_type,
                max_participants,
                training_duration,
                warmup_duration,
                weekdays,
                time_slots,
                equipment_provided,
                skipass_provided,
                price,
                is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *`,
            [
                name,
                description || null,
                sportType,
                maxParticipantsValue,
                trainingValue,
                warmupValue,
                normalizedWeekdays,
                normalizedTimeSlots,
                normalizeBool(equipmentProvided),
                normalizeBool(skipassProvided),
                priceValue,
                normalizeBool(isActive, true),
            ]
        );

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Ошибка создания программы Кулиги:', error);
        res.status(500).json({ success: false, error: error.message || 'Не удалось создать программу' });
    }
});

router.put('/programs/:id', async (req, res) => {
    const { id } = req.params;
    const {
        name,
        description,
        sportType,
        maxParticipants,
        trainingDuration,
        warmupDuration,
        weekdays,
        timeSlots,
        equipmentProvided,
        skipassProvided,
        price,
        isActive = true,
    } = req.body;

    if (!name || !sportType) {
        return res.status(400).json({ success: false, error: 'Укажите название и вид спорта' });
    }

    if (!['ski', 'snowboard', 'both'].includes(sportType)) {
        return res.status(400).json({ success: false, error: 'Недопустимый вид спорта' });
    }

    const maxParticipantsValue = parseInt(maxParticipants, 10);
    if (!Number.isInteger(maxParticipantsValue) || maxParticipantsValue < 2 || maxParticipantsValue > 8) {
        return res.status(400).json({ success: false, error: 'Максимум участников должен быть от 2 до 8' });
    }

    const trainingValue = parseInt(trainingDuration, 10);
    if (![60, 90, 120].includes(trainingValue)) {
        return res.status(400).json({ success: false, error: 'Время тренировки должно быть 60, 90 или 120 минут' });
    }

    const warmupValue = parseInt(warmupDuration, 10);
    if (![15, 20, 30].includes(warmupValue)) {
        return res.status(400).json({ success: false, error: 'Разминка должна быть 15, 20 или 30 минут' });
    }

    if (warmupValue > trainingValue) {
        return res.status(400).json({ success: false, error: 'Разминка не может превышать время тренировки' });
    }

    const priceValue = parseFloat(price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
        return res.status(400).json({ success: false, error: 'Укажите корректную цену' });
    }

    try {
        const normalizedWeekdays = normalizeWeekdays(weekdays);
        const normalizedTimeSlots = normalizeTimeSlots(timeSlots);

        const { rows } = await pool.query(
            `UPDATE kuliga_programs
             SET name = $1,
                 description = $2,
                 sport_type = $3,
                 max_participants = $4,
                 training_duration = $5,
                 warmup_duration = $6,
                 weekdays = $7,
                 time_slots = $8,
                 equipment_provided = $9,
                 skipass_provided = $10,
                 price = $11,
                 is_active = $12,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $13
             RETURNING *`,
            [
                name,
                description || null,
                sportType,
                maxParticipantsValue,
                trainingValue,
                warmupValue,
                normalizedWeekdays,
                normalizedTimeSlots,
                normalizeBool(equipmentProvided),
                normalizeBool(skipassProvided),
                priceValue,
                normalizeBool(isActive, true),
                id,
            ]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Программа не найдена' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Ошибка обновления программы Кулиги:', error);
        res.status(500).json({ success: false, error: error.message || 'Не удалось обновить программу' });
    }
});

router.patch('/programs/:id', async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Укажите статус активности' });
    }

    try {
        const { rows } = await pool.query(
            `UPDATE kuliga_programs
             SET is_active = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING *`,
            [isActive, id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Программа не найдена' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Ошибка изменения статуса программы Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось изменить статус программы' });
    }
});

router.delete('/programs/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { rowCount } = await pool.query(
            `DELETE FROM kuliga_programs WHERE id = $1`,
            [id]
        );

        if (rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Программа не найдена' });
        }

        res.json({ success: true, message: 'Программа удалена' });
    } catch (error) {
        console.error('Ошибка удаления программы Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось удалить программу' });
    }
});

// ============ ГРУППОВЫЕ ТРЕНИРОВКИ ============

/**
 * POST /api/kuliga/admin/group-trainings
 * Создание групповой тренировки через админ панель
 */
router.post('/group-trainings', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            instructor_id,
            slot_id,
            date,
            sport_type,
            level,
            description,
            price_per_person,
            min_participants,
            max_participants
        } = req.body;

        // Валидация
        if (!instructor_id || !slot_id || !date || !sport_type || !level || !price_per_person || !max_participants) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Обязательные поля: instructor_id, slot_id, date, sport_type, level, price_per_person, max_participants'
            });
        }

        if (!['ski', 'snowboard'].includes(sport_type)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'sport_type должен быть "ski" или "snowboard"' });
        }

        const pricePerPersonValue = parseFloat(price_per_person);
        if (!Number.isFinite(pricePerPersonValue) || pricePerPersonValue <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Цена должна быть положительным числом' });
        }

        const maxParticipantsValue = parseInt(max_participants, 10);
        if (!Number.isInteger(maxParticipantsValue) || maxParticipantsValue < 2) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Максимум участников должен быть не менее 2' });
        }

        const minParticipantsValue = parseInt(min_participants || 2, 10);
        if (!Number.isInteger(minParticipantsValue) || minParticipantsValue < 1 || minParticipantsValue > maxParticipantsValue) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Минимум участников должен быть от 1 и не больше максимума'
            });
        }

        // Проверяем, что инструктор существует и активен
        const instructorCheck = await client.query(
            'SELECT id, full_name FROM kuliga_instructors WHERE id = $1 AND is_active = TRUE',
            [instructor_id]
        );

        if (instructorCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Инструктор не найден или неактивен' });
        }

        // Получаем информацию о слоте
        const slotCheck = await client.query(
            `SELECT id, instructor_id, date, start_time, end_time, status
             FROM kuliga_schedule_slots
             WHERE id = $1 AND instructor_id = $2
             FOR UPDATE`,
            [slot_id, instructor_id]
        );

        if (slotCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Слот не найден или не принадлежит указанному инструктору'
            });
        }

        const slot = slotCheck.rows[0];

        // Проверяем, что слот не занят другой групповой тренировкой
        if (slot.status !== 'available') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Этот слот уже занят или заблокирован'
            });
        }

        // Преобразуем дату слота в строку формата YYYY-MM-DD для сравнения
        // Используем локальные методы для избежания проблем с часовым поясом
        const formatDateOnly = (date) => {
            if (!date) return null;
            if (typeof date === 'string') {
                return date.split('T')[0].split(' ')[0];
            }
            if (date instanceof Date) {
                // Используем локальные методы, чтобы избежать проблем с часовым поясом
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
            return String(date).split('T')[0].split(' ')[0];
        };
        
        const slotDateStr = formatDateOnly(slot.date);
        
        // Нормализуем запрошенную дату (убираем время, если есть)
        const requestedDateStr = date.split('T')[0].split(' ')[0];
        
        // Логируем для отладки
        console.log('Сравнение дат:', {
            slotDate: slot.date,
            slotDateType: typeof slot.date,
            slotDateStr,
            requestedDate: date,
            requestedDateStr,
            match: slotDateStr === requestedDateStr
        });
        
        if (slotDateStr !== requestedDateStr) {
            await client.query('ROLLBACK');
            console.error('Несовпадение дат:', { 
                slotDate: slot.date,
                slotDateStr, 
                requestedDate: date,
                requestedDateStr 
            });
            return res.status(400).json({
                success: false,
                error: `Дата слота не совпадает с указанной датой. Слот: ${slotDateStr}, Запрошено: ${requestedDateStr}`
            });
        }

        // Создаем групповую тренировку (ОТКРЫТУЮ для записи через "Записаться в группу")
        const trainingResult = await client.query(
            `INSERT INTO kuliga_group_trainings (
                instructor_id, slot_id, date, start_time, end_time,
                sport_type, level, description, price_per_person,
                min_participants, max_participants, current_participants, status, is_private
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 'open', FALSE)
            RETURNING *`,
            [
                instructor_id,
                slot_id,
                date,
                slot.start_time,
                slot.end_time,
                sport_type,
                level,
                description || null,
                pricePerPersonValue,
                minParticipantsValue,
                maxParticipantsValue
            ]
        );

        const training = trainingResult.rows[0];

        // Обновляем статус слота на 'group'
        await client.query(
            `UPDATE kuliga_schedule_slots
             SET status = 'group', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [slot_id]
        );

        await client.query('COMMIT');

        console.log(`✅ Создана групповая тренировка через админ панель: ID=${training.id}, инструктор=${instructorCheck.rows[0].full_name}, дата=${date}, время=${slot.start_time}`);

        res.status(201).json({ success: true, data: training });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка создания групповой тренировки через админ панель:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания групповой тренировки: ' + error.message
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/kuliga/admin/group-trainings
 * Получение списка групповых тренировок
 */
router.get('/group-trainings', async (req, res) => {
    const { start_date, end_date, instructor_id, status } = req.query;

    try {
        let query = `
            SELECT kgt.*, ki.full_name as instructor_name
            FROM kuliga_group_trainings kgt
            JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (start_date) {
            query += ` AND kgt.date >= $${paramIndex}`;
            params.push(start_date);
            paramIndex++;
        }

        if (end_date) {
            query += ` AND kgt.date <= $${paramIndex}`;
            params.push(end_date);
            paramIndex++;
        }

        if (instructor_id) {
            query += ` AND kgt.instructor_id = $${paramIndex}`;
            params.push(instructor_id);
            paramIndex++;
        }

        if (status) {
            query += ` AND kgt.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }

        query += ' ORDER BY kgt.date DESC, kgt.start_time DESC';

        const { rows } = await pool.query(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Ошибка получения групповых тренировок:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список групповых тренировок' });
    }
});

/**
 * GET /api/kuliga/admin/training/:id
 * Получение деталей тренировки Кулиги (групповой или индивидуальной)
 */
router.get('/training/:id', async (req, res) => {
    const { id } = req.params;
    const { type } = req.query; // 'group' или 'individual'

    try {
        if (type === 'group') {
            // Получаем основную информацию о групповой тренировке
            const trainingResult = await pool.query(`
                SELECT 
                    kgt.*,
                    ki.full_name as instructor_name,
                    ki.phone as instructor_phone
                FROM kuliga_group_trainings kgt
                LEFT JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
                WHERE kgt.id = $1
            `, [id]);

            if (trainingResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Групповая тренировка не найдена' });
            }

            const training = trainingResult.rows[0];

            // Получаем список бронирований
            const bookingsResult = await pool.query(`
                SELECT 
                    kb.*,
                    c.full_name as client_name,
                    c.phone as client_phone,
                    COALESCE(array_to_string(kb.participants_names, ', '), '') as participants_names_str
                FROM kuliga_bookings kb
                JOIN clients c ON kb.client_id = c.id
                WHERE kb.group_training_id = $1
                    AND kb.status IN ('pending', 'confirmed')
                ORDER BY kb.created_at DESC
            `, [id]);

            // Подсчитываем статистику
            const bookingsCount = bookingsResult.rows.length;
            const totalParticipantsCount = bookingsResult.rows.reduce((sum, b) => sum + (b.participants_count || 0), 0);
            
            // Формируем список имен участников
            const participantNamesList = bookingsResult.rows
                .map(b => {
                    const name = b.client_name || '';
                    const phone = b.client_phone ? ` (тел: ${b.client_phone})` : '';
                    return name + phone;
                })
                .filter(Boolean)
                .join(', ');

            res.json({
                success: true,
                data: {
                    ...training,
                    bookings: bookingsResult.rows,
                    bookings_count: bookingsCount,
                    total_participants_count: totalParticipantsCount,
                    participant_names_list: participantNamesList
                }
            });
        } else if (type === 'individual') {
            // Получаем индивидуальную тренировку
            const bookingResult = await pool.query(`
                SELECT 
                    kb.*,
                    ki.full_name as instructor_name,
                    ki.phone as instructor_phone,
                    c.full_name as client_name,
                    c.phone as client_phone,
                    array_to_string(kb.participants_names, ', ') as participants_names_str
                FROM kuliga_bookings kb
                LEFT JOIN kuliga_instructors ki ON kb.instructor_id = ki.id
                JOIN clients c ON kb.client_id = c.id
                WHERE kb.id = $1
            `, [id]);

            if (bookingResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Индивидуальная тренировка не найдена' });
            }

            res.json({
                success: true,
                data: bookingResult.rows[0]
            });
        } else {
            return res.status(400).json({ success: false, error: 'Необходимо указать type (group или individual)' });
        }
    } catch (error) {
        console.error('Ошибка получения деталей тренировки:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить детали тренировки' });
    }
});

/**
 * DELETE /api/kuliga/admin/training/:id
 * Удаление тренировки Кулиги (групповой или индивидуальной) с возвратом средств и уведомлениями
 */
router.delete('/training/:id', async (req, res) => {
    const { id } = req.params;
    const { type } = req.query; // 'group' или 'individual'

    if (!type || !['group', 'individual'].includes(type)) {
        return res.status(400).json({ success: false, error: 'Необходимо указать type (group или individual)' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (type === 'individual') {
            // Удаление индивидуального бронирования
            // Сначала блокируем основную таблицу
            const bookingResult = await client.query(`
                SELECT 
                    kb.*,
                    c.full_name as client_name,
                    c.phone as client_phone,
                    c.id as client_id,
                    w.id as wallet_id
                FROM kuliga_bookings kb
                JOIN clients c ON kb.client_id = c.id
                LEFT JOIN wallets w ON c.id = w.client_id
                WHERE kb.id = $1 AND kb.booking_type = 'individual'
                FOR UPDATE
            `, [id]);

            if (bookingResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Индивидуальное бронирование не найдено' });
            }

            const booking = bookingResult.rows[0];

            // Получаем данные инструктора отдельно (не используем FOR UPDATE для LEFT JOIN)
            let instructorData = { telegram_id: null, full_name: null };
            if (booking.instructor_id) {
                const instructorResult = await client.query(
                    'SELECT telegram_id, full_name FROM kuliga_instructors WHERE id = $1',
                    [booking.instructor_id]
                );
                if (instructorResult.rows.length > 0) {
                    instructorData = instructorResult.rows[0];
                }
            }
            
            // Объединяем данные
            booking.instructor_telegram_id = instructorData.telegram_id;
            booking.instructor_name = instructorData.full_name;

            // Проверяем, что бронирование не отменено
            if (booking.status === 'cancelled') {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Бронирование уже отменено' });
            }

            // Форматируем дату и время
            const date = new Date(booking.date);
            const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
            const [hours, minutes] = String(booking.start_time).split(':');
            const formattedTime = `${hours}:${minutes}`;
            const participantName = booking.participants_names && Array.isArray(booking.participants_names) 
                ? booking.participants_names.join(', ') 
                : booking.participants_names || 'Участник';

            // Освобождаем слот
            if (booking.slot_id) {
                await client.query(
                    'UPDATE kuliga_schedule_slots SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    ['available', booking.slot_id]
                );
            }

            // Обновляем статус бронирования
            await client.query(
                'UPDATE kuliga_bookings SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['cancelled', id]
            );

            // Возвращаем средства на баланс кошелька
            const refundAmount = Number(booking.price_total || 0);
            if (refundAmount > 0 && booking.wallet_id) {
                await client.query(
                    'UPDATE wallets SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
                    [refundAmount, booking.wallet_id]
                );

                // Создаем транзакцию возврата
                await client.query(
                    'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                    [
                        booking.wallet_id,
                        refundAmount,
                        'amount',
                        `Возврат: Индивидуальная тренировка Кулига, ${participantName}, Дата: ${formattedDate}, Время: ${formattedTime}`
                    ]
                );
            }

            await client.query('COMMIT');

            // Отправляем уведомления (асинхронно)
            setImmediate(async () => {
                try {
                    const { notifyAdminNaturalSlopeTrainingCancellation, notifyInstructorKuligaTrainingCancellation } = require('../bot/admin-notify');
                    
                    // Уведомление администратору
                    await notifyAdminNaturalSlopeTrainingCancellation({
                        client_name: booking.client_name,
                        participant_name: participantName,
                        client_phone: booking.client_phone,
                        date: booking.date,
                        time: formattedTime,
                        trainer_name: booking.instructor_name || 'Не указан',
                        booking_type: 'individual',
                        refund: refundAmount,
                        sport_type: booking.sport_type
                    });

                    // Уведомление инструктору
                    if (booking.instructor_telegram_id) {
                        await notifyInstructorKuligaTrainingCancellation({
                            participant_name: participantName,
                            client_name: booking.client_name,
                            client_phone: booking.client_phone,
                            date: booking.date,
                            time: formattedTime,
                            instructor_name: booking.instructor_name,
                            instructor_telegram_id: booking.instructor_telegram_id
                        });
                    }
                } catch (error) {
                    console.error('Ошибка при отправке уведомлений:', error);
                }
            });

            res.json({
                success: true,
                message: 'Индивидуальное бронирование успешно отменено',
                refund: refundAmount
            });

        } else if (type === 'group') {
            // Удаление группового бронирования
            // Сначала блокируем основную таблицу бронирований
            const bookingResult = await client.query(`
                SELECT 
                    kb.*,
                    kgt.slot_id,
                    kgt.is_private,
                    kgt.instructor_id,
                    c.full_name as client_name,
                    c.phone as client_phone,
                    c.id as client_id,
                    w.id as wallet_id
                FROM kuliga_bookings kb
                JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
                JOIN clients c ON kb.client_id = c.id
                LEFT JOIN wallets w ON c.id = w.client_id
                WHERE kb.id = $1 AND kb.booking_type = 'group'
                FOR UPDATE OF kb
            `, [id]);

            if (bookingResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Групповое бронирование не найдено' });
            }

            const booking = bookingResult.rows[0];

            // Получаем данные инструктора отдельно (не используем FOR UPDATE для LEFT JOIN)
            let instructorData = { telegram_id: null, full_name: null };
            if (booking.instructor_id) {
                const instructorResult = await client.query(
                    'SELECT telegram_id, full_name FROM kuliga_instructors WHERE id = $1',
                    [booking.instructor_id]
                );
                if (instructorResult.rows.length > 0) {
                    instructorData = instructorResult.rows[0];
                }
            }
            
            // Объединяем данные
            booking.instructor_telegram_id = instructorData.telegram_id;
            booking.instructor_name = instructorData.full_name;

            // Проверяем, что бронирование не отменено
            if (booking.status === 'cancelled') {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Бронирование уже отменено' });
            }

            // Форматируем дату и время
            const date = new Date(booking.date);
            const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
            const [hours, minutes] = String(booking.start_time).split(':');
            const formattedTime = `${hours}:${minutes}`;
            const participantsList = booking.participants_names && Array.isArray(booking.participants_names)
                ? booking.participants_names.join(', ')
                : booking.participants_names || 'Участник';
            const participantsCount = booking.participants_count || 1;

            // Обновляем статус бронирования
            await client.query(
                'UPDATE kuliga_bookings SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['cancelled', id]
            );

            // Пересчитываем количество участников
            const participantsCountRes = await client.query(
                `SELECT COALESCE(SUM(participants_count), 0) as total_participants
                 FROM kuliga_bookings
                 WHERE group_training_id = $1 AND status = 'confirmed'`,
                [booking.group_training_id]
            );
            const remainingParticipants = parseInt(participantsCountRes.rows[0].total_participants || 0);

            // Обновляем количество участников в групповой тренировке
            await client.query(
                `UPDATE kuliga_group_trainings 
                 SET current_participants = $1, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $2`,
                [remainingParticipants, booking.group_training_id]
            );

            // Освобождаем слот, если нужно
            if (booking.slot_id) {
                if (booking.is_private) {
                    // Для приватных тренировок освобождаем слот сразу
                    await client.query(
                        'UPDATE kuliga_schedule_slots SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                        ['available', booking.slot_id]
                    );
                    // Отменяем групповую тренировку
                    await client.query(
                        `UPDATE kuliga_group_trainings 
                         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
                         WHERE id = $1`,
                        [booking.group_training_id]
                    );
                } else if (remainingParticipants <= 0) {
                    // Для публичных тренировок освобождаем слот только если участников не осталось
                    await client.query(
                        'UPDATE kuliga_schedule_slots SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                        ['available', booking.slot_id]
                    );
                }
            }

            // Возвращаем средства на баланс кошелька
            const refundAmount = Number(booking.price_total || 0);
            if (refundAmount > 0 && booking.wallet_id) {
                await client.query(
                    'UPDATE wallets SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
                    [refundAmount, booking.wallet_id]
                );

                // Создаем транзакцию возврата
                await client.query(
                    'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                    [
                        booking.wallet_id,
                        refundAmount,
                        'amount',
                        `Возврат: Групповая тренировка Кулига (${participantsCount} участников), Дата: ${formattedDate}, Время: ${formattedTime}`
                    ]
                );
            }

            await client.query('COMMIT');

            // Отправляем уведомления (асинхронно)
            setImmediate(async () => {
                try {
                    const { notifyAdminNaturalSlopeTrainingCancellation, notifyInstructorKuligaTrainingCancellation } = require('../bot/admin-notify');
                    
                    // Уведомление администратору
                    await notifyAdminNaturalSlopeTrainingCancellation({
                        client_name: booking.client_name,
                        participant_name: participantsList,
                        participants_count: participantsCount,
                        client_phone: booking.client_phone,
                        date: booking.date,
                        time: formattedTime,
                        instructor_name: booking.instructor_name || 'Не указан',
                        booking_type: 'group',
                        refund: refundAmount,
                        sport_type: booking.sport_type
                    });

                    // Уведомление инструктору
                    if (booking.instructor_telegram_id) {
                        await notifyInstructorKuligaTrainingCancellation({
                            participant_name: participantsList,
                            client_name: booking.client_name,
                            client_phone: booking.client_phone,
                            date: booking.date,
                            time: formattedTime,
                            instructor_name: booking.instructor_name,
                            instructor_telegram_id: booking.instructor_telegram_id
                        });
                    }
                } catch (error) {
                    console.error('Ошибка при отправке уведомлений:', error);
                }
            });

            res.json({
                success: true,
                message: 'Групповое бронирование успешно отменено',
                refund: refundAmount,
                remaining_participants: remainingParticipants
            });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при удалении тренировки Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось удалить тренировку: ' + error.message });
    } finally {
        client.release();
    }
});

/**
 * PUT /api/kuliga/admin/training/:id
 * Редактирование тренировки Кулиги (групповой или индивидуальной)
 */
router.put('/training/:id', async (req, res) => {
    const { id } = req.params;
    const { type } = req.query; // 'group' или 'individual'
    const updateData = req.body;

    if (!type || !['group', 'individual'].includes(type)) {
        return res.status(400).json({ success: false, error: 'Необходимо указать type (group или individual)' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (type === 'individual') {
            // Редактирование индивидуального бронирования
            const allowedFields = ['date', 'start_time', 'end_time', 'sport_type', 'instructor_id', 'slot_id', 'participants_names'];
            const updates = [];
            const values = [];
            let paramIndex = 1;

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    if (field === 'participants_names') {
                        // Преобразуем массив в формат PostgreSQL array
                        updates.push(`${field} = $${paramIndex}::text[]`);
                        values.push(Array.isArray(updateData[field]) ? updateData[field] : [updateData[field]]);
                    } else {
                        updates.push(`${field} = $${paramIndex}`);
                        values.push(updateData[field]);
                    }
                    paramIndex++;
                }
            }

            if (updates.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Нет полей для обновления' });
            }

            values.push(id);
            const updateQuery = `
                UPDATE kuliga_bookings 
                SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
                WHERE id = $${paramIndex} AND booking_type = 'individual'
                RETURNING *
            `;

            const result = await client.query(updateQuery, values);

            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Индивидуальное бронирование не найдено' });
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Индивидуальное бронирование успешно обновлено',
                data: result.rows[0]
            });

        } else if (type === 'group') {
            // Редактирование групповой тренировки
            const allowedFields = ['date', 'start_time', 'end_time', 'sport_type', 'level', 'description', 
                                   'price_per_person', 'min_participants', 'max_participants', 'instructor_id', 'slot_id'];
            const updates = [];
            const values = [];
            let paramIndex = 1;

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    updates.push(`${field} = $${paramIndex}`);
                    values.push(updateData[field]);
                    paramIndex++;
                }
            }

            if (updates.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Нет полей для обновления' });
            }

            values.push(id);
            const updateQuery = `
                UPDATE kuliga_group_trainings 
                SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await client.query(updateQuery, values);

            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Групповая тренировка не найдена' });
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Групповая тренировка успешно обновлена',
                data: result.rows[0]
            });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при редактировании тренировки Кулиги:', error);
        res.status(500).json({ success: false, error: 'Не удалось обновить тренировку: ' + error.message });
    } finally {
        client.release();
    }
});

/**
 * GET /api/kuliga/admin/available-dates
 * Получение дат с расписанием инструкторов для указанного вида спорта
 */
router.get('/available-dates', async (req, res) => {
    const { sport_type, from_date, to_date } = req.query;

    if (!sport_type || !['ski', 'snowboard'].includes(sport_type)) {
        return res.status(400).json({ success: false, error: 'Укажите sport_type (ski или snowboard)' });
    }

    try {
        const from = from_date || new Date().toISOString().split('T')[0];
        const to = to_date || (() => {
            const d = new Date();
            d.setMonth(d.getMonth() + 2);
            return d.toISOString().split('T')[0];
        })();

        // Получаем уникальные даты, на которые есть свободные слоты у инструкторов нужного вида спорта
        const { rows } = await pool.query(
            `SELECT DISTINCT s.date
             FROM kuliga_schedule_slots s
             JOIN kuliga_instructors i ON s.instructor_id = i.id
             WHERE s.date BETWEEN $1 AND $2
               AND s.status = 'available'
               AND i.is_active = TRUE
               AND (i.sport_type = $3 OR i.sport_type = 'both')
             ORDER BY s.date ASC`,
            [from, to, sport_type]
        );

        const dates = rows.map(row => row.date.toISOString().split('T')[0]);
        res.json({ success: true, data: dates });
    } catch (error) {
        console.error('Ошибка получения дат с расписанием:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить даты с расписанием' });
    }
});

/**
 * GET /api/kuliga/admin/instructors
 * Получение инструкторов, у которых есть расписание на указанную дату для указанного вида спорта
 */
router.get('/instructors', async (req, res) => {
    const { date, sport_type } = req.query;

    if (!date) {
        return res.status(400).json({ success: false, error: 'Укажите date' });
    }

    if (!sport_type || !['ski', 'snowboard'].includes(sport_type)) {
        return res.status(400).json({ success: false, error: 'Укажите sport_type (ski или snowboard)' });
    }

    try {
        // Получаем инструкторов, у которых есть хотя бы один свободный слот на указанную дату
        // Фильтруем строго по виду спорта: инструктор должен иметь sport_type = выбранный вид спорта ИЛИ 'both'
        const { rows } = await pool.query(
            `SELECT DISTINCT i.id, i.full_name, i.sport_type, i.photo_url
             FROM kuliga_instructors i
             JOIN kuliga_schedule_slots s ON s.instructor_id = i.id
             WHERE s.date = $1
               AND s.status = 'available'
               AND i.is_active = TRUE
               AND (i.sport_type = $2 OR i.sport_type = 'both')
             ORDER BY i.full_name ASC`,
            [date, sport_type]
        );
        
        // Дополнительная фильтрация на случай если SQL не сработал правильно
        const filteredRows = rows.filter(instructor => 
            instructor.sport_type === sport_type || instructor.sport_type === 'both'
        );

        res.json({ success: true, data: filteredRows });
    } catch (error) {
        console.error('Ошибка получения инструкторов:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список инструкторов' });
    }
});

/**
 * GET /api/kuliga/admin/available-slots
 * Получение всех свободных слотов на указанную дату для указанного вида спорта (всех инструкторов)
 */
router.get('/available-slots', async (req, res) => {
    const { date, sport_type } = req.query;

    if (!date) {
        return res.status(400).json({ success: false, error: 'Укажите date' });
    }

    if (!sport_type || !['ski', 'snowboard'].includes(sport_type)) {
        return res.status(400).json({ success: false, error: 'Укажите sport_type (ski или snowboard)' });
    }

    try {
        const { rows } = await pool.query(
            `SELECT s.id AS slot_id,
                    s.instructor_id,
                    s.date,
                    s.start_time,
                    s.end_time,
                    i.full_name AS instructor_name,
                    i.sport_type AS instructor_sport_type
             FROM kuliga_schedule_slots s
             JOIN kuliga_instructors i ON s.instructor_id = i.id
             WHERE s.date = $1
               AND s.status = 'available'
               AND i.is_active = TRUE
               AND (i.sport_type = $2 OR i.sport_type = 'both')
             ORDER BY s.start_time ASC, i.full_name ASC`,
            [date, sport_type]
        );

        // Вспомогательная функция для форматирования даты без учета часового пояса
        const formatDateOnly = (date) => {
            if (!date) return null;
            if (typeof date === 'string') {
                return date.split('T')[0].split(' ')[0];
            }
            if (date instanceof Date) {
                // Используем локальные методы, чтобы избежать проблем с часовым поясом
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
            return String(date).split('T')[0].split(' ')[0];
        };

        const slots = rows.map(row => ({
            slot_id: row.slot_id,
            instructor_id: row.instructor_id,
            date: formatDateOnly(row.date),
            start_time: row.start_time,
            end_time: row.end_time,
            instructor_name: row.instructor_name,
            instructor_sport_type: row.instructor_sport_type
        }));

        res.json({ success: true, data: slots });
    } catch (error) {
        console.error('Ошибка получения свободных слотов:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить список слотов' });
    }
});

module.exports = router;

