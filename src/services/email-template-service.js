const fs = require('fs').promises;
const path = require('path');

class EmailTemplateService {
    constructor() {
        this.templatesDir = path.join(__dirname, 'email-templates');
        this.cache = {};
    }

    /**
     * Загружает шаблон из файла (с кешированием)
     * @param {string} templateName - Имя шаблона (без расширения)
     * @returns {Promise<string>} HTML содержимое шаблона
     */
    async loadTemplate(templateName) {
        if (this.cache[templateName]) {
            return this.cache[templateName];
        }

        const templatePath = path.join(this.templatesDir, `${templateName}.html`);
        try {
            const content = await fs.readFile(templatePath, 'utf-8');
            this.cache[templateName] = content;
            return content;
        } catch (error) {
            console.error(`Ошибка загрузки шаблона ${templateName}:`, error);
            throw new Error(`Шаблон ${templateName} не найден`);
        }
    }

    /**
     * Простая замена переменных в шаблоне
     * Поддерживает {{variable}} и {{#if condition}}...{{/if}}
     * @param {string} template - HTML шаблон
     * @param {object} data - Данные для подстановки
     * @returns {string} Обработанный HTML
     */
    renderTemplate(template, data) {
        let html = template;

        // Обработка условных блоков {{#if condition}}...{{/if}}
        const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
        html = html.replace(ifRegex, (match, condition, content) => {
            // Проверяем условие (truthy значение)
            if (data[condition]) {
                return content;
            }
            return '';
        });

        // Замена переменных {{variable}}
        const varRegex = /\{\{(\w+)\}\}/g;
        html = html.replace(varRegex, (match, varName) => {
            return data[varName] !== undefined ? String(data[varName]) : '';
        });

        return html;
    }

    /**
     * Генерирует HTML для подтверждения бронирования
     * @param {object} bookingData - Данные бронирования
     * @returns {Promise<string>} HTML содержимое
     */
    async generateBookingConfirmationEmail(bookingData) {
        const template = await this.loadTemplate('booking-confirmation');
        
        // Форматируем данные
        const sportTypeText = bookingData.sport_type === 'ski' ? 'Лыжи' : 'Сноуборд';
        const locationText = this.getLocationDisplayName(bookingData.location || 'kuliga');
        const locationAddress = this.getLocationAddress(bookingData.location || 'kuliga');
        
        // Форматируем дату
        const date = this.formatDate(bookingData.date);
        const startTime = this.formatTime(bookingData.start_time);
        const endTime = this.formatTime(bookingData.end_time);

        const data = {
            client_name: bookingData.client_name || 'Клиент',
            client_id: bookingData.client_id || '',
            date: date,
            start_time: startTime,
            end_time: endTime,
            booking_type_individual: bookingData.booking_type === 'individual',
            booking_type_group: bookingData.booking_type === 'group',
            participants_count: bookingData.participants_count || 1,
            sport_type_text: sportTypeText,
            instructor_name: bookingData.instructor_name || null,
            location_text: locationText,
            location_address: locationAddress,
            price_total: bookingData.price_total || 0,
            price_per_person: bookingData.price_per_person || null
        };

        return this.renderTemplate(template, data);
    }

    /**
     * Генерирует HTML для напоминания о тренировке
     * @param {object} trainingData - Данные тренировки (может содержать массив trainings)
     * @returns {Promise<string>} HTML содержимое
     */
    async generateTrainingReminderEmail(trainingData) {
        const template = await this.loadTemplate('training-reminder');
        
        // Если передан массив тренировок, берем первую (для упрощения шаблона)
        // В будущем можно расширить шаблон для множественных тренировок
        const training = trainingData.trainings ? trainingData.trainings[0] : trainingData;
        
        // Форматируем данные
        const sportTypeText = training.sport_type === 'ski' || training.equipment_type === 'ski' ? 'Лыжи' : 'Сноуборд';
        const location = training.location || 'kuliga';
        const locationText = this.getLocationDisplayName(location);
        const locationAddress = this.getLocationAddress(location);
        
        // Форматируем дату
        const date = this.formatDate(training.date);
        const startTime = this.formatTime(training.start_time);
        const endTime = this.formatTime(training.end_time);

        // Определяем тип склона для показа правильных рекомендаций
        const hasNaturalSlope = training.slope_type === 'natural_slope' || 
                                training.slope_type === 'kuliga_natural_slope';
        const hasSimulator = training.slope_type === 'simulator';

        const data = {
            client_name: trainingData.client_name || 'Клиент',
            client_id: trainingData.client_id || '',
            date: date,
            start_time: startTime,
            end_time: endTime,
            booking_type_individual: training.training_type === 'individual',
            booking_type_group: training.training_type === 'group',
            participants_count: training.participants_count || training.current_participants || 1,
            sport_type_text: sportTypeText,
            instructor_name: training.instructor_name || training.trainer_name || null,
            location_text: locationText,
            location_address: locationAddress,
            has_natural_slope: hasNaturalSlope && !hasSimulator,
            has_simulator: hasSimulator && !hasNaturalSlope
        };

        return this.renderTemplate(template, data);
    }

    /**
     * Генерирует HTML для уведомления об отмене
     * @param {object} cancellationData - Данные об отмене
     * @returns {Promise<string>} HTML содержимое
     */
    async generateBookingCancellationEmail(cancellationData) {
        const template = await this.loadTemplate('booking-cancellation');
        
        // Форматируем данные
        const sportTypeText = cancellationData.sport_type === 'ski' ? 'Лыжи' : 'Сноуборд';
        const locationText = this.getLocationDisplayName(cancellationData.location || 'kuliga');
        
        // Форматируем дату
        const date = this.formatDate(cancellationData.date);
        const startTime = this.formatTime(cancellationData.start_time);
        const endTime = this.formatTime(cancellationData.end_time);

        const data = {
            client_name: cancellationData.client_name || 'Клиент',
            date: date,
            start_time: startTime,
            end_time: endTime,
            booking_type_individual: cancellationData.booking_type === 'individual',
            booking_type_group: cancellationData.booking_type === 'group',
            sport_type_text: sportTypeText,
            location_text: locationText,
            cancellation_reason: cancellationData.cancellation_reason || null,
            refund_info: cancellationData.refund_info || null
        };

        return this.renderTemplate(template, data);
    }

    /**
     * Форматирует дату в читаемый формат
     * @param {string|Date} date - Дата
     * @returns {string} Отформатированная дата
     */
    formatDate(date) {
        if (!date) return '';
        
        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) {
                // Если это строка формата YYYY-MM-DD
                const parts = String(date).split('-');
                if (parts.length === 3) {
                    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                                   'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
                    const day = parseInt(parts[2], 10);
                    const month = months[parseInt(parts[1], 10) - 1];
                    const year = parts[0];
                    return `${day} ${month} ${year}`;
                }
                return String(date);
            }
            
            const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                           'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
            const day = d.getDate();
            const month = months[d.getMonth()];
            const year = d.getFullYear();
            return `${day} ${month} ${year}`;
        } catch (error) {
            return String(date);
        }
    }

    /**
     * Форматирует время
     * @param {string} time - Время в формате HH:mm:ss или HH:mm
     * @returns {string} Отформатированное время
     */
    formatTime(time) {
        if (!time) return '';
        return String(time).slice(0, 5); // Берем только HH:mm
    }

    /**
     * Получает отображаемое имя локации
     * @param {string} location - Код локации
     * @returns {string} Отображаемое имя
     */
    getLocationDisplayName(location) {
        const locations = {
            'kuliga': 'Воронинские горки',
            'kuliga-club': 'База отдыха «Кулига-Клуб»',
            'natural_slope': 'Естественный склон'
        };
        return locations[location] || location || 'Место не указано';
    }

    /**
     * Получает адрес локации
     * @param {string} location - Код локации
     * @returns {string} Адрес
     */
    getLocationAddress(location) {
        const addresses = {
            'kuliga': 'г. Тюмень, с. Яр, ул. Источник, 2А',
            'kuliga-club': 'База отдыха «Кулига-Клуб»',
            'natural_slope': 'г. Тюмень, с. Яр, ул. Источник, 2А'
        };
        return addresses[location] || 'г. Тюмень, с. Яр, ул. Источник, 2А';
    }
}

module.exports = new EmailTemplateService();
