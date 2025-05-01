const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

// Создание нового бронирования
router.post('/', bookingController.createBooking);

// Получение всех бронирований
router.get('/', bookingController.getAllBookings);

// Проверка доступности тренажера
router.get('/check-availability', bookingController.checkSimulatorAvailability);

// Получение бронирований пользователя
router.get('/user/:userId', bookingController.getUserBookings);

// Получение бронирований тренера
router.get('/trainer/:trainerId', bookingController.getTrainerBookings);

// Получение конкретного бронирования
router.get('/:id', bookingController.getBooking);

// Обновление статуса бронирования
router.patch('/:id/status', bookingController.updateBookingStatus);

// Удаление бронирования
router.delete('/:id', bookingController.deleteBooking);

module.exports = router; 