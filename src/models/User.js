const db = require('../config/database');

class User {
    static async create({ name, email, phone, role = 'client' }) {
        const query = `
            INSERT INTO users (name, email, phone, role)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const values = [name, email, phone, role];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    static async findById(id) {
        const query = 'SELECT * FROM users WHERE id = $1';
        const result = await db.query(query, [id]);
        return result.rows[0];
    }

    static async findByEmail(email) {
        const query = 'SELECT * FROM users WHERE email = $1';
        const result = await db.query(query, [email]);
        return result.rows[0];
    }

    static async update(id, { name, email, phone, role }) {
        const query = `
            UPDATE users
            SET name = COALESCE($1, name),
                email = COALESCE($2, email),
                phone = COALESCE($3, phone),
                role = COALESCE($4, role)
            WHERE id = $5
            RETURNING *
        `;
        const values = [name, email, phone, role, id];
        const result = await db.query(query, values);
        return result.rows[0];
    }

    static async delete(id) {
        const query = 'DELETE FROM users WHERE id = $1 RETURNING *';
        const result = await db.query(query, [id]);
        return result.rows[0];
    }

    static async findAll() {
        const query = 'SELECT * FROM users ORDER BY created_at DESC';
        const result = await db.query(query);
        return result.rows;
    }

    static async findByRole(role) {
        const query = 'SELECT * FROM users WHERE role = $1';
        const result = await db.query(query, [role]);
        return result.rows;
    }
}

module.exports = User; 