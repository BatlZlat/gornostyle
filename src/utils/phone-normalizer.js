/**
 * Утилита для нормализации телефонных номеров
 * Приводит все номера к единому формату: +79XXXXXXXXX
 */

/**
 * Нормализует телефонный номер к единому формату
 * @param {string} phone - Входной телефонный номер
 * @returns {string} - Нормализованный номер в формате +79XXXXXXXXX
 * 
 * Примеры:
 * - "+7 (912) 392-49-56" -> "+79123924956"
 * - "8 912 392 49 56" -> "+79123924956"
 * - "9123924956" -> "+79123924956"
 * - "+7-912-392-49-56" -> "+79123924956"
 */
function normalizePhone(phone) {
    if (!phone || typeof phone !== 'string') {
        return '';
    }

    // Убираем все символы кроме цифр и +
    let cleaned = phone.replace(/[^\d+]/g, '');

    // Если номер начинается с 8, заменяем на +7
    if (cleaned.startsWith('8')) {
        cleaned = '+7' + cleaned.substring(1);
    }

    // Если номер начинается с 7 (без +), добавляем +
    if (cleaned.startsWith('7') && !cleaned.startsWith('+7')) {
        cleaned = '+' + cleaned;
    }

    // Если номер начинается с 9 (мобильный без кода страны), добавляем +7
    if (cleaned.startsWith('9') && cleaned.length === 10) {
        cleaned = '+7' + cleaned;
    }

    // Если уже есть +7, оставляем как есть
    // Если нет + в начале, но номер валидный, добавляем +
    if (!cleaned.startsWith('+') && cleaned.length >= 10) {
        // Предполагаем что это российский номер
        if (cleaned.length === 10) {
            cleaned = '+7' + cleaned;
        } else if (cleaned.length === 11 && cleaned.startsWith('7')) {
            cleaned = '+' + cleaned;
        }
    }

    return cleaned;
}

/**
 * Форматирует нормализованный номер для отображения
 * @param {string} phone - Нормализованный номер
 * @returns {string} - Отформатированный номер: +7 (XXX) XXX-XX-XX
 */
function formatPhoneForDisplay(phone) {
    const normalized = normalizePhone(phone);
    
    if (!normalized || normalized.length < 12) {
        return phone; // Возвращаем как есть, если не валидный
    }

    // Для российских номеров: +7 (XXX) XXX-XX-XX
    if (normalized.startsWith('+7') && normalized.length === 12) {
        const code = normalized.substring(2, 5);
        const part1 = normalized.substring(5, 8);
        const part2 = normalized.substring(8, 10);
        const part3 = normalized.substring(10, 12);
        return `+7 (${code}) ${part1}-${part2}-${part3}`;
    }

    return normalized;
}

module.exports = {
    normalizePhone,
    formatPhoneForDisplay
};

