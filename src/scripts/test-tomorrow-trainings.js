const { getTomorrowTrainings } = require('./get-tomorrow-trainings');
const { notifyTomorrowTrainings } = require('../bot/admin-notify');

/**
 * Тестовый скрипт для проверки функциональности уведомлений о тренировках на завтра
 */
async function testTomorrowTrainings() {
    console.log('🧪 Начинаем тестирование функциональности уведомлений о тренировках на завтра...\n');

    try {
        // Тест 1: Получение тренировок на завтра
        console.log('📋 Тест 1: Получение тренировок на завтра...');
        const trainings = await getTomorrowTrainings();
        console.log(`✅ Получено ${trainings.length} тренировок на завтра`);
        
        if (trainings.length > 0) {
            console.log('📊 Детали тренировок:');
            trainings.forEach((training, index) => {
                console.log(`  ${index + 1}. ${training.is_individual ? 'Индивидуальная' : 'Групповая'}`);
                console.log(`     Время: ${training.start_time}`);
                console.log(`     Участники: ${training.participants_list || 'Нет'}`);
                console.log(`     Тренер: ${training.trainer_name || 'Не назначен'}`);
                console.log(`     Стоимость: ${training.price} руб.`);
                console.log('');
            });
        } else {
            console.log('ℹ️  Тренировок на завтра нет');
        }

        // Тест 2: Отправка уведомления (только если есть тренировки)
        if (trainings.length > 0) {
            console.log('📤 Тест 2: Отправка уведомления...');
            await notifyTomorrowTrainings(trainings);
            console.log('✅ Уведомление отправлено успешно');
        } else {
            console.log('⏭️  Тест 2 пропущен: нет тренировок для уведомления');
        }

        console.log('\n🎉 Все тесты завершены успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
        process.exit(1);
    }
}

// Запускаем тест
if (require.main === module) {
    testTomorrowTrainings()
        .then(() => {
            console.log('\n✅ Тестирование завершено');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Тестирование провалено:', error);
            process.exit(1);
        });
}

module.exports = { testTomorrowTrainings };
