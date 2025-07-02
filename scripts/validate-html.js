#!/usr/bin/env node

/**
 * Простой валидатор HTML
 * Проверяет основные ошибки в HTML файлах
 */

const fs = require('fs');
const path = require('path');

const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function validateHTML(content, filename) {
    const errors = [];
    const warnings = [];
    
    // Проверяем основные ошибки
    const checks = [
        {
            name: 'Открытые теги',
            regex: /<([a-z][a-z0-9]*)[^>]*>/gi,
            closingRegex: /<\/([a-z][a-z0-9]*)>/gi,
            check: (matches, closingMatches) => {
                const openTags = matches.map(m => m.match(/<([a-z][a-z0-9]*)/i)[1].toLowerCase());
                const closeTags = closingMatches.map(m => m.match(/<\/([a-z][a-z0-9]*)/i)[1].toLowerCase());
                
                // Проверяем самозакрывающиеся теги
                const selfClosing = ['img', 'br', 'hr', 'input', 'meta', 'link'];
                const filteredOpenTags = openTags.filter(tag => !selfClosing.includes(tag));
                
                // Считаем теги
                const tagCount = {};
                filteredOpenTags.forEach(tag => {
                    tagCount[tag] = (tagCount[tag] || 0) + 1;
                });
                
                closeTags.forEach(tag => {
                    tagCount[tag] = (tagCount[tag] || 0) - 1;
                });
                
                // Проверяем несбалансированные теги
                Object.entries(tagCount).forEach(([tag, count]) => {
                    if (count > 0) {
                        errors.push(`Незакрытый тег: <${tag}> (${count} раз)`);
                    } else if (count < 0) {
                        errors.push(`Лишний закрывающий тег: </${tag}> (${Math.abs(count)} раз)`);
                    }
                });
            }
        },
        {
            name: 'Атрибуты alt для изображений',
            regex: /<img[^>]*>/gi,
            check: (matches) => {
                matches.forEach((match, index) => {
                    if (!match.includes('alt=')) {
                        warnings.push(`Изображение #${index + 1} без атрибута alt`);
                    }
                });
            }
        },
        {
            name: 'Дублирующиеся ID',
            regex: /id=["']([^"']+)["']/gi,
            check: (matches) => {
                const ids = matches.map(m => m.match(/id=["']([^"']+)["']/i)[1]);
                const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
                if (duplicates.length > 0) {
                    errors.push(`Дублирующиеся ID: ${[...new Set(duplicates)].join(', ')}`);
                }
            }
        },
        {
            name: 'Правильная структура DOCTYPE',
            check: () => {
                if (!content.includes('<!DOCTYPE html>')) {
                    errors.push('Отсутствует DOCTYPE');
                }
            }
        },
        {
            name: 'Кодировка UTF-8',
            check: () => {
                if (!content.includes('charset="UTF-8"') && !content.includes("charset='UTF-8'")) {
                    warnings.push('Рекомендуется указать кодировку UTF-8');
                }
            }
        },
        {
            name: 'Viewport meta tag',
            check: () => {
                if (!content.includes('viewport')) {
                    warnings.push('Рекомендуется добавить viewport meta tag для мобильных устройств');
                }
            }
        }
    ];
    
    checks.forEach(check => {
        if (check.regex) {
            const matches = content.match(check.regex) || [];
            if (check.closingRegex) {
                const closingMatches = content.match(check.closingRegex) || [];
                check.check(matches, closingMatches);
            } else {
                check.check(matches);
            }
        } else {
            check.check();
        }
    });
    
    return { errors, warnings };
}

function main() {
    log('🔍 Начинаем валидацию HTML...', 'blue');
    log('');
    
    const files = [
        'views/index.ejs',
        'views/prices.ejs',
        'views/schedule.ejs'
    ];
    
    let totalErrors = 0;
    let totalWarnings = 0;
    
    files.forEach(file => {
        log(`📄 Проверяем: ${file}`, 'blue');
        
        try {
            const content = fs.readFileSync(file, 'utf8');
            const result = validateHTML(content, file);
            
            if (result.errors.length === 0 && result.warnings.length === 0) {
                log(`  ✅ Файл валиден`, 'green');
            } else {
                if (result.errors.length > 0) {
                    log(`  ❌ Ошибки (${result.errors.length}):`, 'red');
                    result.errors.forEach(error => {
                        log(`    - ${error}`, 'red');
                    });
                    totalErrors += result.errors.length;
                }
                
                if (result.warnings.length > 0) {
                    log(`  ⚠️ Предупреждения (${result.warnings.length}):`, 'yellow');
                    result.warnings.forEach(warning => {
                        log(`    - ${warning}`, 'yellow');
                    });
                    totalWarnings += result.warnings.length;
                }
            }
        } catch (error) {
            log(`  ❌ Ошибка чтения файла: ${error.message}`, 'red');
            totalErrors++;
        }
        
        log('');
    });
    
    // Итоговая статистика
    log('📊 Итоговая статистика:', 'blue');
    log(`  Всего ошибок: ${totalErrors}`, totalErrors === 0 ? 'green' : 'red');
    log(`  Всего предупреждений: ${totalWarnings}`, totalWarnings === 0 ? 'green' : 'yellow');
    
    if (totalErrors === 0) {
        log('✅ HTML валидация пройдена успешно!', 'green');
    } else {
        log('❌ Обнаружены ошибки в HTML', 'red');
    }
    
    log('');
    log('💡 Рекомендации:', 'yellow');
    log('1. Исправьте все найденные ошибки');
    log('2. Рассмотрите предупреждения для улучшения качества кода');
    log('3. Используйте онлайн валидатор W3C для более детальной проверки');
    log('4. Проверьте доступность (accessibility) сайта');
}

if (require.main === module) {
    main();
}

module.exports = { validateHTML }; 