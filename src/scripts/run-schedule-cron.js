const cron = require('node-cron');
const { createNextMonthSchedule, CRON_SETTINGS } = require('./create-next-month-schedule');

// Формируем cron-выражение
// Формат: секунды минуты часы день_месяца месяц день_недели
const cronExpression = `${CRON_SETTINGS.minute} ${CRON_SETTINGS.hour} ${CRON_SETTINGS.day} * *`;

console.log(`Настройка cron-задачи: ${cronExpression}`);

// Запускаем задачу по расписанию
cron.schedule(cronExpression, async () => {
    console.log('Запуск создания расписания на следующий месяц...');
    try {
        await createNextMonthSchedule();
    } catch (error) {
        console.error('Ошибка при создании расписания:', error);
    }
});

// Запускаем скрипт сразу при старте
console.log('Запуск создания расписания...');
createNextMonthSchedule().catch(console.error); 