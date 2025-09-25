const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

class CertificatePdfGenerator {
    constructor() {
        this.outputDir = path.join(__dirname, '../../public/generated/certificates');
        this.templateDir = path.join(__dirname, '../../public/images/certificates');
        this.browser = null;
    }

    async ensureOutputDir() {
        try {
            await fs.access(this.outputDir);
        } catch (error) {
            await fs.mkdir(this.outputDir, { recursive: true });
        }
    }

    getDesignImagePath(designId) {
        const designMap = {
            1: 'classic.jpg',
            2: 'sport.jpg', 
            3: 'party.jpg',
            4: 'minimal.jpg'
        };
        
        const fileName = designMap[designId] || 'classic.jpg';
        return path.join(this.templateDir, fileName);
    }

    async initBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
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

    async generateCertificateHTML(certificateData) {
        const { 
            certificate_number, 
            nominal_value, 
            recipient_name, 
            message, 
            expiry_date, 
            design_id 
        } = certificateData;

        // Получаем путь к изображению дизайна
        const designImagePath = this.getDesignImagePath(design_id);
        
        // Читаем изображение и конвертируем в base64
        const fs = require('fs').promises;
        let backgroundImageData = '';
        
        // Для тестирования используем простой градиент
        if (certificate_number.includes('TEST') || certificate_number.includes('test')) {
            backgroundImageData = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        } else {
            try {
                const imageBuffer = await fs.readFile(designImagePath);
                const base64Image = imageBuffer.toString('base64');
                const imageExtension = designImagePath.split('.').pop().toLowerCase();
                backgroundImageData = `data:image/${imageExtension};base64,${base64Image}`;
            } catch (error) {
                console.error('Ошибка при чтении изображения дизайна:', error);
                // Fallback к градиенту
                backgroundImageData = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            }
        }
        
        // Форматируем дату с проверкой валидности
        let formattedDate = '';
        try {
            const dateObj = new Date(expiry_date);
            if (isNaN(dateObj.getTime())) {
                console.error('❌ [PDF Generator] Неверная дата expiry_date:', expiry_date);
                formattedDate = 'Дата не указана';
            } else {
                formattedDate = dateObj.toLocaleDateString('ru-RU');
            }
        } catch (error) {
            console.error('❌ [PDF Generator] Ошибка форматирования даты:', error);
            formattedDate = 'Дата не указана';
        }

        return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Сертификат №${certificate_number}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Arial', sans-serif;
            width: 1050px;
            height: 494px;
            overflow: hidden;
        }
        
        .certificate-container {
            position: relative;
            width: 1050px;
            height: 494px;
            background-image: url('${backgroundImageData}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
        }
        
        .certificate-content {
            position: relative;
            z-index: 2;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding: 0;
        }
        
        .certificate-info {
            background: rgba(0, 0, 0, 0.67);
            color: white;
            padding: 25px;
            border-radius: 12px;
            width: 300px;
            height: 480px;
            margin-right: 30px;
            text-align: center;
            backdrop-filter: blur(8px);
            border: none;
            box-shadow: none;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        
        .certificate-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 5px;
            color: #FFFFFF;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            line-height: 1.1;
            text-shadow: none;
            font-family: Arial, sans-serif;
        }
        
        .certificate-subtitle {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 20px;
            color: #FFFFFF;
            line-height: 1.2;
            text-transform: uppercase;
            font-family: Arial, sans-serif;
        }
        
        .certificate-number {
            font-size: 28px;
            font-weight: bold;
            color: #FFD700;
            margin-bottom: 15px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            letter-spacing: 1px;
            font-family: Arial, sans-serif;
        }
        
        .certificate-amount {
            font-size: 28px;
            font-weight: bold;
            color: #FFD700;
            margin-bottom: 15px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            font-family: Arial, sans-serif;
        }
        
        .certificate-recipient {
            font-size: 14px;
            margin-bottom: 10px;
            color: #FFFFFF;
            font-weight: normal;
            font-family: Arial, sans-serif;
        }
        
        .certificate-message {
            font-size: 14px;
            font-style: italic;
            margin-bottom: 15px;
            color: #FFFFFF;
            line-height: 1.2;
            padding: 8px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            font-family: Arial, sans-serif;
        }
        
        .certificate-expiry {
            font-size: 14px;
            color: #FFFFFF;
            margin-top: 10px;
            font-weight: normal;
            font-family: Arial, sans-serif;
        }
        
        .certificate-icon {
            font-size: 20px;
            margin-right: 8px;
            color: #FFD700;
            font-weight: bold;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        }
    </style>
</head>
<body>
    <div class="certificate-container">
        <div class="certificate-content">
            <div class="certificate-info">
                <div class="certificate-title">
                    <span class="certificate-icon">🎁</span>
                    СЕРТИФИКАТ
                </div>
                <div class="certificate-subtitle">
                    НА ТРЕНИРОВКУ ПО ГОРНЫМ ЛЫЖАМ ИЛИ СНОУБОРДУ
                </div>
                
                <div class="certificate-number">
                    № ${certificate_number}
                </div>
                
                <div class="certificate-amount">
                    <span class="certificate-icon">💰</span> ${nominal_value} руб.
                </div>
                
                ${recipient_name ? `
                <div class="certificate-recipient">
                    <span class="certificate-icon">👤</span> Кому: ${recipient_name}
                </div>
                ` : ''}
                
                ${message ? `
                <div class="certificate-message">
                    "${message}"
                </div>
                ` : ''}
                
                <div class="certificate-expiry">
                    <span class="certificate-icon">⏰</span> Использовать до: ${formattedDate}
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
    }

    async generateCertificatePdf(certificateData) {
        await this.ensureOutputDir();
        
        const { certificate_number } = certificateData;
        const outputPath = path.join(this.outputDir, `certificate_${certificate_number}.pdf`);
        
        try {
            const browser = await this.initBrowser();
            const page = await browser.newPage();
            
            // Устанавливаем размер страницы точно 1050x494
            await page.setViewport({
                width: 1050,
                height: 494,
                deviceScaleFactor: 2 // Для лучшего качества
            });
            
            // Генерируем HTML
            const html = await this.generateCertificateHTML(certificateData);
            
            // Устанавливаем содержимое страницы
            await page.setContent(html, {
                waitUntil: 'networkidle0'
            });
            
            // Генерируем PDF
            const pdfBuffer = await page.pdf({
                width: '1050px',
                height: '494px',
                printBackground: true,
                margin: {
                    top: '0px',
                    right: '0px',
                    bottom: '0px',
                    left: '0px'
                }
            });
            
            // Сохраняем PDF файл
            await fs.writeFile(outputPath, pdfBuffer);
            
            await page.close();
            
            // Возвращаем относительный путь для веб-доступа
            return `/generated/certificates/certificate_${certificate_number}.pdf`;
            
        } catch (error) {
            console.error('Ошибка при генерации PDF сертификата:', error);
            throw new Error('Не удалось создать PDF сертификат');
        }
    }

    async getCertificatePdfUrl(certificateNumber) {
        const pdfPath = path.join(this.outputDir, `certificate_${certificateNumber}.pdf`);
        
        try {
            await fs.access(pdfPath);
            return `/generated/certificates/certificate_${certificateNumber}.pdf`;
        } catch (error) {
            return null; // PDF не найден
        }
    }

    async deleteCertificatePdf(certificateNumber) {
        const pdfPath = path.join(this.outputDir, `certificate_${certificateNumber}.pdf`);
        
        try {
            await fs.unlink(pdfPath);
            return true;
        } catch (error) {
            console.error('Ошибка при удалении PDF сертификата:', error);
            return false;
        }
    }

    // Метод для генерации только PDF
    async generateCertificateFiles(certificateData) {
        const pdfUrl = await this.generateCertificatePdf(certificateData);
        
        return {
            pdf_url: pdfUrl,
            image_url: null // Изображения больше не генерируем
        };
    }

    // Генерация предзаполненного изображения для дизайнов
    async generateDesignPreview(designId) {
        const certificateData = {
            certificate_number: '123456',
            nominal_value: 2500,
            recipient_name: 'Образец',
            message: 'Покупка через бота',
            expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            design_id: designId
        };

        // Генерируем HTML с предзаполненными данными для превью (424x200)
        const html = await this.generateCertificatePreviewHTML(certificateData);
        
        return html;
    }

    // Генерация HTML для превью сертификата (424x200)
    async generateCertificatePreviewHTML(certificateData) {
        const { certificate_number, nominal_value, recipient_name, message, expiry_date, design_id } = certificateData;
        
        // Форматируем дату
        let formattedDate = 'Дата не указана';
        if (expiry_date) {
            try {
                const date = new Date(expiry_date);
                if (!isNaN(date.getTime())) {
                    formattedDate = date.toLocaleDateString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });
                }
            } catch (error) {
                console.error('Ошибка при форматировании даты:', error);
            }
        }

        // Получаем путь к изображению дизайна
        const designNames = {
            1: 'classic',
            2: 'sport', 
            3: 'party',
            4: 'minimal'
        };
        const designName = designNames[design_id] || 'classic';
        const designImagePath = path.join(__dirname, '..', '..', 'public', 'images', 'certificates', `${designName}.jpg`);
        
        let backgroundImageData;
        
        // Для тестирования используем простой градиент
        if (certificate_number.includes('TEST') || certificate_number.includes('test')) {
            backgroundImageData = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        } else {
            try {
                const imageBuffer = await fs.readFile(designImagePath);
                const base64Image = imageBuffer.toString('base64');
                const imageExtension = designImagePath.split('.').pop().toLowerCase();
                backgroundImageData = `data:image/${imageExtension};base64,${base64Image}`;
            } catch (error) {
                console.error('Ошибка при чтении изображения дизайна:', error);
                // Fallback к градиенту
                backgroundImageData = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            }
        }

        return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Превью сертификата</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Arial', sans-serif;
            width: 318px;
            height: 150px;
            overflow: hidden;
        }
        
        .certificate-container {
            position: relative;
            width: 318px;
            height: 150px;
            background-image: url('${backgroundImageData}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding-right: 8px;
        }
        
        .certificate-info {
            background: rgba(0, 0, 0, 0.67);
            color: white;
            padding: 5px;
            border-radius: 4px;
            width: 91px;
            height: 140px;
            margin-right: 5px;
            text-align: center;
            backdrop-filter: blur(8px);
            border: none;
            box-shadow: none;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        
        .certificate-title {
            font-size: 6px;
            font-weight: bold;
            margin-bottom: 1px;
            color: #FFFFFF;
            text-transform: uppercase;
            letter-spacing: 0.1px;
            line-height: 1.0;
            text-shadow: none;
            font-family: Arial, sans-serif;
        }
        
        .certificate-subtitle {
            font-size: 5px;
            font-weight: bold;
            margin-bottom: 4px;
            color: #FFFFFF;
            line-height: 1.0;
            text-transform: uppercase;
            font-family: Arial, sans-serif;
        }
        
        .certificate-number {
            font-size: 8px;
            font-weight: bold;
            color: #FFD700;
            margin-bottom: 3px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            letter-spacing: 0.2px;
            font-family: Arial, sans-serif;
        }
        
        .certificate-amount {
            font-size: 8px;
            font-weight: bold;
            color: #FFD700;
            margin-bottom: 3px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            font-family: Arial, sans-serif;
        }
        
        .certificate-recipient {
            font-size: 4px;
            margin-bottom: 2px;
            color: #FFFFFF;
            font-weight: normal;
            font-family: Arial, sans-serif;
        }
        
        .certificate-message {
            font-size: 4px;
            font-style: italic;
            margin-bottom: 3px;
            color: #FFFFFF;
            line-height: 1.0;
            padding: 1px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 1px;
            font-family: Arial, sans-serif;
        }
        
        .certificate-expiry {
            font-size: 4px;
            color: #FFFFFF;
            margin-top: 2px;
            font-weight: normal;
            font-family: Arial, sans-serif;
        }
        
        .certificate-icon {
            font-size: 5px;
            margin-right: 1px;
            color: #FFD700;
            font-weight: bold;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        }
    </style>
</head>
<body>
    <div class="certificate-container">
        <div class="certificate-info">
            <div class="certificate-title">
                <span class="certificate-icon">🎁</span>
                СЕРТИФИКАТ
            </div>
            <div class="certificate-subtitle">
                НА ТРЕНИРОВКУ ПО ГОРНЫМ ЛЫЖАМ ИЛИ СНОУБОРДУ
            </div>
            <div class="certificate-number">
                <span class="certificate-icon">#</span> ${certificate_number}
            </div>
            <div class="certificate-amount">
                <span class="certificate-icon">💰</span> ${nominal_value} руб.
            </div>
            ${recipient_name ? `
            <div class="certificate-recipient">
                <span class="certificate-icon">👤</span> Кому: ${recipient_name}
            </div>
            ` : ''}
            ${message ? `
            <div class="certificate-message">
                ${message}
            </div>
            ` : ''}
            <div class="certificate-expiry">
                <span class="certificate-icon">⏰</span> Использовать до: ${formattedDate}
            </div>
        </div>
    </div>
</body>
</html>`;
    }
}

module.exports = new CertificatePdfGenerator();
