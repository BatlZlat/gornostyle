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

        // 2. Доход от групповых тренировок
        const groupIncomeResult = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as total 
             FROM transactions 
             WHERE type='payment' 
             AND description LIKE '%Группа%'
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const groupIncome = parseFloat(groupIncomeResult.rows[0].total);

        // 3. Доход от индивидуальных тренировок
        const individualIncomeResult = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as total 
             FROM transactions 
             WHERE type='payment' 
             AND description LIKE '%Индивидуальная%'
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const individualIncome = parseFloat(individualIncomeResult.rows[0].total);

        // 4. Общий доход от тренировок
        const totalIncomeResult = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as total 
             FROM transactions 
             WHERE type='payment' 
             AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const totalIncome = parseFloat(totalIncomeResult.rows[0].total);

        // 5. Расходы с групповых тренировок
        const groupExpensesResult = await pool.query(
            `SELECT COUNT(*) as count
             FROM training_sessions 
             WHERE session_date BETWEEN $1 AND $2
             AND (
                 session_date < (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                 OR (
                     session_date = (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                     AND end_time <= (CURRENT_TIME AT TIME ZONE 'Asia/Yekaterinburg')
                 )
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
                group_sessions: parseInt(groupExpensesResult.rows[0].count),
                individual_sessions_30: parseInt(individualExpensesResult.rows[0].count_30),
                individual_sessions_60: parseInt(individualExpensesResult.rows[0].count_60)
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

// Экспорт в Excel (только summary)
router.get('/export', async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        const { cost_30, cost_60 } = getRentalCosts();
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Финансы');
        // Получаем прибыль по индивидуальным
        const indProfitRes = await pool.query(`
            SELECT COALESCE(SUM(price),0) as total
            FROM individual_training_sessions
            WHERE preferred_date BETWEEN $1 AND $2
              AND (
                preferred_date < (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                OR (
                  preferred_date = (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                  AND preferred_time <= (CURRENT_TIME AT TIME ZONE 'Asia/Yekaterinburg')
                )
              )
        `, [start_date, end_date]);
        const indProfit = parseFloat(indProfitRes.rows[0].total);
        // Расходы
        const expRes = await pool.query(`
            WITH completed_sessions AS (
                SELECT duration FROM training_sessions WHERE session_date BETWEEN $1 AND $2 AND status='completed'
                UNION ALL
                SELECT duration FROM individual_training_sessions WHERE preferred_date BETWEEN $1 AND $2
                  AND (
                    preferred_date < (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                    OR (
                      preferred_date = (CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg')
                      AND preferred_time <= (CURRENT_TIME AT TIME ZONE 'Asia/Yekaterinburg')
                    )
                  )
            )
            SELECT 
                COALESCE(SUM(CASE WHEN duration=60 THEN $3 WHEN duration=30 THEN $4 ELSE 0 END),0) as expenses,
                COUNT(*) as total_sessions,
                COUNT(CASE WHEN duration=30 THEN 1 END) as sessions_30min,
                COUNT(CASE WHEN duration=60 THEN 1 END) as sessions_60min
            FROM completed_sessions
        `, [start_date, end_date, cost_60, cost_30]);
        const expenses = parseFloat(expRes.rows[0].expenses);
        // Заполняем Excel
        sheet.addRow(['Период', `${start_date} — ${end_date}`]);
        sheet.addRow(['Доходы', indProfit]);
        sheet.addRow(['Расходы', expenses]);
        sheet.addRow(['Прибыль', indProfit - expenses]);
        sheet.addRow(['Всего тренировок', expRes.rows[0].total_sessions]);
        sheet.addRow(['30-минутных', expRes.rows[0].sessions_30min]);
        sheet.addRow(['60-минутных', expRes.rows[0].sessions_60min]);
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