const Booking = require('../models/Booking');

const bookingController = {
    async createBooking(req, res) {
        try {
            const { simulator_id, booking_date, start_time, end_time } = req.body;
            
            // Проверяем доступность тренажера
            const isAvailable = await Booking.checkAvailability(
                simulator_id,
                booking_date,
                start_time,
                end_time
            );

            if (!isAvailable) {
                return res.status(400).json({
                    error: 'Тренажер недоступен в выбранное время'
                });
            }

            const booking = await Booking.create(req.body);
            res.status(201).json(booking);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при создании бронирования' });
        }
    },

    async getBooking(req, res) {
        try {
            const booking = await Booking.findById(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Бронирование не найдено' });
            }
            res.json(booking);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении бронирования' });
        }
    },

    async updateBookingStatus(req, res) {
        try {
            const booking = await Booking.update(req.params.id, req.body);
            if (!booking) {
                return res.status(404).json({ error: 'Бронирование не найдено' });
            }
            res.json(booking);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при обновлении статуса бронирования' });
        }
    },

    async deleteBooking(req, res) {
        try {
            const booking = await Booking.delete(req.params.id);
            if (!booking) {
                return res.status(404).json({ error: 'Бронирование не найдено' });
            }
            res.json({ message: 'Бронирование успешно удалено' });
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при удалении бронирования' });
        }
    },

    async getAllBookings(req, res) {
        try {
            const bookings = await Booking.findAll();
            res.json(bookings);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении списка бронирований' });
        }
    },

    async getUserBookings(req, res) {
        try {
            const bookings = await Booking.findByUser(req.params.userId);
            res.json(bookings);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении бронирований пользователя' });
        }
    },

    async getTrainerBookings(req, res) {
        try {
            const bookings = await Booking.findByTrainer(req.params.trainerId);
            res.json(bookings);
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при получении бронирований тренера' });
        }
    },

    async checkSimulatorAvailability(req, res) {
        try {
            const { simulator_id, booking_date, start_time, end_time } = req.query;
            const isAvailable = await Booking.checkAvailability(
                simulator_id,
                booking_date,
                start_time,
                end_time
            );
            res.json({ available: isAvailable });
        } catch (error) {
            res.status(500).json({ error: 'Ошибка при проверке доступности тренажера' });
        }
    }
};

module.exports = bookingController; 