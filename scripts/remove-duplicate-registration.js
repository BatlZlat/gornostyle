#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Скрипт для удаления дублированного кода регистрации...');

// Путь к файлу
const filePath = path.join(__dirname, '../src/bot/client-bot.js');

try {
    // Читаем файл
    console.log('📖 Читаем файл client-bot.js...');
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Находим границы второго дублированного блока
    console.log('🔍 Ищем дублированные блоки...');
    
    // Ищем все case блоки
    const caseMatches = [...content.matchAll(/case\s+'(\w+)':\s*\{/g)];
    console.log(`Найдено ${caseMatches.length} case блоков`);
    
    // Находим второй блок регистрации (строки примерно 2146-2413)
    let secondBlockStart = -1;
    let secondBlockEnd = -1;
    
    // Ищем второй case 'wait_start'
    const waitStartMatches = [...content.matchAll(/case\s+'wait_start':\s*\{/g)];
    if (waitStartMatches.length >= 2) {
        secondBlockStart = waitStartMatches[1].index;
        console.log(`📍 Второй блок wait_start найден на позиции ${secondBlockStart}`);
        
        // Ищем конец второго блока training_type
        const trainingTypeMatches = [...content.matchAll(/case\s+'training_type':\s*\{/g)];
        if (trainingTypeMatches.length >= 2) {
            const secondTrainingTypeStart = trainingTypeMatches[1].index;
            
            // Находим конец этого блока (следующий case или закрывающая скобка)
            let braceCount = 0;
            let inCase = false;
            let pos = secondTrainingTypeStart;
            
            while (pos < content.length) {
                const char = content[pos];
                
                if (char === '{') {
                    braceCount++;
                    inCase = true;
                } else if (char === '}') {
                    braceCount--;
                    if (inCase && braceCount === 0) {
                        // Нашли конец case блока
                        secondBlockEnd = pos + 1;
                        break;
                    }
                }
                pos++;
            }
            
            console.log(`📍 Конец второго блока найден на позиции ${secondBlockEnd}`);
        }
    }
    
    if (secondBlockStart === -1 || secondBlockEnd === -1) {
        console.log('❌ Не удалось найти границы второго блока');
        process.exit(1);
    }
    
    // Проверяем, что мы нашли правильный блок
    const blockContent = content.substring(secondBlockStart, secondBlockEnd);
    console.log(`📏 Размер блока для удаления: ${blockContent.length} символов`);
    
    // Подсчитываем строки
    const linesBefore = content.substring(0, secondBlockStart).split('\n').length;
    const linesAfter = content.substring(secondBlockEnd).split('\n').length;
    const linesToRemove = content.split('\n').length - linesBefore - linesAfter;
    
    console.log(`📊 Удаляем строки ${linesBefore + 1} - ${linesBefore + linesToRemove}`);
    
    // Создаем резервную копию
    const backupPath = filePath + '.backup.' + Date.now();
    fs.writeFileSync(backupPath, content);
    console.log(`💾 Создана резервная копия: ${backupPath}`);
    
    // Удаляем второй блок
    const newContent = content.substring(0, secondBlockStart) + content.substring(secondBlockEnd);
    
    // Записываем обновленный файл
    fs.writeFileSync(filePath, newContent);
    
    console.log('✅ Дублированный блок успешно удален!');
    console.log(`📈 Размер файла уменьшился на ${content.length - newContent.length} символов`);
    
    // Проверяем результат
    const updatedContent = fs.readFileSync(filePath, 'utf8');
    const remainingWaitStart = [...updatedContent.matchAll(/case\s+'wait_start':\s*\{/g)];
    const remainingHasChild = [...updatedContent.matchAll(/case\s+'has_child':\s*\{/g)];
    
    console.log(`🔍 Осталось блоков wait_start: ${remainingWaitStart.length}`);
    console.log(`🔍 Осталось блоков has_child: ${remainingHasChild.length}`);
    
    if (remainingWaitStart.length === 1 && remainingHasChild.length === 1) {
        console.log('🎉 Успех! Дублирование устранено.');
    } else {
        console.log('⚠️  Возможно, остались дублированные блоки. Проверьте вручную.');
    }
    
} catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
}
