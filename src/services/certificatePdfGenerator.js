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
            height: 495px;
            overflow: hidden;
        }
        
        .certificate-container {
            position: relative;
            width: 1050px;
            height: 495px;
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
            padding: 30px;
            border-radius: 12px;
            width: 300px;
            height: 440px;
            margin-right: 30px;
            text-align: center;
            backdrop-filter: blur(8px);
            border: none;
            box-shadow: none;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        
        .certificate-title {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 0;
            color: #FFFFFF;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            line-height: 1.2;
            text-shadow: none;
        }
        
        .certificate-subtitle {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 50px;
            color: #FFFFFF;
            line-height: 1.3;
            text-transform: uppercase;
        }
        
        .certificate-number {
            font-size: 32px;
            font-weight: bold;
            color: #FFD700;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            letter-spacing: 1px;
        }
        
        .certificate-amount {
            font-size: 32px;
            font-weight: bold;
            color: #FFD700;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        .certificate-recipient {
            font-size: 16px;
            margin-bottom: 15px;
            color: #FFFFFF;
            font-weight: normal;
        }
        
        .certificate-message {
            font-size: 16px;
            font-style: italic;
            margin-bottom: 20px;
            color: #FFFFFF;
            line-height: 1.3;
            padding: 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 6px;
        }
        
        .certificate-expiry {
            font-size: 16px;
            color: #FFFFFF;
            margin-top: 20px;
            font-weight: normal;
        }
        
        .certificate-icon {
            font-size: 18px;
            margin-right: 6px;
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
                    💰 ${nominal_value} руб.
                </div>
                
                ${recipient_name ? `
                <div class="certificate-recipient">
                    👤 Кому: ${recipient_name}
                </div>
                ` : ''}
                
                ${message ? `
                <div class="certificate-message">
                    "${message}"
                </div>
                ` : ''}
                
                <div class="certificate-expiry">
                    ⏰ Использовать до: ${formattedDate}
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
            
            // Устанавливаем размер страницы точно 1050x495
            await page.setViewport({
                width: 1050,
                height: 495,
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
                height: '495px',
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

    // Метод для генерации как PDF, так и изображения
    async generateCertificateFiles(certificateData) {
        const pdfUrl = await this.generateCertificatePdf(certificateData);
        
        // Также генерируем изображение для совместимости
        const imageGenerator = require('./certificateImageGenerator');
        const imageUrl = await imageGenerator.generateCertificateImage(certificateData);
        
        return {
            pdf_url: pdfUrl,
            image_url: imageUrl
        };
    }
}

module.exports = new CertificatePdfGenerator();
