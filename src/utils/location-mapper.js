/**
 * Утилита для преобразования идентификатора места (location) в читаемое название
 * Используется на backend для API ответов
 */

const LOCATION_NAMES = {
    'kuliga': 'База отдыха «Кулига-Клуб»',
    'vorona': 'Воронинские горки'
};

/**
 * Получить читаемое название места по идентификатору
 * @param {string} location - Идентификатор места ('kuliga' или 'vorona')
 * @returns {string} - Читаемое название места или исходное значение, если не найдено
 */
function getLocationName(location) {
    if (!location) {
        return '';
    }
    return LOCATION_NAMES[location] || location;
}

/**
 * Получить все доступные локации с их названиями
 * @returns {Object} - Объект с парами location: название
 */
function getAllLocations() {
    return { ...LOCATION_NAMES };
}

/**
 * Проверить, является ли location валидным
 * @param {string} location - Идентификатор места
 * @returns {boolean} - true, если location валиден
 */
function isValidLocation(location) {
    return location && location in LOCATION_NAMES;
}

module.exports = {
    getLocationName,
    getAllLocations,
    isValidLocation,
    LOCATION_NAMES
};

