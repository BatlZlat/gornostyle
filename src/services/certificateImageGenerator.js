const Jimp = require('jimp');
const path = require('path');
const fs = require('fs').promises;

class CertificateImageGenerator {
    constructor() {
        this.outputDir = path.join(__dirname, '../../public/generated/certificates');
        this.templateDir = path.join(__dirname, '../../public/images/certificates');
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

    async generateCertificateImage(certificateData) {
        await this.ensureOutputDir();

        const { 
            certificate_number, 
            nominal_value, 
            recipient_name, 
            message, 
            expiry_date, 
            design_id 
        } = certificateData;

        // Путь к базовому изображению
        const templatePath = this.getDesignImagePath(design_id);
        
        // Путь для сохранения готового сертификата
        const outputPath = path.join(this.outputDir, `certificate_${certificate_number}.jpg`);

        try {
            // Загружаем базовое изображение
            const image = await Jimp.read(templatePath);
            
            // Загружаем шрифты
            const fontLarge = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
            const fontMedium = await Jimp.loadFont(Jimp.FONT_SANS_24_WHITE);
            const fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

            // Создаем полупрозрачный фон для текста справа
            const textBoxWidth = 300;
            const textBoxHeight = 400;
            const textBoxX = image.bitmap.width - textBoxWidth - 30;
            const textBoxY = (image.bitmap.height - textBoxHeight) / 2;

            // Добавляем полупрозрачный фон
            const overlay = new Jimp(textBoxWidth, textBoxHeight, 0x000000AA);
            image.composite(overlay, textBoxX, textBoxY);

            // Позиции для текста (относительно textBox)
            let currentY = textBoxY + 30;
            const centerX = textBoxX + textBoxWidth / 2;

            // Заголовок
            const titleText = '🎁 ПОДАРОЧНЫЙ\nСЕРТИФИКАТ';
            image.print(fontMedium, centerX - 120, currentY, {
                text: titleText,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            }, 240);
            currentY += 80;

            // Номер сертификата
            image.print(fontLarge, centerX - 120, currentY, {
                text: `№ ${certificate_number}`,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            }, 240);
            currentY += 50;

            // Номинал
            image.print(fontLarge, centerX - 120, currentY, {
                text: `${nominal_value} руб.`,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            }, 240);
            currentY += 60;

            // Получатель
            if (recipient_name) {
                image.print(fontMedium, centerX - 120, currentY, {
                    text: 'Кому:',
                    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
                }, 240);
                currentY += 30;
                
                image.print(fontSmall, centerX - 120, currentY, {
                    text: recipient_name,
                    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
                }, 240);
                currentY += 40;
            }

            // Пожелание
            if (message) {
                image.print(fontSmall, centerX - 120, currentY, {
                    text: `"${message}"`,
                    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
                }, 240);
                currentY += 50;
            }

            // Дата истечения
            const formattedDate = new Date(expiry_date).toLocaleDateString('ru-RU');
            image.print(fontSmall, centerX - 120, currentY, {
                text: `Действителен до:\n${formattedDate}`,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            }, 240);

            // Сохраняем изображение
            await image.quality(95).writeAsync(outputPath);

            // Возвращаем относительный путь для веб-доступа
            return `/generated/certificates/certificate_${certificate_number}.jpg`;

        } catch (error) {
            console.error('Ошибка при генерации изображения сертификата:', error);
            throw new Error('Не удалось создать изображение сертификата');
        }
    }

    async getCertificateImageUrl(certificateNumber) {
        const imagePath = path.join(this.outputDir, `certificate_${certificateNumber}.jpg`);
        
        try {
            await fs.access(imagePath);
            return `/generated/certificates/certificate_${certificateNumber}.jpg`;
        } catch (error) {
            return null; // Изображение не найдено
        }
    }

    async deleteCertificateImage(certificateNumber) {
        const imagePath = path.join(this.outputDir, `certificate_${certificateNumber}.jpg`);
        
        try {
            await fs.unlink(imagePath);
            return true;
        } catch (error) {
            console.error('Ошибка при удалении изображения сертификата:', error);
            return false;
        }
    }
}

module.exports = new CertificateImageGenerator();
