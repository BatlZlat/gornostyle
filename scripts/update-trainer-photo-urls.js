#!/usr/bin/env node

const { pool } = require('../src/db/index');
const fs = require('fs');
const path = require('path');

console.log('🔄 Обновление ссылок на фотографии тренеров в базе данных\n');

async function updatePhotoUrls() {
    try {
        // Получаем всех тренеров с фотографиями
        const result = await pool.query('SELECT id, full_name, photo_url FROM trainers WHERE photo_url IS NOT NULL');
        const trainers = result.rows;
        
        if (trainers.length === 0) {
            console.log('✅ Нет тренеров с фотографиями для обновления');
            return;
        }
        
        console.log(`📁 Найдено ${trainers.length} тренеров с фотографиями:\n`);
        
        let updatedCount = 0;
        let skippedCount = 0;
        
        for (const trainer of trainers) {
            if (!trainer.photo_url) continue;
            
            // Извлекаем имя файла из URL
            const fileName = path.basename(trainer.photo_url);
            const fileNameWithoutExt = path.parse(fileName).name;
            const fileExt = path.parse(fileName).ext;
            
            // Проверяем, есть ли WebP версия файла
            const webpFileName = `${fileNameWithoutExt}.webp`;
            const webpPath = path.join('public', 'images', 'trainers', webpFileName);
            
            if (fs.existsSync(webpPath)) {
                // Обновляем URL в базе данных
                const newPhotoUrl = `/images/trainers/${webpFileName}`;
                
                await pool.query(
                    'UPDATE trainers SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [newPhotoUrl, trainer.id]
                );
                
                console.log(`✅ ${trainer.full_name}: ${fileName} → ${webpFileName}`);
                updatedCount++;
            } else {
                console.log(`⏭️  ${trainer.full_name}: ${fileName} (WebP версия не найдена)`);
                skippedCount++;
            }
        }
        
        console.log('\n📊 Итоговая статистика:');
        console.log(`   ✅ Обновлено: ${updatedCount}`);
        console.log(`   ⏭️  Пропущено: ${skippedCount}`);
        console.log(`   📁 Всего тренеров: ${trainers.length}`);
        
        if (updatedCount > 0) {
            console.log('\n💡 Рекомендации:');
            console.log('   - Проверьте корректность отображения фотографий');
            console.log('   - Удалите старые файлы после проверки');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при обновлении ссылок:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Запускаем обновление
updatePhotoUrls(); 