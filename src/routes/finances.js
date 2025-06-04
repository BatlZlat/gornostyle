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
        // Доходы (refill)
        const incomeResult = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='refill' AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const income = parseFloat(incomeResult.rows[0].total);
        // Прибыль по индивидуальным тренировкам (сумма price)
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
        // Расходы (по прошедшим тренировкам)
        const expensesResult = await pool.query(`
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
                COALESCE(SUM(CASE WHEN duration=60 THEN $3 WHEN duration=30 THEN $4 ELSE 0 END),0) as total_expenses,
                COUNT(*) as total_sessions,
                COUNT(CASE WHEN duration=30 THEN 1 END) as sessions_30min,
                COUNT(CASE WHEN duration=60 THEN 1 END) as sessions_60min
            FROM completed_sessions
        `, [start_date, end_date, cost_60, cost_30]);
        const expenses = parseFloat(expensesResult.rows[0].total_expenses);
        const stats = {
            total_sessions: parseInt(expensesResult.rows[0].total_sessions),
            sessions_30min: parseInt(expensesResult.rows[0].sessions_30min),
            sessions_60min: parseInt(expensesResult.rows[0].sessions_60min)
        };
        // Средняя дневная прибыль и лучший день
        const dailyProfitResult = await pool.query(`
            WITH daily_stats AS (
                SELECT DATE(created_at) as date, SUM(CASE WHEN type='refill' THEN amount ELSE 0 END) as daily_income
                FROM transactions WHERE created_at BETWEEN $1 AND $2 GROUP BY DATE(created_at)
            )
            SELECT COALESCE(AVG(daily_income),0) as avg_daily_profit,
                (SELECT date FROM daily_stats ORDER BY daily_income DESC LIMIT 1) as best_day,
                (SELECT daily_income FROM daily_stats ORDER BY daily_income DESC LIMIT 1) as best_day_profit
            FROM daily_stats
        `, [start_date, end_date]);
        stats.avg_daily_profit = parseFloat(dailyProfitResult.rows[0].avg_daily_profit);
        stats.best_day = dailyProfitResult.rows[0].best_day;
        stats.best_day_profit = parseFloat(dailyProfitResult.rows[0].best_day_profit);
        // Итоговая прибыль: сумма price индивидуальных минус расходы
        res.json({
            income,
            expenses,
            profit: indProfit - expenses,
            stats,
            rental_cost: { cost_30, cost_60 }
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