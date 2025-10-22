const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

function getRentalCosts() {
    return {
        cost_30: parseInt(process.env.RENTAL_COST_30) || 2000,
        cost_60: parseInt(process.env.RENTAL_COST_60) || 4000
    };
}

function setRentalCosts(cost_30, cost_60) {
    const envPath = path.join(__dirname, '../../.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/RENTAL_COST_30=.*/g, 'RENTAL_COST_30=' + cost_30);
    envContent = envContent.replace(/RENTAL_COST_60=.*/g, 'RENTAL_COST_60=' + cost_60);
    if (!/RENTAL_COST_30=/.test(envContent)) envContent += `\nRENTAL_COST_30=${cost_30}`;
    if (!/RENTAL_COST_60=/.test(envContent)) envContent += `\nRENTAL_COST_60=${cost_60}`;
    fs.writeFileSync(envPath, envContent);
    process.env.RENTAL_COST_30 = cost_30;
    process.env.RENTAL_COST_60 = cost_60;
}

function padDate(dateStr) {
    // Преобразует 7.6.2025 → 07.06.2025
    const [d, m, y] = dateStr.split('.');
    return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
}

// API: получить стоимость аренды
router.get('/rental-cost', (req, res) => {
    res.json(getRentalCosts());
});

// API: изменить стоимость аренды
router.put('/rental-cost', (req, res) => {
    const { cost_30, cost_60 } = req.body;
    if (!cost_30 || !cost_60) return res.status(400).json({ error: 'Неверные значения' });
    setRentalCosts(cost_30, cost_60);
    res.json({ success: true });
});

// Получение агрегированной статистики
router.get('/statistics', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const { cost_30, cost_60 } = getRentalCosts();

        // 1. Поступившие средства на счет (refill)
        const refillResult = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as total 
             FROM transactions 
             WHERE type='refill' 
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const refillIncome = parseFloat(refillResult.rows[0].total);

        // 2. Доход от групповых тренировок (без возвратов по совпадению даты и времени, с учётом формата даты)
        // ВАЖНО: учитываем только тренировки с участниками
        const groupPayments = await pool.query(
            `SELECT t.id, t.amount, t.description, t.created_at, ts.session_date, ts.start_time, ts.duration
             FROM transactions t
             JOIN training_sessions ts ON 
                ts.session_date = TO_DATE(SPLIT_PART(SPLIT_PART(t.description, 'Дата: ', 2), ',', 1), 'DD.MM.YYYY')
                AND ts.start_time = SPLIT_PART(SPLIT_PART(t.description, 'Время: ', 2), ',', 1)::time
             WHERE t.type='payment'
             AND t.description LIKE '%Групповая%'
             AND t.created_at BETWEEN $1 AND $2
             AND ((ts.session_date + ts.start_time)::timestamp + (ts.duration || ' minutes')::interval <= (NOW() AT TIME ZONE 'Asia/Yekaterinburg'))
             AND EXISTS (
                 SELECT 1 FROM session_participants sp 
                 WHERE sp.session_id = ts.id AND sp.status = 'confirmed'
             )`,
            [start_date, end_date]
        );
        let groupIncome = 0;
        // Для отладки
        let debugGroupIncome = [];
        for (const payment of groupPayments.rows) {
            // Извлекаем ФИО, дату и время из description оплаты
            const fioMatch = payment.description.match(/Групповая, (.*?), Дата:/);
            const match = payment.description.match(/Дата:\s*(\d{1,2}\.\d{1,2}\.\d{4}),\s*Время:\s*([0-9:]+)/);
            if (!fioMatch || !match) {
                debugGroupIncome.push({id: payment.id, reason: 'no_fio_or_date_in_description', description: payment.description});
                continue;
            }
            const fio = fioMatch[1].trim();
            const dateStr = match[1];
            const timeStr = match[2];
            const paddedDate = padDate(dateStr);
            // Ищем возврат по ФИО, дате и времени (оба формата даты), допускаем любые символы перед ФИО
            const refundResult = await pool.query(
                `SELECT id, description FROM transactions
                 WHERE type='amount'
                 AND (
                     description LIKE $1 OR description LIKE $2
                 )
                 AND created_at BETWEEN $3 AND $4`,
                [
                    `%${fio}%, Дата: ${dateStr}, Время: ${timeStr}%`,
                    `%${fio}%, Дата: ${paddedDate}, Время: ${timeStr}%`,
                    start_date, end_date
                ]
            );
            let refundFound = false;
            for (const refund of refundResult.rows) {
                refundFound = true;
                debugGroupIncome.push({id: payment.id, reason: 'refund_found', paymentDesc: payment.description, refundDesc: refund.description});
                break;
            }
            if (!refundFound) {
                groupIncome += parseFloat(payment.amount);
                debugGroupIncome.push({id: payment.id, reason: 'income_counted', description: payment.description});
            }
        }
        // Для отладки: можно вернуть debugGroupIncome в ответе API или залогировать
        // console.log('DEBUG groupIncome:', debugGroupIncome);

        // 3. Доход от индивидуальных тренировок (без возвратов)
        const individualPayments = await pool.query(
            `SELECT t.id, t.amount, t.description, t.created_at, its.preferred_date, its.preferred_time, its.duration
             FROM transactions t
             JOIN individual_training_sessions its ON 
                its.preferred_date = TO_DATE(SPLIT_PART(SPLIT_PART(t.description, 'Дата: ', 2), ',', 1), 'DD.MM.YYYY')
                AND its.preferred_time = SPLIT_PART(SPLIT_PART(t.description, 'Время: ', 2), ',', 1)::time
             WHERE t.type='payment'
             AND t.description LIKE '%Индивидуальная%'
             AND t.created_at BETWEEN $1 AND $2
             AND ((its.preferred_date + its.preferred_time)::timestamp + (its.duration || ' minutes')::interval <= (NOW() AT TIME ZONE 'Asia/Yekaterinburg'))`,
            [start_date, end_date]
        );
        let individualIncome = 0;
        for (const payment of individualPayments.rows) {
            const match = payment.description.match(/Дата: (\d{1,2}\.\d{1,2}\.\d{4}), Время: ([0-9:]+)/);
            if (!match) continue;
            const dateStr = match[1];
            const timeStr = match[2];
            const paddedDate = padDate(dateStr);
            const refund = await pool.query(
                `SELECT 1 FROM transactions
                 WHERE type='amount'
                 AND (
                     description LIKE $1 OR description LIKE $2
                 )
                 AND created_at BETWEEN $3 AND $4
                 LIMIT 1`,
                [
                    `%Дата: ${dateStr}, Время: ${timeStr}%`,
                    `%Дата: ${paddedDate}, Время: ${timeStr}%`,
                    start_date, end_date
                ]
            );
            if (refund.rows.length === 0) {
                individualIncome += parseFloat(payment.amount);
            }
        }

        // 4. Общий доход от тренировок (без возвратов)
        const totalIncome = groupIncome + individualIncome;

        // 5. Расходы с групповых тренировок (только если есть участники)
        const groupExpensesResult = await pool.query(
            `SELECT COUNT(*) as count
             FROM training_sessions ts
             WHERE ts.session_date BETWEEN $1 AND $2
             AND ts.training_type = TRUE
             AND EXISTS (
                 SELECT 1 FROM session_participants sp 
                 WHERE sp.session_id = ts.id AND sp.status = 'confirmed'
             )
             AND ((ts.session_date + ts.start_time)::timestamp + (ts.duration || ' minutes')::interval <= (NOW() AT TIME ZONE 'Asia/Yekaterinburg'))`,
            [start_date, end_date]
        );
        const groupExpenses = groupExpensesResult.rows[0].count * cost_60;

        // 6. Расходы с индивидуальных тренировок
        const individualExpensesResult = await pool.query(
            `SELECT 
                COUNT(CASE WHEN duration = 30 THEN 1 END) as count_30,
                COUNT(CASE WHEN duration = 60 THEN 1 END) as count_60
             FROM individual_training_sessions 
             WHERE preferred_date BETWEEN $1 AND $2
             AND ((preferred_date + preferred_time)::timestamp + (duration || ' minutes')::interval <= (NOW() AT TIME ZONE 'Asia/Yekaterinburg'))`,
            [start_date, end_date]
        );
        const individualExpenses = 
            (individualExpensesResult.rows[0].count_30 * cost_30) + 
            (individualExpensesResult.rows[0].count_60 * cost_60);

        // 7. Расходы на ЗП тренеров (только approved и paid)
        const trainerSalaryResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM trainer_payments
             WHERE status IN ('approved', 'paid')
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const trainerSalaryExpenses = parseFloat(trainerSalaryResult.rows[0].total);

        // 8. Общие расходы (аренда + ЗП тренеров)
        const totalExpenses = groupExpenses + individualExpenses + trainerSalaryExpenses;

        // 9. Прибыль с групповых тренировок (без учета ЗП тренеров - они учтены в общих расходах)
        const groupProfit = groupIncome - groupExpenses;

        // 10. Прибыль с индивидуальных тренировок (без учета ЗП тренеров - они учтены в общих расходах)
        const individualProfit = individualIncome - individualExpenses;

        // 11. Общая прибыль (доход минус все расходы включая ЗП тренеров)
        const totalProfit = totalIncome - totalExpenses;

        // 12. Количество тренировок
        const groupSessions = parseInt(groupExpensesResult.rows[0].count);
        const individualSessions30 = parseInt(individualExpensesResult.rows[0].count_30);
        const individualSessions60 = parseInt(individualExpensesResult.rows[0].count_60);

        // Формируем итоговый ответ
        res.json({
            refill_income: refillIncome,
            group_income: groupIncome,
            individual_income: individualIncome,
            total_income: totalIncome,
            group_expenses: groupExpenses,
            individual_expenses: individualExpenses,
            trainer_salary_expenses: trainerSalaryExpenses,
            total_expenses: totalExpenses,
            group_profit: groupProfit,
            individual_profit: individualProfit,
            total_profit: totalProfit,
            stats: {
                group_sessions: groupSessions,
                individual_sessions_30: individualSessions30,
                individual_sessions_60: individualSessions60
            },
            debugGroupIncome
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка при получении статистики' });
    }
});

// Список транзакций за период
router.get('/', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const tx = await pool.query(
            `SELECT id, type, amount, created_at, description FROM transactions WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC`,
            [start_date, end_date]
        );
        res.json(tx.rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка при получении транзакций' });
    }
});

// Экспорт в Excel (полный отчёт)
router.get('/export', async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        const { cost_30, cost_60 } = getRentalCosts();
        const workbook = new ExcelJS.Workbook();

        // 1. Сводная статистика (всегда включается)
        const statSheet = workbook.addWorksheet('Статистика');
        // --- Собираем статистику (аналогично /statistics) ---
        // Получаем все нужные показатели
        // 1. Поступившие средства на счет (refill)
        const refillResult = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as total 
             FROM transactions 
             WHERE type='refill' 
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const refillIncome = parseFloat(refillResult.rows[0].total);

        // 2. Доход от групповых тренировок (без возвратов)
        const groupPayments = await pool.query(
            `SELECT t.id, t.amount, t.description, t.created_at, ts.session_date, ts.start_time, ts.duration
             FROM transactions t
             JOIN training_sessions ts ON 
                ts.session_date = TO_DATE(SPLIT_PART(SPLIT_PART(t.description, 'Дата: ', 2), ',', 1), 'DD.MM.YYYY')
                AND ts.start_time = SPLIT_PART(SPLIT_PART(t.description, 'Время: ', 2), ',', 1)::time
             WHERE t.type='payment'
             AND t.description LIKE '%Групповая%'
             AND t.created_at BETWEEN $1 AND $2
             AND ((ts.session_date + ts.start_time)::timestamp + (ts.duration || ' minutes')::interval <= (NOW() AT TIME ZONE 'Asia/Yekaterinburg'))`,
            [start_date, end_date]
        );
        let groupIncome = 0;
        // Для отладки
        let debugGroupIncome = [];
        for (const payment of groupPayments.rows) {
            // Извлекаем ФИО, дату и время из description оплаты
            const fioMatch = payment.description.match(/Групповая, (.*?), Дата:/);
            const match = payment.description.match(/Дата:\s*(\d{1,2}\.\d{1,2}\.\d{4}),\s*Время:\s*([0-9:]+)/);
            if (!fioMatch || !match) {
                debugGroupIncome.push({id: payment.id, reason: 'no_fio_or_date_in_description', description: payment.description});
                continue;
            }
            const fio = fioMatch[1].trim();
            const dateStr = match[1];
            const timeStr = match[2];
            const paddedDate = padDate(dateStr);
            // Ищем возврат по ФИО, дате и времени (оба формата даты), допускаем любые символы перед ФИО
            const refundResult = await pool.query(
                `SELECT id, description FROM transactions
                 WHERE type='amount'
                 AND (
                     description LIKE $1 OR description LIKE $2
                 )
                 AND created_at BETWEEN $3 AND $4`,
                [
                    `%${fio}%, Дата: ${dateStr}, Время: ${timeStr}%`,
                    `%${fio}%, Дата: ${paddedDate}, Время: ${timeStr}%`,
                    start_date, end_date
                ]
            );
            let refundFound = false;
            for (const refund of refundResult.rows) {
                refundFound = true;
                debugGroupIncome.push({id: payment.id, reason: 'refund_found', paymentDesc: payment.description, refundDesc: refund.description});
                break;
            }
            if (!refundFound) {
                groupIncome += parseFloat(payment.amount);
                debugGroupIncome.push({id: payment.id, reason: 'income_counted', description: payment.description});
            }
        }
        // Для отладки: можно вернуть debugGroupIncome в ответе API или залогировать
        // console.log('DEBUG groupIncome:', debugGroupIncome);

        // 3. Доход от индивидуальных тренировок (без возвратов)
        const individualPayments = await pool.query(
            `SELECT t.id, t.amount, t.description, t.created_at, its.preferred_date, its.preferred_time, its.duration
             FROM transactions t
             JOIN individual_training_sessions its ON 
                its.preferred_date = TO_DATE(SPLIT_PART(SPLIT_PART(t.description, 'Дата: ', 2), ',', 1), 'DD.MM.YYYY')
                AND its.preferred_time = SPLIT_PART(SPLIT_PART(t.description, 'Время: ', 2), ',', 1)::time
             WHERE t.type='payment'
             AND t.description LIKE '%Индивидуальная%'
             AND t.created_at BETWEEN $1 AND $2
             AND ((its.preferred_date + its.preferred_time)::timestamp + (its.duration || ' minutes')::interval <= (NOW() AT TIME ZONE 'Asia/Yekaterinburg'))`,
            [start_date, end_date]
        );
        let individualIncome = 0;
        for (const payment of individualPayments.rows) {
            const match = payment.description.match(/Дата: (\d{1,2}\.\d{1,2}\.\d{4}), Время: ([0-9:]+)/);
            if (!match) continue;
            const dateStr = match[1];
            const timeStr = match[2];
            const paddedDate = padDate(dateStr);
            const refund = await pool.query(
                `SELECT 1 FROM transactions
                 WHERE type='amount'
                 AND (
                     description LIKE $1 OR description LIKE $2
                 )
                 AND created_at BETWEEN $3 AND $4
                 LIMIT 1`,
                [
                    `%Дата: ${dateStr}, Время: ${timeStr}%`,
                    `%Дата: ${paddedDate}, Время: ${timeStr}%`,
                    start_date, end_date
                ]
            );
            if (refund.rows.length === 0) {
                individualIncome += parseFloat(payment.amount);
            }
        }

        // 4. Общий доход от тренировок (без возвратов)
        const totalIncome = groupIncome + individualIncome;

        // 5. Расходы с групповых тренировок (только если есть участники)
        const groupExpensesResult = await pool.query(
            `SELECT COUNT(*) as count
             FROM training_sessions ts
             WHERE ts.session_date BETWEEN $1 AND $2
             AND ts.training_type = TRUE
             AND EXISTS (
                 SELECT 1 FROM session_participants sp 
                 WHERE sp.session_id = ts.id AND sp.status = 'confirmed'
             )
             AND ((ts.session_date + ts.start_time)::timestamp + (ts.duration || ' minutes')::interval <= (NOW() AT TIME ZONE 'Asia/Yekaterinburg'))`,
            [start_date, end_date]
        );
        const groupExpenses = groupExpensesResult.rows[0].count * cost_60;

        // 6. Расходы с индивидуальных тренировок
        const individualExpensesResult = await pool.query(
            `SELECT 
                COUNT(CASE WHEN duration = 30 THEN 1 END) as count_30,
                COUNT(CASE WHEN duration = 60 THEN 1 END) as count_60
             FROM individual_training_sessions 
             WHERE preferred_date BETWEEN $1 AND $2
             AND ((preferred_date + preferred_time)::timestamp + (duration || ' minutes')::interval <= (NOW() AT TIME ZONE 'Asia/Yekaterinburg'))`,
            [start_date, end_date]
        );
        const individualExpenses = 
            (individualExpensesResult.rows[0].count_30 * cost_30) + 
            (individualExpensesResult.rows[0].count_60 * cost_60);

        // 7. Расходы на ЗП тренеров (только approved и paid)
        const trainerSalaryResult = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM trainer_payments
             WHERE status IN ('approved', 'paid')
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const trainerSalaryExpenses = parseFloat(trainerSalaryResult.rows[0].total);

        // 8. Общие расходы (аренда + ЗП тренеров)
        const totalExpenses = groupExpenses + individualExpenses + trainerSalaryExpenses;

        // 9. Прибыль с групповых тренировок (без учета ЗП тренеров - они учтены в общих расходах)
        const groupProfit = groupIncome - groupExpenses;

        // 10. Прибыль с индивидуальных тренировок (без учета ЗП тренеров - они учтены в общих расходах)
        const individualProfit = individualIncome - individualExpenses;

        // 11. Общая прибыль (доход минус все расходы включая ЗП тренеров)
        const totalProfit = totalIncome - totalExpenses;

        // 12. Количество тренировок
        const groupSessions = parseInt(groupExpensesResult.rows[0].count);
        const individualSessions30 = parseInt(individualExpensesResult.rows[0].count_30);
        const individualSessions60 = parseInt(individualExpensesResult.rows[0].count_60);

        statSheet.addRow(['Период', `${start_date} — ${end_date}`]);
        statSheet.addRow(['Показатель', 'Значение']);
        statSheet.addRow(['Групповых тренировок', groupSessions]);
        statSheet.addRow(['Индивидуальных 30 мин', individualSessions30]);
        statSheet.addRow(['Индивидуальных 60 мин', individualSessions60]);
        statSheet.addRow(['Доходы от групповых', groupIncome]);
        statSheet.addRow(['Доходы от индивидуальных', individualIncome]);
        statSheet.addRow(['Общие доходы', totalIncome]);
        statSheet.addRow(['Расходы на групповые (аренда)', groupExpenses]);
        statSheet.addRow(['Расходы на индивидуальные (аренда)', individualExpenses]);
        statSheet.addRow(['Расходы на ЗП инструкторов', trainerSalaryExpenses]);
        statSheet.addRow(['Общие расходы', totalExpenses]);
        statSheet.addRow(['Прибыль от групповых', groupProfit]);
        statSheet.addRow(['Прибыль от индивидуальных', individualProfit]);
        statSheet.addRow(['Общая прибыль', totalProfit]);

        // Детальные листы только для полного отчёта
        if (type !== 'summary') {
            // 2. Участники групповых тренировок
            const groupSheet = workbook.addWorksheet('Групповые тренировки');
        groupSheet.addRow(['ФИО участника', 'Дата', 'Время начала', 'Стоимость', 'Телефон']);
        const groupParticipants = await pool.query(`
            SELECT c.full_name, ts.session_date, ts.start_time, ts.price, c.phone
            FROM session_participants sp
            JOIN training_sessions ts ON sp.session_id = ts.id
            JOIN clients c ON sp.client_id = c.id
            WHERE ts.training_type = TRUE
              AND sp.status = 'confirmed'
              AND ts.session_date BETWEEN $1 AND $2
            ORDER BY ts.session_date, ts.start_time
        `, [start_date, end_date]);
        for (const row of groupParticipants.rows) {
            groupSheet.addRow([
                row.full_name,
                row.session_date ? row.session_date.toLocaleDateString('ru-RU') : '',
                row.start_time ? row.start_time.slice(0,5) : '',
                row.price,
                row.phone
            ]);
        }

        // 3. Участники индивидуальных тренировок
        const indSheet = workbook.addWorksheet('Индивидуальные тренировки');
        indSheet.addRow(['ФИО участника', 'Дата', 'Время начала', 'Длительность', 'Стоимость', 'Телефон']);
        const indParticipants = await pool.query(`
            SELECT c.full_name, its.preferred_date, its.preferred_time, its.duration, its.price, c.phone
            FROM individual_training_sessions its
            JOIN clients c ON its.client_id = c.id
            WHERE its.preferred_date BETWEEN $1 AND $2
            ORDER BY its.preferred_date, its.preferred_time
        `, [start_date, end_date]);
        for (const row of indParticipants.rows) {
            indSheet.addRow([
                row.full_name,
                row.preferred_date ? row.preferred_date.toLocaleDateString('ru-RU') : '',
                row.preferred_time ? row.preferred_time.slice(0,5) : '',
                row.duration,
                row.price,
                row.phone
            ]);
        }

        // 4. Транзакции
        const txSheet = workbook.addWorksheet('Транзакции');
        txSheet.addRow(['ID', 'Тип', 'Сумма', 'Дата/время', 'Описание']);
        const txList = await pool.query(
            `SELECT id, type, amount, created_at, description FROM transactions WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC`,
            [start_date, end_date]
        );
        for (const tx of txList.rows) {
            txSheet.addRow([
                tx.id,
                tx.type,
                tx.amount,
                tx.created_at ? tx.created_at.toLocaleString('ru-RU') : '',
                tx.description || ''
            ]);
        }

        // 5. Тренеры
        const trainersSheet = workbook.addWorksheet('Тренеры');
        trainersSheet.addRow(['ФИО', 'Групповых тренировок', 'Индивидуальных тренировок', 'Общий доход']);
        const trainersStats = await pool.query(`
            SELECT t.full_name,
                COALESCE(g.count, 0) as group_count,
                COALESCE(i.count, 0) as ind_count,
                COALESCE(g.income, 0) + COALESCE(i.income, 0) as total_income
            FROM trainers t
            LEFT JOIN (
                SELECT trainer_id, COUNT(*) as count, SUM(ts.price) as income
                FROM training_sessions ts
                WHERE ts.training_type = TRUE
                  AND ts.session_date BETWEEN $1 AND $2
                  AND EXISTS (
                      SELECT 1 FROM session_participants sp 
                      WHERE sp.session_id = ts.id AND sp.status = 'confirmed'
                  )
                GROUP BY trainer_id
            ) g ON t.id = g.trainer_id
            LEFT JOIN (
                SELECT trainer_id, COUNT(*) as count, SUM(ts.price) as income
                FROM training_sessions ts
                WHERE ts.training_type = FALSE
                  AND ts.session_date BETWEEN $1 AND $2
                GROUP BY trainer_id
            ) i ON t.id = i.trainer_id
            ORDER BY t.full_name
        `, [start_date, end_date]);
        for (const row of trainersStats.rows) {
            trainersSheet.addRow([
                row.full_name,
                row.group_count,
                row.ind_count,
                row.total_income
            ]);
        }

        // 6. Клиенты-лидеры
        const leadersSheet = workbook.addWorksheet('Клиенты-лидеры');
        leadersSheet.addRow(['ФИО', 'Кол-во тренировок', 'Сумма оплат']);
        // TODO: добавить реальные данные

        // 7. Ошибки платежей
        const failedSheet = workbook.addWorksheet('Ошибки платежей');
        failedSheet.addRow(['Сумма', 'Причина', 'Дата']);
        const failedPayments = await pool.query(`
            SELECT amount, error_type, created_at
            FROM failed_payments
            WHERE created_at BETWEEN $1 AND $2
            ORDER BY created_at DESC
        `, [start_date, end_date]);
        for (const row of failedPayments.rows) {
            failedSheet.addRow([
                row.amount,
                row.error_type,
                row.created_at ? row.created_at.toLocaleString('ru-RU') : ''
            ]);
        }

        // 8. Остатки по балансу
        const balanceSheet = workbook.addWorksheet('Баланс клиентов');
        balanceSheet.addRow(['ФИО', 'Баланс']);
        const balances = await pool.query(`
            SELECT c.full_name, w.balance
            FROM clients c
            LEFT JOIN wallets w ON c.id = w.client_id
            ORDER BY c.full_name
        `);
        for (const row of balances.rows) {
            balanceSheet.addRow([
                row.full_name,
                row.balance
            ]);
        }
        } // Закрываем условие if (type !== 'summary')

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="finance-report-${start_date}-${end_date}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка при экспорте' });
    }
});

// Пополнение кошелька клиента администратором
router.post('/refill-wallet', async (req, res) => {
    const client = pool;
    
    try {
        const { client_id, amount, comment } = req.body;
        
        if (!client_id || !amount) {
            return res.status(400).json({ 
                success: false, 
                message: 'Не указан клиент или сумма пополнения' 
            });
        }
        
        if (amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Сумма пополнения должна быть больше нуля' 
            });
        }

        // Начинаем транзакцию
        await client.query('BEGIN');

        // Получаем информацию о клиенте для проверки дублирования
        const clientQuery = `
            SELECT c.id, c.full_name, w.id as wallet_id, w.balance, w.wallet_number
            FROM clients c
            LEFT JOIN wallets w ON c.id = w.client_id
            WHERE c.id = $1
        `;
        const clientResult = await client.query(clientQuery, [client_id]);
        
        if (clientResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false, 
                message: 'Клиент не найден' 
            });
        }
        
        const clientData = clientResult.rows[0];
        
        // Проверяем, нет ли недавних идентичных транзакций (защита от дублирования)
        const checkDescription = comment ? `Пополнение администратором - ${clientData.full_name}: ${comment}` : `Пополнение администратором - ${clientData.full_name}`;
        const recentTransactionQuery = `
            SELECT t.id 
            FROM transactions t
            JOIN wallets w ON t.wallet_id = w.id
            WHERE w.client_id = $1 
            AND t.amount = $2 
            AND t.type = 'refill' 
            AND t.description = $3
            AND t.created_at > (CURRENT_TIMESTAMP - INTERVAL '10 seconds')
        `;
        const recentTransaction = await client.query(recentTransactionQuery, [client_id, amount, checkDescription]);
        
        if (recentTransaction.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                message: 'Дублирующая транзакция. Пополнение уже было выполнено недавно.' 
            });
        }
        let walletId = clientData.wallet_id;
        let currentBalance = parseFloat(clientData.balance) || 0;
        
        // Если у клиента нет кошелька, создаем его
        if (!walletId) {
            // Генерируем уникальный номер кошелька
            let walletNumber;
            let isUnique = false;
            let attempts = 0;
            
            while (!isUnique && attempts < 10) {
                walletNumber = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
                const checkQuery = 'SELECT id FROM wallets WHERE wallet_number = $1';
                const checkResult = await client.query(checkQuery, [walletNumber]);
                isUnique = checkResult.rows.length === 0;
                attempts++;
            }
            
            if (!isUnique) {
                await client.query('ROLLBACK');
                return res.status(500).json({ 
                    success: false, 
                    message: 'Не удалось сгенерировать уникальный номер кошелька' 
                });
            }
            
            // Создаем кошелек
            const createWalletQuery = `
                INSERT INTO wallets (client_id, balance, wallet_number, last_updated)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                RETURNING id
            `;
            const walletResult = await client.query(createWalletQuery, [client_id, amount, walletNumber]);
            walletId = walletResult.rows[0].id;
            currentBalance = 0;
        } else {
            // Обновляем баланс существующего кошелька
            const updateWalletQuery = `
                UPDATE wallets 
                SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP
                WHERE id = $2
            `;
            await client.query(updateWalletQuery, [amount, walletId]);
        }
        
        // Создаем запись о транзакции
        const description = comment ? `Пополнение администратором - ${clientData.full_name}: ${comment}` : `Пополнение администратором - ${clientData.full_name}`;
        const transactionQuery = `
            INSERT INTO transactions (wallet_id, amount, type, description, created_at)
            VALUES ($1, $2, 'refill', $3, CURRENT_TIMESTAMP)
            RETURNING id
        `;
        const transactionResult = await client.query(transactionQuery, [walletId, amount, description]);
        
        // Получаем обновленный баланс
        const balanceQuery = 'SELECT balance, wallet_number FROM wallets WHERE id = $1';
        const balanceResult = await client.query(balanceQuery, [walletId]);
        const newBalance = parseFloat(balanceResult.rows[0].balance);
        const walletNumber = balanceResult.rows[0].wallet_number;
        
        // Фиксируем транзакцию
        await client.query('COMMIT');
        
        // Обновляем реферальный статус при пополнении
        try {
            const { updateReferralStatusOnDeposit } = require('../services/referral-service');
            await updateReferralStatusOnDeposit(client_id, amount);
        } catch (error) {
            console.error('❌ Ошибка при обновлении реферального статуса:', error);
            // Не прерываем основной процесс при ошибке в реферальной системе
        }
        
        // Отправляем уведомление в админ-бот
        try {
            const adminBot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
            
            let adminMessage = `✅ <b>Пополнение кошелька АДМИНИСТРАТОРОМ!</b>`;
            
            // Добавляем комментарий, если он есть
            if (comment && comment.trim()) {
                adminMessage += `\n💬 <b>Комментарий:</b> ${comment.trim()}`;
            }
            
            adminMessage += `

👤 <b>Клиент:</b> ${clientData.full_name}
💳 <b>Кошелек:</b> ${walletNumber}
💰 <b>Сумма пополнения:</b> ${amount} руб.
💵 <b>Итоговый баланс:</b> ${newBalance} руб.`;

            // Отправляем уведомление в группу администраторов
            if (process.env.ADMIN_CHAT_ID) {
                await adminBot.sendMessage(process.env.ADMIN_CHAT_ID, adminMessage, { parse_mode: 'HTML' });
            }
        } catch (botError) {
            console.error('Ошибка при отправке уведомления в админ-бот:', botError);
            // Не возвращаем ошибку, так как основная операция успешна
        }
        
        // Отправляем уведомление клиенту
        try {
            console.log(`[DEBUG] Попытка отправить уведомление клиенту с ID: ${client_id}`);
            
            // Получаем telegram_id клиента (используем pool, так как транзакция уже завершена)
            const clientTelegramResult = await pool.query(
                'SELECT telegram_id, full_name FROM clients WHERE id = $1',
                [client_id]
            );
            
            console.log(`[DEBUG] Результат запроса telegram_id:`, clientTelegramResult.rows);
            
            if (clientTelegramResult.rows.length === 0) {
                console.log(`[DEBUG] Клиент с ID ${client_id} не найден в базе данных`);
                return;
            }
            
            const clientTelegramId = clientTelegramResult.rows[0].telegram_id;
            const clientFullName = clientTelegramResult.rows[0].full_name;
            
            if (!clientTelegramId) {
                console.log(`[DEBUG] У клиента ${clientFullName} (ID: ${client_id}) нет telegram_id`);
                return;
            }
            
            console.log(`[DEBUG] Отправляем уведомление клиенту ${clientFullName} (telegram_id: ${clientTelegramId})`);
            
            const clientBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
            
            let clientMessage = `🎉 <b>Поздравляем!</b>\nПополнение кошелька на ${amount} руб.`;
            
            // Добавляем комментарий администратора, если есть
            if (comment && comment.trim()) {
                clientMessage += `\n\n📝 <b>Комментарий от администратора:</b>\n${comment.trim()}`;
            }
            
            clientMessage += `

💳 <b>Кошелек:</b> ${walletNumber}
💰 <b>Сумма пополнения:</b> ${amount} руб.
💵 <b>Итоговый баланс:</b> ${newBalance} руб.`;

            console.log(`[DEBUG] Текст сообщения для клиента: ${clientMessage}`);
            console.log(`[DEBUG] Используемый токен бота: ${process.env.TELEGRAM_BOT_TOKEN ? 'Токен установлен' : 'Токен НЕ установлен'}`);

            const result = await clientBot.sendMessage(clientTelegramId, clientMessage, { parse_mode: 'HTML' });
            console.log(`[DEBUG] Уведомление клиенту отправлено успешно:`, result);
            
        } catch (clientBotError) {
            console.error('[ERROR] Ошибка при отправке уведомления клиенту:', clientBotError);
            console.error('[ERROR] Детали ошибки:', {
                name: clientBotError.name,
                message: clientBotError.message,
                code: clientBotError.code,
                response: clientBotError.response?.body
            });
            // Не возвращаем ошибку, так как основная операция успешна
        }
        
        res.json({
            success: true,
            message: 'Кошелек успешно пополнен',
            transaction_id: transactionResult.rows[0].id,
            new_balance: newBalance,
            client_name: clientData.full_name,
            wallet_number: walletNumber
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при пополнении кошелька:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Внутренняя ошибка сервера при пополнении кошелька' 
        });
    }
});

module.exports = router; 