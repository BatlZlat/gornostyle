const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

class CertificateJpgGenerator {
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
                    '--disable-renderer-backgrounding',
                    '--lang=ru-RU,ru,en-US,en'
                ],
                env: {
                    ...process.env,
                    FONTCONFIG_FILE: '/etc/fonts/fonts.conf',
                    FONTCONFIG_PATH: '/etc/fonts'
                }
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
        
        :root {
            color-scheme: only light;
        }
        
        body {
            font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Arial', sans-serif;
            background: radial-gradient(circle at top, rgba(13, 27, 42, 0.95), rgba(13, 27, 42, 0.82));
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px 10px;
            overflow: auto;
            --certificate-scale: clamp(0.3, calc(100vw / 1050), 1);
        }
        
        .certificate-viewport {
            position: relative;
            width: calc(1050px * var(--certificate-scale));
            height: calc(494px * var(--certificate-scale));
            max-width: 100%;
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
        }
        
        .certificate-container {
            position: absolute;
            inset: 0;
            width: 1050px;
            height: 494px;
            transform: scale(var(--certificate-scale));
            transform-origin: top left;
            background-image: url('${backgroundImageData}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
        }
        
        @media (max-height: 620px) {
            body {
                align-items: flex-start;
            }
            .certificate-viewport {
                margin-top: 20px;
            }
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
            background: rgba(0, 0, 0, 0.75);
            color: white;
            padding: 25px 20px;
            border-radius: 12px;
            width: 280px;
            height: auto;
            min-height: 420px;
            max-height: 450px;
            margin-right: 25px;
            text-align: center;
            backdrop-filter: blur(10px);
            border: 2px solid rgba(255, 215, 0, 0.3);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 20px;
        }
        
        .certificate-title {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 6px;
            color: #FFFFFF;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            line-height: 1.2;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.6);
            font-family: 'Segoe UI', 'Arial', sans-serif;
        }
        
        .certificate-subtitle {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 20px;
            color: #E0E0E0;
            line-height: 1.3;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            font-family: 'Segoe UI', 'Arial', sans-serif;
        }
        
        .certificate-number {
            font-size: 22px;
            font-weight: 700;
            color: #FFD700;
            margin: 12px 0;
            text-shadow: 2px 2px 6px rgba(0,0,0,0.7);
            letter-spacing: 1.5px;
            font-family: 'Courier New', monospace;
        }
        
        .certificate-amount {
            font-size: 42px;
            font-weight: 900;
            color: #FFD700;
            margin: 15px 0 8px 0;
            text-shadow: 3px 3px 8px rgba(0,0,0,0.8);
            line-height: 1;
            font-family: 'Arial Black', 'Arial', sans-serif;
            letter-spacing: -1px;
        }
        
        .certificate-amount-label {
            font-size: 18px;
            font-weight: 600;
            color: #FFFFFF;
            margin-bottom: 15px;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.6);
        }
        
        .certificate-recipient {
            font-size: 15px;
            margin: 10px 0;
            color: #FFFFFF;
            font-weight: 600;
            line-height: 1.3;
            font-family: 'Segoe UI', 'Arial', sans-serif;
        }
        
        .certificate-message {
            font-size: 14px;
            font-style: italic;
            margin: 12px 0;
            color: #F0F0F0;
            line-height: 1.4;
            padding: 10px;
            background: rgba(255, 255, 255, 0.12);
            border-radius: 6px;
            border-left: 3px solid #FFD700;
            font-family: 'Georgia', 'Times New Roman', serif;
        }
        
        .certificate-expiry {
            font-size: 14px;
            color: #E0E0E0;
            margin-top: 15px;
            font-weight: 500;
            line-height: 1.3;
            font-family: 'Segoe UI', 'Arial', sans-serif;
        }
        
        .certificate-icon {
            font-size: 24px;
            margin-right: 8px;
            color: #FFD700;
            font-weight: bold;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.6);
            vertical-align: middle;
            font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif;
        }
    </style>
</head>
<body>
    <div class="certificate-viewport">
        <div class="certificate-container">
            <div class="certificate-content">
                <div class="certificate-info">
                    <div>
                        <div class="certificate-title">
                            <span class="certificate-icon">🎁</span>
                            СЕРТИФИКАТ
                        </div>
                        <div class="certificate-subtitle">
                            НА ТРЕНИРОВКУ ПО ГОРНЫМ<br>ЛЫЖАМ ИЛИ СНОУБОРДУ
                        </div>
                    </div>
                    
                    <div>
                        <div class="certificate-number">
                            № ${certificate_number}
                        </div>
                        
                        <div class="certificate-amount">
                            ${nominal_value}
                        </div>
                        <div class="certificate-amount-label">рублей</div>
                    </div>
                    
                    <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0;">
                        ${recipient_name ? `
                        <div class="certificate-recipient">
                            <strong>Кому:</strong><br>${recipient_name}
                        </div>
                        ` : ''}
                        
                        ${message ? `
                        <div class="certificate-message">
                            ${message}
                        </div>
                        ` : ''}
                    </div>
                    
                    <div class="certificate-expiry">
                        <strong>Действителен до:</strong><br>
                        <span style="color: #FFD700; font-weight: 600;">${formattedDate}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
    }

    async generateCertificatePreview(certificateData) {
        const html = await this.generateCertificateHTML(certificateData);

        await this.initBrowser();
        const page = await this.browser.newPage();

        await page.setViewport({
            width: 1050,
            height: 495,
            deviceScaleFactor: 2
        });

        await page.setContent(html, {
            waitUntil: 'networkidle0'
        });

        await page.addStyleTag({
            content: `
                :root {
                    --certificate-scale: 1 !important;
                }
                body {
                    background: transparent !important;
                    padding: 0 !important;
                }
                .certificate-viewport {
                    width: 1050px !important;
                    height: 494px !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                    background: transparent !important;
                }
            `
        });

        const element = await page.$('.certificate-viewport');
        if (!element) {
            await page.close();
            throw new Error('Не удалось найти .certificate-viewport для генерации предпросмотра');
        }

        const base64 = await element.screenshot({
            type: 'jpeg',
            quality: 90,
            encoding: 'base64'
        });

        await page.close();

        return {
            html,
            imageBase64: base64
        };
    }

    // PDF генерация удалена - используем только JPG

    // PDF методы удалены - используем только JPG

    // Генерация JPG из веб-страницы сертификата
    async generateCertificateJpgFromWeb(certificateNumber) {
        await this.ensureOutputDir();
        
        const outputPath = path.join(this.outputDir, `certificate_${certificateNumber}.jpg`);
        
        try {
            await this.initBrowser();
            const page = await this.browser.newPage();
            
            // Настраиваем viewport для сертификата (1050x495)
            await page.setViewport({
                width: 1050,
                height: 495,
                deviceScaleFactor: 2 // Для лучшего качества
            });
            
            // URL веб-страницы сертификата
            const certificateUrl = `${process.env.BASE_URL || 'http://localhost:8080'}/certificate/${certificateNumber}`;
            
            console.log(`📸 Генерируем JPG для сертификата ${certificateNumber} с URL: ${certificateUrl}`);
            
            // Дополнительные настройки для лучшего рендеринга эмодзи и цветов
            await page.evaluateOnNewDocument(() => {
                // Устанавливаем кодировку UTF-8
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['ru', 'en']
                });
                
                // Добавляем поддержку эмодзи и принудительное применение цветов
                const style = document.createElement('style');
                style.textContent = `
                    * {
                        -webkit-font-feature-settings: 'liga' 1, 'kern' 1;
                        font-feature-settings: 'liga' 1, 'kern' 1;
                        text-rendering: optimizeLegibility;
                        -webkit-print-color-adjust: exact !important;
                        color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    
                    .certificate-number {
                        color: #FFD700 !important;
                        font-family: 'Courier New', monospace !important;
                    }
                    
                    .certificate-amount {
                        color: #FFD700 !important;
                    }
                    
                    .certificate-value {
                        color: #FFD700 !important;
                        font-weight: 700 !important;
                        font-family: 'Courier New', monospace, 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'EmojiOne' !important;
                    }
                    
                    .certificate-value * {
                        color: #FFD700 !important;
                        font-weight: 700 !important;
                        font-family: 'Courier New', monospace, 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'EmojiOne' !important;
                    }
                    
                    .certificate-expiry {
                        color: #FFFFFF !important;
                    }
                    
                    /* Поддержка эмодзи как fallback для элементов с эмодзи */
                    .certificate-title, .info-label {
                        font-family: 'Segoe UI', 'Arial', sans-serif, 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'EmojiOne' !important;
                    }
                `;
                document.head.appendChild(style);
            });
            
            // Переходим на страницу сертификата
            await page.goto(certificateUrl, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });
            
            // Ждем загрузки всех элементов
            console.log('🔍 Ждем загрузки .certificate-container...');
            await page.waitForSelector('.certificate-container', { timeout: 30000 });
            console.log('✅ Элемент .certificate-container найден');
            
            // Делаем скриншот только контейнера сертификата
            const certificateElement = await page.$('.certificate-container');
            if (!certificateElement) {
                throw new Error('Не найден элемент .certificate-container');
            }
            
            // Делаем скриншот элемента
            await certificateElement.screenshot({
                path: outputPath,
                type: 'jpeg',
                quality: 90
            });
            
            await page.close();
            
            console.log(`✅ JPG сертификат создан: ${outputPath}`);
            
            // Возвращаем относительный путь для веб-доступа
            return `/generated/certificates/certificate_${certificateNumber}.jpg`;
            
        } catch (error) {
            console.error('Ошибка при генерации JPG сертификата:', error);
            throw new Error(`Не удалось создать JPG сертификат: ${error.message}`);
        }
    }

    // Генерация JPG из HTML напрямую (fallback когда веб-страница недоступна)
    async generateCertificateJpgFromHTML(certificateNumber, certificateData = null) {
        await this.ensureOutputDir();
        
        const outputPath = path.join(this.outputDir, `certificate_${certificateNumber}.jpg`);
        
        try {
            let cert;
            
            if (certificateData) {
                // Используем переданные данные
                cert = certificateData;
            } else {
                // Получаем данные сертификата из базы
                const { pool } = require('../db');
                const certResult = await pool.query(
                    'SELECT c.*, cd.name as design_name FROM certificates c LEFT JOIN certificate_designs cd ON c.design_id = cd.id WHERE c.certificate_number = $1',
                    [certificateNumber]
                );
                
                if (certResult.rows.length === 0) {
                    throw new Error(`Сертификат ${certificateNumber} не найден в базе данных`);
                }
                
                cert = certResult.rows[0];
            }
            
            // Формируем данные для генерации HTML
            const htmlData = {
                certificate_number: cert.certificate_number,
                nominal_value: cert.nominal_value,
                recipient_name: cert.recipient_name,
                message: cert.message,
                expiry_date: cert.expiry_date,
                design_id: cert.design_id
            };
            
            // Генерируем HTML
            const html = await this.generateCertificateHTML(htmlData);
            
            // Создаем страницу и делаем скриншот
            const browser = await this.initBrowser();
            const page = await browser.newPage();
            
            await page.setViewport({
                width: 1050,
                height: 495,
                deviceScaleFactor: 2
            });
            
            await page.setContent(html, {
                waitUntil: 'networkidle0'
            });
            
            const element = await page.$('.certificate-container');
            if (!element) {
                throw new Error('Не удалось найти .certificate-container при генерации HTML-превью');
            }

            await element.screenshot({
                path: outputPath,
                type: 'jpeg',
                quality: 90
            });
            
            await page.close();
            
            console.log(`✅ JPG сертификат создан из HTML: ${outputPath}`);
            
            return `/generated/certificates/certificate_${certificateNumber}.jpg`;
            
        } catch (error) {
            console.error('Ошибка при генерации JPG из HTML:', error);
            throw new Error(`Не удалось создать JPG сертификат из HTML: ${error.message}`);
        }
    }

    // Метод для генерации JPG из HTML (как в предпросмотре) - используется при покупке
    async generateCertificateJpgFromHTMLForPurchase(certificateNumber, certificateData) {
        await this.ensureOutputDir();
        
        const outputPath = path.join(this.outputDir, `certificate_${certificateNumber}.jpg`);
        
        try {
            // Используем ту же логику, что и в предпросмотре
            const html = await this.generateCertificateHTML(certificateData);

            await this.initBrowser();
            const page = await this.browser.newPage();

            await page.setViewport({
                width: 1050,
                height: 495,
                deviceScaleFactor: 2
            });

            // Дополнительные настройки для лучшего рендеринга эмодзи и цветов
            await page.evaluateOnNewDocument(() => {
                // Устанавливаем кодировку UTF-8
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['ru', 'en']
                });
                
                // Добавляем поддержку эмодзи и принудительное применение цветов
                const style = document.createElement('style');
                style.textContent = `
                    * {
                        -webkit-font-feature-settings: 'liga' 1, 'kern' 1;
                        font-feature-settings: 'liga' 1, 'kern' 1;
                        text-rendering: optimizeLegibility;
                        -webkit-print-color-adjust: exact !important;
                        color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    
                    .certificate-number {
                        color: #FFD700 !important;
                        font-family: 'Courier New', monospace !important;
                        letter-spacing: 0.1em !important;
                    }
                    
                    .certificate-amount {
                        color: #FFD700 !important;
                    }
                    
                    .certificate-value {
                        color: #FFD700 !important;
                        font-weight: 700 !important;
                        font-family: 'Courier New', monospace, 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'EmojiOne' !important;
                        letter-spacing: 0.1em !important;
                    }
                    
                    .certificate-value * {
                        color: #FFD700 !important;
                        font-weight: 700 !important;
                        font-family: 'Courier New', monospace, 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'EmojiOne' !important;
                    }

                    .certificate-expiry {
                        color: #FFFFFF !important;
                    }
                    
                    /* Поддержка эмодзи как fallback для элементов с эмодзи */
                    .certificate-title, .certificate-recipient, .certificate-message, .info-label {
                        font-family: 'Arial', 'Helvetica', sans-serif, 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'EmojiOne' !important;
                    }
                `;
                document.head.appendChild(style);
            });

            await page.setContent(html, {
                waitUntil: 'networkidle0'
            });

            // Добавляем те же стили, что и в предпросмотре
            await page.addStyleTag({
                content: `
                    :root {
                        --certificate-scale: 1 !important;
                    }
                    body {
                        background: transparent !important;
                        padding: 0 !important;
                    }
                    .certificate-viewport {
                        width: 1050px !important;
                        height: 494px !important;
                        border-radius: 0 !important;
                        box-shadow: none !important;
                        background: transparent !important;
                    }
                `
            });

            const element = await page.$('.certificate-viewport');
            if (!element) {
                await page.close();
                throw new Error('Не удалось найти .certificate-viewport для генерации сертификата');
            }

            await element.screenshot({
                path: outputPath,
                type: 'jpeg',
                quality: 90
            });

            await page.close();

            console.log(`✅ JPG сертификат создан (как в предпросмотре): ${outputPath}`);

            return `/generated/certificates/certificate_${certificateNumber}.jpg`;

        } catch (error) {
            console.error('Ошибка при генерации JPG из HTML (метод предпросмотра):', error);
            throw new Error(`Не удалось создать JPG сертификат: ${error.message}`);
        }
    }

    // Метод для генерации JPG из веб-страницы (для email)
    async generateCertificateJpgForEmail(certificateNumber, certificateData = null) {
        // Если переданы данные сертификата, используем метод предпросмотра (более надежный)
        if (certificateData) {
            try {
                const jpgUrl = await this.generateCertificateJpgFromHTMLForPurchase(certificateNumber, certificateData);
                return {
                    jpg_url: jpgUrl,
                    pdf_url: null
                };
            } catch (error) {
                console.error('❌ Ошибка при генерации JPG методом предпросмотра:', error);
                // Fallback на старый метод
            }
        }
        
        try {
            // Сначала пробуем загрузить с веб-страницы
            const jpgUrl = await this.generateCertificateJpgFromWeb(certificateNumber);
            return {
                jpg_url: jpgUrl,
                pdf_url: null // PDF больше не используется
            };
        } catch (webError) {
            console.log('⚠️ Веб-страница недоступна, используем HTML генерацию:', webError.message);
            
            // Fallback: генерируем JPG из HTML напрямую
            try {
                const jpgUrl = await this.generateCertificateJpgFromHTML(certificateNumber, certificateData);
                return {
                    jpg_url: jpgUrl,
                    pdf_url: null
                };
            } catch (htmlError) {
                console.error('❌ Ошибка при генерации JPG из HTML:', htmlError);
                throw new Error(`Не удалось создать JPG сертификат: ${htmlError.message}`);
            }
        }
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
            width: 280px;
            height: 132px;
            overflow: hidden;
        }
        
        .certificate-container {
            position: relative;
            width: 280px;
            height: 132px;
            background-image: url('${backgroundImageData}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding-right: 7px;
        }
        
        .certificate-info {
            background: rgba(0, 0, 0, 0.67);
            color: white;
            padding: 4px;
            border-radius: 3px;
            width: 80px;
            height: 124px;
            margin-right: 4px;
            text-align: center;
            backdrop-filter: blur(8px);
            border: none;
            box-shadow: none;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        
        .certificate-title {
            font-size: 5px;
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
            font-size: 4px;
            font-weight: bold;
            margin-bottom: 4px;
            color: #FFFFFF;
            line-height: 1.0;
            text-transform: uppercase;
            font-family: Arial, sans-serif;
        }
        
        .certificate-number {
            font-size: 7px;
            font-weight: bold;
            color: #FFD700;
            margin-bottom: 3px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            letter-spacing: 0.2px;
            font-family: Arial, sans-serif;
        }
        
        .certificate-amount {
            font-size: 7px;
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

module.exports = new CertificateJpgGenerator();
