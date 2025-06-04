const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const ExcelJS = require('exceljs');

// Получение агрегированной статистики
router.get('/statistics', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        // Доходы (refill)
        const incomeResult = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='refill' AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const income = parseFloat(incomeResult.rows[0].total);
        // Расходы (только по прошедшим тренировкам)
        const expensesResult = await pool.query(`
            WITH completed_sessions AS (
                SELECT duration FROM training_sessions WHERE session_date BETWEEN $1 AND $2 AND status='completed'
                UNION ALL
                SELECT duration FROM individual_training_sessions WHERE preferred_date BETWEEN $1 AND $2
            )
            SELECT 
                COALESCE(SUM(CASE WHEN duration=60 THEN 4000 WHEN duration=30 THEN 2000 ELSE 0 END),0) as total_expenses,
                COUNT(*) as total_sessions,
                COUNT(CASE WHEN duration=30 THEN 1 END) as sessions_30min,
                COUNT(CASE WHEN duration=60 THEN 1 END) as sessions_60min
            FROM completed_sessions
        `, [start_date, end_date]);
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
        res.json({
            income,
            expenses,
            profit: income - expenses,
            stats
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
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Финансы');
        // Получаем статистику
        const statRes = await pool.query(
            `SELECT COALESCE(SUM(amount),0) as income FROM transactions WHERE type='refill' AND created_at BETWEEN $1 AND $2`,
            [start_date, end_date]
        );
        const income = parseFloat(statRes.rows[0].income);
        const expRes = await pool.query(`
            WITH completed_sessions AS (
                SELECT duration FROM training_sessions WHERE session_date BETWEEN $1 AND $2 AND status='completed'
                UNION ALL
                SELECT duration FROM individual_training_sessions WHERE preferred_date BETWEEN $1 AND $2
            )
            SELECT 
                COALESCE(SUM(CASE WHEN duration=60 THEN 4000 WHEN duration=30 THEN 2000 ELSE 0 END),0) as expenses,
                COUNT(*) as total_sessions,
                COUNT(CASE WHEN duration=30 THEN 1 END) as sessions_30min,
                COUNT(CASE WHEN duration=60 THEN 1 END) as sessions_60min
            FROM completed_sessions
        `, [start_date, end_date]);
        const expenses = parseFloat(expRes.rows[0].expenses);
        // Заполняем Excel
        sheet.addRow(['Период', `${start_date} — ${end_date}`]);
        sheet.addRow(['Доходы', income]);
        sheet.addRow(['Расходы', expenses]);
        sheet.addRow(['Прибыль', income - expenses]);
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