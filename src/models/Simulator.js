const db = require('../config/database');

class Simulator {
    static async create({ name, description, status = 'available' }) {
        const query = `
            INSERT INTO simulators (name, description, status)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const values = [name, description, status];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    static async findById(id) {
        const query = 'SELECT * FROM simulators WHERE id = $1';
        const result = await db.query(query, [id]);
        return result.rows[0];
    }

    static async update(id, { name, description, status }) {
        const query = `
            UPDATE simulators
            SET name = COALESCE($1, name),
                description = COALESCE($2, description),
                status = COALESCE($3, status)
            WHERE id = $4
            RETURNING *
        `;
        const values = [name, description, status, id];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    static async delete(id) {
        const query = 'DELETE FROM simulators WHERE id = $1 RETURNING *';
        const result = await db.query(query, [id]);
        return result.rows[0];
    }

    static async findAll() {
        const query = 'SELECT * FROM simulators ORDER BY created_at DESC';
        const result = await db.query(query);
        return result.rows;
    }

    static async findByStatus(status) {
        const query = 'SELECT * FROM simulators WHERE status = $1';
        const result = await db.query(query, [status]);
        return result.rows;
    }

    static async updateStatus(id, status) {
        const query = `
            UPDATE simulators
            SET status = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await db.query(query, [status, id]);
        return result.rows[0];
    }

    static async getSchedule(id) {
        const query = `
            SELECT s.*, sim.name as simulator_name
            FROM schedule s
            JOIN simulators sim ON s.simulator_id = sim.id
            WHERE simulator_id = $1
            ORDER BY day_of_week, start_time
        `;
        const result = await db.query(query, [id]);
        return result.rows;
    }
}

module.exports = Simulator; 