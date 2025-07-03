const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Получение списка всех тренеров
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM trainers ORDER BY full_name');
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении списка тренеров:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Создание нового тренера
router.post('/', async (req, res) => {
    const {
        full_name,
        phone,
        birth_date,
        sport_type,
        description,
        hire_date,
        is_active
    } = req.body;

    // Проверка обязательных полей
    if (!full_name || !phone || !birth_date || !sport_type || !hire_date) {
        return res.status(400).json({ error: 'Необходимо заполнить все обязательные поля' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO trainers (
                full_name, phone, birth_date, sport_type, 
                description, hire_date, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [full_name, phone, birth_date, sport_type, description, hire_date, is_active]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при создании тренера:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получение информации о тренере
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('SELECT * FROM trainers WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении информации о тренере:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление информации о тренере
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const {
        full_name,
        phone,
        birth_date,
        sport_type,
        description,
        hire_date,
        is_active,
        photo_url
    } = req.body;

    try {
        const result = await pool.query(
            `UPDATE trainers 
             SET full_name = $1, phone = $2, birth_date = $3, 
                 sport_type = $4, description = $5, hire_date = $6, 
                 is_active = $7, photo_url = $8, updated_at = CURRENT_TIMESTAMP
             WHERE id = $9 RETURNING *`,
            [full_name, phone, birth_date, sport_type, description, hire_date, is_active, photo_url, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при обновлении информации о тренере:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Увольнение тренера (изменение статуса)
router.put('/:id/dismiss', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE trainers 
             SET is_active = false, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при увольнении тренера:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Восстановление тренера
router.put('/:id/rehire', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE trainers 
             SET is_active = true, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при восстановлении тренера:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Функция транслитерации ФИО в имя файла
function transliterateToFilename(fullName) {
    const translitMap = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
        'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
        'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
    };
    
    return fullName
        .toLowerCase()
        .split('')
        .map(char => translitMap[char] || char)
        .join('')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// Настройка multer для загрузки файлов
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        // Проверяем, что это изображение
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Можно загружать только изображения'), false);
        }
    }
});

// Загрузка фото тренера
router.post('/:id/upload-photo', upload.single('photo'), async (req, res) => {
    const { id } = req.params;
    
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }

    try {
        // Получаем данные тренера для формирования имени файла
        const trainerResult = await pool.query('SELECT full_name FROM trainers WHERE id = $1', [id]);
        
        if (trainerResult.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        const trainer = trainerResult.rows[0];
        const filename = transliterateToFilename(trainer.full_name) + '.webp';
        const filepath = path.join('public', 'images', 'trainers', filename);
        
        // Создаем папку если её нет
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        console.log(`🖼️ Загружаем фото для тренера ${trainer.full_name} (ID: ${id})`);
        console.log(`📁 Файл будет сохранен как: ${filename}`);
        console.log(`📍 Полный путь: ${filepath}`);
        
        // Обрабатываем изображение: сжимаем до 200px высоты с сохранением пропорций и конвертируем в WebP
        await sharp(req.file.buffer)
            .resize({ height: 200, fit: 'cover', position: 'centre' })
            .webp({ quality: 85, effort: 6 })
            .toFile(filepath);

        console.log(`✅ Фото успешно сохранено в WebP формате`);

        // Обновляем путь к фото в базе данных с версионированием для избежания кэширования
        const timestamp = Date.now();
        const photoUrl = `/images/trainers/${filename}?v=${timestamp}`;
        await pool.query(
            'UPDATE trainers SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [photoUrl, id]
        );

        res.json({ 
            success: true, 
            photo_url: photoUrl,
            message: 'Фото успешно загружено' 
        });

    } catch (error) {
        console.error('Ошибка при загрузке фото:', error);
        res.status(500).json({ error: 'Ошибка при загрузке фото' });
    }
});

module.exports = router; 