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
            WITH client_sessions AS (
                -- Групповые тренировки
                SELECT 
                    ts.id,
                    ts.session_date,
                    ts.start_time,
                    ts.end_time,
                    ts.duration,
                    ts.equipment_type,
                    s.name as simulator_name,
                    g.name as group_name,
                    t.full_name as trainer_name,
                    ts.skill_level,
                    ts.price,
                    ts.max_participants,
                    (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id AND status = 'confirmed') as current_participants,
                    c.full_name as client_name,
                    ch.full_name as child_name,
                    sp.is_child,
                    sp.status as participant_status,
                    'group' as session_type
                FROM training_sessions ts
                JOIN session_participants sp ON ts.id = sp.session_id
                JOIN simulators s ON ts.simulator_id = s.id
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                LEFT JOIN clients c ON sp.client_id = c.id
                LEFT JOIN children ch ON sp.child_id = ch.id
                WHERE (sp.client_id = $1 OR ch.parent_id = $1)
                AND ts.session_date >= CURRENT_DATE
                AND ts.status = 'scheduled'
                UNION ALL
                -- Индивидуальные тренировки
                SELECT 
                    its.id,
                    its.preferred_date as session_date,
                    its.preferred_time as start_time,
                    (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
                    its.duration,
                    its.equipment_type,
                    s.name as simulator_name,
                    NULL as group_name,
                    NULL as trainer_name,
                    NULL as skill_level,
                    its.price,
                    NULL as max_participants,
                    NULL as current_participants,
                    cl.full_name as client_name,
                    c.full_name as child_name,
                    CASE WHEN its.child_id IS NOT NULL THEN true ELSE false END as is_child,
                    'confirmed' as participant_status,
                    'individual' as session_type
                FROM individual_training_sessions its
                JOIN simulators s ON its.simulator_id = s.id
                LEFT JOIN children c ON its.child_id = c.id
                JOIN clients cl ON its.client_id = cl.id
                WHERE its.client_id = $1
                AND its.preferred_date >= CURRENT_DATE
            )
            SELECT * FROM client_sessions
            ORDER BY session_date ASC, start_time ASC
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