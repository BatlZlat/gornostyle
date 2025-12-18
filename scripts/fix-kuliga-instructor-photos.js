/**
 * Скрипт для проверки и исправления photo_url для инструкторов Кулиги
 * Проверяет существующие файлы фото и обновляет photo_url в БД
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

// Подключение к БД
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

const transliterateToFilename = (fullName) => {
    const translitMap = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e',
        ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
        н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
        ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
        ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
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

async function fixInstructorPhotos() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Начинаем проверку фото инструкторов Кулиги...\n');
        
        // Получаем всех инструкторов
        const instructorsResult = await client.query(
            'SELECT id, full_name, photo_url FROM kuliga_instructors ORDER BY full_name'
        );
        
        const instructors = instructorsResult.rows;
        console.log(`📋 Найдено инструкторов: ${instructors.length}\n`);
        
        // Путь к директории с фото
        const photosDir = path.join(__dirname, '../public/images/kuliga');
        
        if (!fs.existsSync(photosDir)) {
            console.error(`❌ Директория не найдена: ${photosDir}`);
            return;
        }
        
        // Получаем список всех файлов в директории
        const files = fs.readdirSync(photosDir).filter(file => file.endsWith('.webp'));
        console.log(`📁 Найдено файлов фото: ${files.length}\n`);
        
        let updated = 0;
        let notFound = 0;
        
        for (const instructor of instructors) {
            const expectedFilename = `${transliterateToFilename(instructor.full_name)}.webp`;
            const filePath = path.join(photosDir, expectedFilename);
            const photoUrl = `/images/kuliga/${expectedFilename}`;
            
            const hasFile = fs.existsSync(filePath);
            const hasPhotoUrl = instructor.photo_url && instructor.photo_url.includes(expectedFilename);
            
            console.log(`👤 ${instructor.full_name} (ID: ${instructor.id})`);
            console.log(`   Ожидаемый файл: ${expectedFilename}`);
            console.log(`   Файл существует: ${hasFile ? '✅' : '❌'}`);
            console.log(`   photo_url в БД: ${instructor.photo_url || 'НЕТ'}`);
            
            if (hasFile && !hasPhotoUrl) {
                // Файл есть, но photo_url не установлен или неправильный
                console.log(`   🔧 Обновляем photo_url...`);
                await client.query(
                    'UPDATE kuliga_instructors SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [photoUrl, instructor.id]
                );
                console.log(`   ✅ Обновлено: ${photoUrl}`);
                updated++;
            } else if (!hasFile && hasPhotoUrl) {
                // photo_url есть, но файл не найден
                console.log(`   ⚠️  ВНИМАНИЕ: photo_url установлен, но файл не найден!`);
                notFound++;
            } else if (hasFile && hasPhotoUrl) {
                console.log(`   ✅ Всё в порядке`);
            } else {
                console.log(`   ℹ️  Фото не загружено`);
            }
            console.log('');
        }
        
        console.log('\n📊 ИТОГИ:');
        console.log(`   ✅ Обновлено инструкторов: ${updated}`);
        console.log(`   ⚠️  Файлы не найдены: ${notFound}`);
        console.log(`   📁 Всего файлов в директории: ${files.length}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

fixInstructorPhotos();

