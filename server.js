const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
let Pool;
try {
    const pg = require('pg');
    Pool = pg.Pool;
} catch (e) {
    // pg not found, likely local environment without installation
    Pool = null;
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    maxHttpBufferSize: 50 * 1024 * 1024
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 📦 Database Setup (Dual Mode: SQLite vs Postgres)
const isPostgres = !!process.env.DATABASE_URL;
let db;

console.log(isPostgres ? "🔌 Connecting to PostgreSQL..." : "🔌 Connecting to SQLite...");

if (isPostgres) {
    db = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    // Local SQLite
    const dbPath = './trip_v2.db';
    const sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) console.error("Database Error:", err.message);
        else console.log(`✨ Connected to SQLite at ${dbPath}`);
    });
    // Wrapper to match Postgres Promise API roughly
    db = {
        query: (text, params) => {
            return new Promise((resolve, reject) => {
                // Convert Postgres $1, $2 syntax to SQLite ?, ? syntax
                let paramIndex = 1;
                const sqliteText = text.replace(/\$\d+/g, () => '?');

                if (text.trim().toUpperCase().startsWith('SELECT')) {
                    sqliteDb.all(sqliteText, params || [], (err, rows) => {
                        if (err) reject(err); else resolve({ rows });
                    });
                } else if (text.trim().toUpperCase().startsWith('INSERT')) {
                    sqliteDb.run(sqliteText, params || [], function (err) {
                        if (err) reject(err); else resolve({ rows: [{ id: this.lastID }] }); // Return fake "RETURNING id"
                    });
                } else {
                    sqliteDb.run(sqliteText, params || [], function (err) {
                        if (err) reject(err); else resolve({ rowCount: this.changes });
                    });
                }
            });
        }
    };
}

// Initialize Tables
const initSQL = `
    CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        place TEXT,
        start_time TEXT,
        end_time TEXT,
        duration TEXT,
        budget TEXT,
        reason TEXT,
        status TEXT DEFAULT 'pending', 
        rejection_reason TEXT,
        proof_image TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        avatar TEXT
    );
`.replace(/SERIAL PRIMARY KEY/g, isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/TIMESTAMP/g, isPostgres ? 'TIMESTAMP' : 'DATETIME');

// Run Init
if (isPostgres) {
    db.query(initSQL).catch(e => console.error("Init DB Error:", e));
} else {
    // SQLite exec doesn't support multiple statements well in wrapper, run manually
    const sqliteActual = require('sqlite3').verbose().Database; // Re-import to be safe or use existing instance logic
    // We already have sqliteDb in the closure above if we were cleaner, but simpler to just rely on the wrapper or simple split
    // For simplicity, let's just assume the wrapper works or we do simple split
    const stmts = initSQL.split(';');
    (async () => {
        for (const stmt of stmts) {
            if (stmt.trim()) await db.query(stmt);
        }
    })();
}


// Routes
app.get('/', (req, res) => res.redirect('/boy'));
app.get('/boy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boy.html')));
app.get('/girl', (req, res) => res.sendFile(path.join(__dirname, 'public', 'girl.html')));

// API
app.get('/api/history', async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM requests ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
});
app.get('/api/profiles', async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM profiles");
        const profiles = {};
        rows.forEach(r => profiles[r.username] = r.avatar);
        res.json(profiles);
    } catch (err) {
        console.error(err);
        res.json({});
    }
});

// Socket Events
io.on('connection', (socket) => {
    socket.on('request_trip', async (data) => {
        const { place, start_time, end_time, duration, budget, reason } = data;
        const sql = `INSERT INTO requests (place, start_time, end_time, duration, budget, reason) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;
        try {
            const { rows } = await db.query(sql, [place, start_time, end_time, duration, budget, reason]);
            const newId = rows[0]?.id || rows[0]?.lastID; // Handle Postgres vs SQLite wrapper return
            io.emit('new_request', { id: newId, ...data, status: 'pending', proof_image: null });
        } catch (err) {
            console.error("Insert Error", err);
        }
    });

    socket.on('update_status', async (data) => {
        const { id, status, rejection_reason } = data;
        const reasonVal = status === 'rejected' ? rejection_reason : null;
        try {
            await db.query(`UPDATE requests SET status = $1, rejection_reason = $2 WHERE id = $3`, [status, reasonVal, id]);
            io.emit('status_changed', data);
        } catch (e) { console.error(e); }
    });

    socket.on('send_proof', async (data) => {
        const imagesJSON = JSON.stringify(data.images);
        try {
            await db.query(`UPDATE requests SET proof_image = $1 WHERE id = $2`, [imagesJSON, data.id]);
            io.emit('proof_updated', { id: data.id, images: data.images });
        } catch (e) { console.error(e); }
    });

    socket.on('update_profile', async (data) => {
        const { username, avatar } = data;
        const sql = `INSERT INTO profiles (username, avatar) VALUES ($1, $2) ON CONFLICT(username) DO UPDATE SET avatar = $2`;
        try {
            await db.query(sql, [username, avatar]);
            io.emit('profile_updated', data);
        } catch (e) { console.error(e); }
    });

    socket.on('delete_trip', async (id) => {
        try {
            await db.query(`DELETE FROM requests WHERE id = $1`, [id]);
            io.emit('trip_deleted', id);
        } catch (e) { console.error(e); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Tell Mom App Server started on port ${PORT}`);
});
