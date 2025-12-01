/**
 * Скрипт для проверки всех уведомлений на корректное упоминание мест проведения
 * (Кулига и Воронинские горки)
 * 
 * Использование:
 * node scripts/check-notifications-location.js
 */

const fs = require('fs');
const path = require('path');

const NOTIFICATION_FILES = [
    'src/bot/admin-notify.js',
    'src/bot/client-bot.js',
    'src/services/notification-service.js',
];

const LOCATION_PATTERNS = {
    hardcodedKuliga: [
        /Кулига Парк/gi,
        /в Кулига Парк/gi,
        /на Кулига Парк/gi,
    ],
    shouldBeDynamic: [
        /🏔️.*Место.*Кулига Парк/gi,
        /Место.*Кулига Парк/gi,
    ]
};

const LOCATION_NAMES = {
    'kuliga': 'База отдыха «Кулига-Клуб»',
    'vorona': 'Воронинские горки'
};

function checkFile(filePath) {
    const fullPath = path.join(process.cwd(), filePath);
    
    if (!fs.existsSync(fullPath)) {
        console.log(`⚠️  Файл не найден: ${filePath}`);
        return { found: false, issues: [] };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const issues = [];

    // Проверяем хардкод "Кулига Парк"
    LOCATION_PATTERNS.hardcodedKuliga.forEach((pattern, index) => {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            const lineContent = content.split('\n')[lineNumber - 1].trim();
            
            // Пропускаем комментарии и уже исправленные места
            if (lineContent.startsWith('//') || 
                lineContent.includes('locationNames') ||
                lineContent.includes('getLocationName') ||
                lineContent.includes('locationName')) {
                continue;
            }

            issues.push({
                type: 'hardcoded_kuliga',
                line: lineNumber,
                content: lineContent,
                match: match[0]
            });
        }
    });

    // Проверяем места, которые должны быть динамическими
    LOCATION_PATTERNS.shouldBeDynamic.forEach((pattern) => {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            const lineContent = content.split('\n')[lineNumber - 1].trim();
            
            // Проверяем, используется ли location из данных
            const context = content.substring(Math.max(0, match.index - 200), match.index + 200);
            const hasLocationVariable = context.includes('location') || 
                                       context.includes('locationName') ||
                                       context.includes('locationNames');

            if (!hasLocationVariable) {
                issues.push({
                    type: 'should_be_dynamic',
                    line: lineNumber,
                    content: lineContent,
                    match: match[0]
                });
            }
        }
    });

    return { found: true, issues };
}

function main() {
    console.log('🔍 ПРОВЕРКА УВЕДОМЛЕНИЙ НА УПОМИНАНИЕ МЕСТ\n');
    console.log('='.repeat(60));

    let totalIssues = 0;

    NOTIFICATION_FILES.forEach(filePath => {
        console.log(`\n📄 Проверка файла: ${filePath}`);
        console.log('-'.repeat(60));

        const result = checkFile(filePath);

        if (!result.found) {
            return;
        }

        if (result.issues.length === 0) {
            console.log('✅ Проблем не обнаружено');
        } else {
            console.log(`⚠️  Найдено проблем: ${result.issues.length}\n`);

            result.issues.forEach((issue, index) => {
                console.log(`${index + 1}. Строка ${issue.line}:`);
                console.log(`   Тип: ${issue.type}`);
                console.log(`   Содержимое: ${issue.content}`);
                console.log(`   Найдено: "${issue.match}"`);
                console.log('');
                totalIssues++;
            });
        }
    });

    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 ИТОГО: Найдено проблем: ${totalIssues}\n`);

    if (totalIssues === 0) {
        console.log('🎉 Все уведомления используют динамические названия мест!\n');
    } else {
        console.log('⚠️  Требуется обновление уведомлений для поддержки обоих мест\n');
    }
}

if (require.main === module) {
    main();
}

module.exports = { checkFile };

