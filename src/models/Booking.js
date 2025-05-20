const db = require('../config/database');

class Booking {
    static async create({ user_id, simulator_id, trainer_id, booking_date, start_time, end_time }) {
        const query = `
            INSERT INTO bookings (user_id, simulator_id, trainer_id, booking_date, start_time, end_time)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const values = [user_id, simulator_id, trainer_id, booking_date, start_time, end_time];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    static async findById(id) {
        const query = `
            SELECT b.*, 
                   u.name as user_name,
                   t.name as trainer_name,
                   s.name as simulator_name
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            LEFT JOIN users t ON b.trainer_id = t.id
            JOIN simulators s ON b.simulator_id = s.id
            WHERE b.id = $1
        `;
        const result = await db.query(query, [id]);
        return result.rows[0];
    }

    static async update(id, { status }) {
        const query = `
            UPDATE bookings
            SET status = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await db.query(query, [status, id]);
        return result.rows[0];
    }

    static async delete(id) {
        const query = 'DELETE FROM bookings WHERE id = $1 RETURNING *';
        const result = await db.query(query, [id]);
        return result.rows[0];
    }

    static async findAll() {
        const query = `
            SELECT b.*, 
                   u.name as user_name,
                   t.name as trainer_name,
                   s.name as simulator_name
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            LEFT JOIN users t ON b.trainer_id = t.id
            JOIN simulators s ON b.simulator_id = s.id
            ORDER BY b.booking_date DESC, b.start_time DESC
        `;
        const result = await db.query(query);
        return result.rows;
    }

    static async findByUser(user_id) {
        const query = `
            SELECT ts.*, 
                   c.full_name as client_name,
                   ch.full_name as child_name,
                   t.full_name as trainer_name,
                   s.name as simulator_name,
                   sp.is_child,
                   sp.status as participant_status
            FROM training_sessions ts
            JOIN session_participants sp ON ts.id = sp.session_id
            LEFT JOIN clients c ON sp.client_id = c.id
            LEFT JOIN children ch ON sp.child_id = ch.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            JOIN simulators s ON ts.simulator_id = s.id
            WHERE (sp.client_id = $1 OR ch.parent_id = $1)
            ORDER BY ts.session_date DESC, ts.start_time DESC
        `;
        const result = await db.query(query, [user_id]);
        return result.rows;
    }

    static async findByTrainer(trainer_id) {
        const query = `
            SELECT b.*, 
                   u.name as user_name,
                   t.name as trainer_name,
                   s.name as simulator_name
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            LEFT JOIN users t ON b.trainer_id = t.id
            JOIN simulators s ON b.simulator_id = s.id
            WHERE b.trainer_id = $1
            ORDER BY b.booking_date DESC, b.start_time DESC
        `;
        const result = await db.query(query, [trainer_id]);
        return result.rows;
    }

    static async checkAvailability(simulator_id, booking_date, start_time, end_time) {
        const query = `
            SELECT COUNT(*) as count
            FROM bookings
            WHERE simulator_id = $1
            AND booking_date = $2
            AND status != 'cancelled'
            AND (
                (start_time <= $3 AND end_time > $3)
                OR (start_time < $4 AND end_time >= $4)
                OR (start_time >= $3 AND end_time <= $4)
            )
        `;
        const result = await db.query(query, [simulator_id, booking_date, start_time, end_time]);
        return result.rows[0].count === '0';
    }
}

module.exports = Booking; 