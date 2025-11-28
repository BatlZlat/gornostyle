/**
 * Утилита для преобразования идентификатора места (location) в читаемое название
 * Используется на frontend для отображения
 */

(function() {
    'use strict';

    const LOCATION_NAMES = {
        'kuliga': 'База отдыха «Кулига-Клуб»',
        'vorona': 'Воронинские горки'
    };

    /**
     * Получить читаемое название места по идентификатору
     * @param {string} location - Идентификатор места ('kuliga' или 'vorona')
     * @returns {string} - Читаемое название места или исходное значение, если не найдено
     */
    window.getLocationName = function(location) {
        if (!location) {
            return '';
        }
        return LOCATION_NAMES[location] || location;
    };

    /**
     * Получить все доступные локации с их названиями
     * @returns {Object} - Объект с парами location: название
     */
    window.getAllLocations = function() {
        return { ...LOCATION_NAMES };
    };

    /**
     * Проверить, является ли location валидным
     * @param {string} location - Идентификатор места
     * @returns {boolean} - true, если location валиден
     */
    window.isValidLocation = function(location) {
        return location && location in LOCATION_NAMES;
    };
})();

