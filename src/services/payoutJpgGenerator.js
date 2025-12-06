const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

class PayoutJpgGenerator {
    constructor() {
        this.outputDir = path.join(__dirname, '../../public/generated/payouts');
        this.browser = null;
    }

    async ensureOutputDir() {
        try {
            await fs.access(this.outputDir);
        } catch (error) {
            await fs.mkdir(this.outputDir, { recursive: true });
        }
    }

    async initBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--font-render-hinting=none',
                    '--disable-gpu-sandbox',
                    '--disable-dev-shm-usage',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ]
            });
        }
        return this.browser;
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    generatePayoutHTML(payoutData) {
        const {
            payout_id,
            instructor_name,
            period_start,
            period_end,
            trainings_count,
            individual_trainings,
            group_trainings,
            total_revenue,
            admin_commission,
            instructor_earnings,
            admin_percentage,
            created_at
        } = payoutData;

        // Форматируем даты
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return date.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        };

        const formatCurrency = (amount) => {
            return parseFloat(amount || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        };

        return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Платежка №${payout_id}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Arial', 'Helvetica', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        
        .payout-container {
            background: white;
            width: 800px;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        }
        
        .payout-header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 3px solid #667eea;
            padding-bottom: 20px;
        }
        
        .payout-title {
            font-size: 32px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
        }
        
        .payout-subtitle {
            font-size: 18px;
            color: #666;
        }
        
        .payout-number {
            font-size: 24px;
            color: #667eea;
            font-weight: bold;
            margin-top: 10px;
        }
        
        .payout-section {
            margin-bottom: 25px;
        }
        
        .section-title {
            font-size: 20px;
            font-weight: bold;
            color: #333;
            margin-bottom: 15px;
            border-left: 4px solid #667eea;
            padding-left: 10px;
        }
        
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid #eee;
        }
        
        .info-label {
            font-weight: 600;
            color: #555;
            font-size: 16px;
        }
        
        .info-value {
            color: #333;
            font-size: 16px;
            text-align: right;
        }
        
        .info-value.amount {
            font-size: 20px;
            font-weight: bold;
            color: #27ae60;
        }
        
        .info-value.period {
            color: #667eea;
            font-weight: 600;
        }
        
        .payout-summary {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-top: 20px;
        }
        
        .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            font-size: 18px;
        }
        
        .summary-label {
            font-weight: 600;
            color: #333;
        }
        
        .summary-value {
            font-weight: bold;
            color: #27ae60;
            font-size: 24px;
        }
        
        .payout-footer {
            margin-top: 30px;
            text-align: center;
            color: #666;
            font-size: 14px;
            border-top: 2px solid #eee;
            padding-top: 20px;
        }
        
        .company-name {
            font-weight: bold;
            color: #333;
            font-size: 16px;
            margin-bottom: 5px;
        }
    </style>
</head>
<body>
    <div class="payout-container">
        <div class="payout-header">
            <div class="payout-title">ПЛАТЕЖНОЕ ПОРУЧЕНИЕ</div>
            <div class="payout-subtitle">на выплату заработной платы</div>
            <div class="payout-number">№ ${payout_id}</div>
        </div>
        
        <div class="payout-section">
            <div class="section-title">Информация об инструкторе</div>
            <div class="info-row">
                <span class="info-label">Инструктор:</span>
                <span class="info-value">${instructor_name || 'Не указан'}</span>
            </div>
        </div>
        
        <div class="payout-section">
            <div class="section-title">Период выплаты</div>
            <div class="info-row">
                <span class="info-label">С:</span>
                <span class="info-value period">${formatDate(period_start)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">По:</span>
                <span class="info-value period">${formatDate(period_end)}</span>
            </div>
        </div>
        
        <div class="payout-section">
            <div class="section-title">Статистика тренировок</div>
            <div class="info-row">
                <span class="info-label">Всего тренировок:</span>
                <span class="info-value">${trainings_count || 0}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Индивидуальных:</span>
                <span class="info-value">${individual_trainings || 0}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Групповых:</span>
                <span class="info-value">${group_trainings || 0}</span>
            </div>
        </div>
        
        <div class="payout-section">
            <div class="section-title">Финансовые показатели</div>
            <div class="info-row">
                <span class="info-label">Общая выручка:</span>
                <span class="info-value amount">${formatCurrency(total_revenue)} ₽</span>
            </div>
            <div class="info-row">
                <span class="info-label">Комиссия администратора (${admin_percentage || 20}%):</span>
                <span class="info-value">${formatCurrency(admin_commission)} ₽</span>
            </div>
        </div>
        
        <div class="payout-summary">
            <div class="summary-row">
                <span class="summary-label">К выплате:</span>
                <span class="summary-value">${formatCurrency(instructor_earnings)} ₽</span>
            </div>
        </div>
        
        <div class="payout-footer">
            <div class="company-name">Служба инструкторов Горностайл72</div>
            <div>Дата формирования: ${formatDate(created_at)}</div>
        </div>
    </div>
</body>
</html>`;
    }

    async generatePayoutJpg(payoutData) {
        await this.ensureOutputDir();
        
        const payoutId = payoutData.payout_id || payoutData.id;
        const outputPath = path.join(this.outputDir, `payout_${payoutId}.jpg`);
        
        try {
            const html = this.generatePayoutHTML(payoutData);
            
            await this.initBrowser();
            const page = await this.browser.newPage();
            
            await page.setViewport({
                width: 800,
                height: 1200,
                deviceScaleFactor: 2
            });
            
            await page.setContent(html, {
                waitUntil: 'networkidle0'
            });
            
            // Ждем загрузки всех элементов
            await page.waitForSelector('.payout-container', { timeout: 10000 });
            
            const container = await page.$('.payout-container');
            if (!container) {
                throw new Error('Не удалось найти .payout-container');
            }
            
            await container.screenshot({
                path: outputPath,
                type: 'jpeg',
                quality: 90
            });
            
            await page.close();
            
            console.log(`✅ JPG платежка создана: ${outputPath}`);
            
            return `/generated/payouts/payout_${payoutId}.jpg`;
            
        } catch (error) {
            console.error('Ошибка при генерации JPG платежки:', error);
            throw new Error(`Не удалось создать JPG платежку: ${error.message}`);
        }
    }
}

module.exports = new PayoutJpgGenerator();

