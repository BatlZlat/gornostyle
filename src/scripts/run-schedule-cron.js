const cron = require('node-cron');
const { createNextMonthSchedule, CRON_SETTINGS } = require('./create-next-month-schedule');

// Формируем cron-выражение
// Формат: секунды минуты часы день_месяца месяц день_недели
const cronExpression = `0 ${CRON_SETTINGS.minute} ${CRON_SETTINGS.hour} ${CRON_SETTINGS.day} * *`;

console.log('=== Настройка cron-задачи ===');
console.log('Текущие настройки:', CRON_SETTINGS);
console.log('Cron-выражение:', cronExpression);
console.log('Текущее время:', new Date().toLocaleString('ru-RU'));

// Запускаем задачу по расписанию
const task = cron.schedule(cronExpression, async () => {
    console.log('\n=== Запуск создания расписания на следующий месяц ===');
    console.log('Время запуска:', new Date().toLocaleString('ru-RU'));
    try {
        await createNextMonthSchedule();
        console.log('Расписание успешно создано');
    } catch (error) {
        console.error('Ошибка при создании расписания:', error);
    }
});

// Запускаем скрипт сразу при старте
console.log('\n=== Запуск создания расписания ===');
console.log('Время запуска:', new Date().toLocaleString('ru-RU'));
createNextMonthSchedule()
    .then(() => console.log('Расписание успешно создано'))
    .catch(console.error);

// Обработка завершения процесса
process.on('SIGINT', () => {
    console.log('\n=== Остановка cron-задачи ===');
    task.stop();
    process.exit(0);
}); 