#!/usr/bin/env node

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

console.log('🖼️  Конвертация фотографий тренеров в WebP формат\n');

const trainersDir = path.join('public', 'images', 'trainers');

// Проверяем существование директории
if (!fs.existsSync(trainersDir)) {
    console.log('❌ Директория trainers не найдена');
    process.exit(1);
}

// Получаем список файлов в директории
const files = fs.readdirSync(trainersDir);
const imageFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.bmp', '.gif'].includes(ext);
});

if (imageFiles.length === 0) {
    console.log('✅ Нет изображений для конвертации');
    process.exit(0);
}

console.log(`📁 Найдено ${imageFiles.length} изображений для конвертации:\n`);

let convertedCount = 0;
let errorCount = 0;

// Функция для получения размера файла в читаемом формате
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Конвертируем каждое изображение
async function convertImages() {
    for (const file of imageFiles) {
        const filePath = path.join(trainersDir, file);
        const fileName = path.parse(file).name;
        const webpPath = path.join(trainersDir, `${fileName}.webp`);
        
        try {
            // Проверяем, существует ли уже WebP версия
            if (fs.existsSync(webpPath)) {
                console.log(`⏭️  ${file} → ${fileName}.webp (уже существует)`);
                continue;
            }
            
            // Получаем размер исходного файла
            const originalStats = fs.statSync(filePath);
            const originalSize = originalStats.size;
            
            console.log(`🔄 Конвертирую ${file}...`);
            
            // Конвертируем в WebP
            await sharp(filePath)
                .resize({ height: 200, fit: 'cover', position: 'centre' })
                .webp({ quality: 85, effort: 6 })
                .toFile(webpPath);
            
            // Получаем размер нового файла
            const webpStats = fs.statSync(webpPath);
            const webpSize = webpStats.size;
            
            // Вычисляем процент сжатия
            const compressionRatio = ((originalSize - webpSize) / originalSize * 100).toFixed(1);
            
            console.log(`✅ ${file} → ${fileName}.webp`);
            console.log(`   Размер: ${formatBytes(originalSize)} → ${formatBytes(webpSize)} (сжатие: ${compressionRatio}%)\n`);
            
            convertedCount++;
            
        } catch (error) {
            console.error(`❌ Ошибка при конвертации ${file}:`, error.message);
            errorCount++;
        }
    }
    
    // Итоговая статистика
    console.log('📊 Итоговая статистика:');
    console.log(`   ✅ Успешно конвертировано: ${convertedCount}`);
    console.log(`   ❌ Ошибок: ${errorCount}`);
    console.log(`   📁 Всего файлов: ${imageFiles.length}`);
    
    if (convertedCount > 0) {
        console.log('\n💡 Рекомендации:');
        console.log('   - Проверьте качество конвертированных изображений');
        console.log('   - Обновите ссылки в базе данных на новые .webp файлы');
        console.log('   - Удалите старые файлы после проверки');
    }
}

// Запускаем конвертацию
convertImages().catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
}); 