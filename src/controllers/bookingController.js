const Booking = require('../models/Booking');
const { pool } = require('../db');

const bookingController = {
    async createBooking(req, res) {
        try {
            const { simulator_id, booking_date, start_time, end_time } = req.body;
            
            // Проверяем, не заблокирован ли слот
            const dateObj = new Date(booking_date);
            const dayOfWeek = dateObj.getDay();
            
            const blockCheckQuery = `
                SELECT * FROM schedule_blocks
                WHERE is_active = TRUE
                AND (simulator_id = $1 OR simulator_id IS NULL)
                AND (
                    (block_type = 'specific' 
                        AND $2::date >= start_date 
                        AND $2::date <= end_date
                        AND start_time < $4::time
                        AND end_time > $3::time
                    )
                    OR
                    (block_type = 'recurring' 
                        AND day_of_week = $5
                        AND start_time < $4::time
                        AND end_time > $3::time
                    )
                )
            `;
            
            const blockResult = await pool.query(blockCheckQuery, [
                simulator_id,
                booking_date,
                start_time,
                end_time,
                dayOfWeek
            ]);
            
            if (blockResult.rows.length > 0) {
                const block = blockResult.rows[0];
                return res.status(400).json({
                    error: 'Этот временной слот заблокирован',
                    reason: block.reason || 'Слот недоступен для бронирования',
                    block_type: block.block_type
                });
            }
            
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
            console.error('Ошибка при создании бронирования:', error);
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