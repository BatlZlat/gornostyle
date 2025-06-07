const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
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
        const groupPayments = await pool.query(
            `SELECT id, amount, description, created_at FROM transactions
             WHERE type='payment'
             AND description LIKE '%Группа%'
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        let groupIncome = 0;
        for (const payment of groupPayments.rows) {
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
                groupIncome += parseFloat(payment.amount);
            }
        }

        // 3. Доход от индивидуальных тренировок (без возвратов по совпадению даты и времени, с учётом формата даты)
        const individualPayments = await pool.query(
            `SELECT id, amount, description, created_at FROM transactions
             WHERE type='payment'
             AND description LIKE '%Индивидуальная%'
             AND created_at BETWEEN $1 AND $2`,
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
             AND (
                 ts.session_date < (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                 OR (
                     ts.session_date = (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                     AND ts.end_time <= (CURRENT_TIME AT TIME ZONE 'Asia/Yekaterinburg')
                 )
             )
             AND ts.training_type = TRUE
             AND EXISTS (
                 SELECT 1 FROM session_participants sp WHERE sp.session_id = ts.id
             )`,
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
             AND (
                 preferred_date < (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                 OR (
                     preferred_date = (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                     AND (preferred_time + (duration || ' minutes')::interval) <= (CURRENT_TIME AT TIME ZONE 'Asia/Yekaterinburg')
                 )
             )`,
            [start_date, end_date]
        );
        const individualExpenses = 
            (individualExpensesResult.rows[0].count_30 * cost_30) + 
            (individualExpensesResult.rows[0].count_60 * cost_60);

        // 7. Общие расходы
        const totalExpenses = groupExpenses + individualExpenses;

        // 8. Прибыль с групповых тренировок
        const groupProfit = groupIncome - groupExpenses;

        // 9. Прибыль с индивидуальных тренировок
        const individualProfit = individualIncome - individualExpenses;

        // 10. Общая прибыль
        const totalProfit = groupProfit + individualProfit;

        // 11. Количество тренировок
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
            total_expenses: totalExpenses,
            group_profit: groupProfit,
            individual_profit: individualProfit,
            total_profit: totalProfit,
            stats: {
                group_sessions: groupSessions,
                individual_sessions_30: individualSessions30,
                individual_sessions_60: individualSessions60
            }
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

        // 1. Сводная статистика
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
            `SELECT id, amount, description, created_at FROM transactions
             WHERE type='payment'
             AND description LIKE '%Группа%'
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        let groupIncome = 0;
        for (const payment of groupPayments.rows) {
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
                groupIncome += parseFloat(payment.amount);
            }
        }

        // 3. Доход от индивидуальных тренировок (без возвратов)
        const individualPayments = await pool.query(
            `SELECT id, amount, description, created_at FROM transactions
             WHERE type='payment'
             AND description LIKE '%Индивидуальная%'
             AND created_at BETWEEN $1 AND $2`,
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
             AND (
                 ts.session_date < (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                 OR (
                     ts.session_date = (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                     AND ts.end_time <= (CURRENT_TIME AT TIME ZONE 'Asia/Yekaterinburg')
                 )
             )
             AND ts.training_type = TRUE
             AND EXISTS (
                 SELECT 1 FROM session_participants sp WHERE sp.session_id = ts.id
             )`,
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
             AND (
                 preferred_date < (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                 OR (
                     preferred_date = (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                     AND (preferred_time + (duration || ' minutes')::interval) <= (CURRENT_TIME AT TIME ZONE 'Asia/Yekaterinburg')
                 )
             )`,
            [start_date, end_date]
        );
        const individualExpenses = 
            (individualExpensesResult.rows[0].count_30 * cost_30) + 
            (individualExpensesResult.rows[0].count_60 * cost_60);

        // 7. Общие расходы
        const totalExpenses = groupExpenses + individualExpenses;

        // 8. Прибыль с групповых тренировок
        const groupProfit = groupIncome - groupExpenses;

        // 9. Прибыль с индивидуальных тренировок
        const individualProfit = individualIncome - individualExpenses;

        // 10. Общая прибыль
        const totalProfit = groupProfit + individualProfit;

        // 11. Количество тренировок
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
        statSheet.addRow(['Расходы на групповые', groupExpenses]);
        statSheet.addRow(['Расходы на индивидуальные', individualExpenses]);
        statSheet.addRow(['Общие расходы', totalExpenses]);
        statSheet.addRow(['Прибыль от групповых', groupProfit]);
        statSheet.addRow(['Прибыль от индивидуальных', individualProfit]);
        statSheet.addRow(['Общая прибыль', totalProfit]);

        // 2. Участники групповых тренировок
        const groupSheet = workbook.addWorksheet('Групповые тренировки');
        groupSheet.addRow(['ФИО участника', 'Дата', 'Время начала', 'Стоимость', 'Телефон']);
        const groupParticipants = await pool.query(`
            SELECT c.full_name, ts.session_date, ts.start_time, ts.price, c.phone
            FROM session_participants sp
            JOIN training_sessions ts ON sp.session_id = ts.id
            JOIN clients c ON sp.client_id = c.id
            WHERE ts.training_type = TRUE
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

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="finance-report-${start_date}-${end_date}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка при экспорте' });
    }
});

module.exports = router; 