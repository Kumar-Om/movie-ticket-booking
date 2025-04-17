import express from "express";
import bodyParser from "body-parser";
import mysql from "mysql2";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";

dotenv.config();

const app = express();
const PORT = 3000;

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    resave: false,
    saveUninitialized: true
}));

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
});

db.connect(err => {
    if (err) {
        console.error("Database connection failed:", err.message);
        process.exit(1);
    }
    console.log("Connected to MySQL database");

    // Initialize database schema
    db.query(`
        CREATE TABLE IF NOT EXISTS seats (
            id INT PRIMARY KEY AUTO_INCREMENT,
            movie_id INT,
            seat_row CHAR(1),
            seat_number INT,
            UNIQUE(movie_id, seat_row, seat_number),
            FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS booked_seats (
            id INT PRIMARY KEY AUTO_INCREMENT,
            booking_id INT,
            seat_id INT,
            FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
            FOREIGN KEY (seat_id) REFERENCES seats(id) ON DELETE CASCADE
        );
    `, (err) => {
        if (err) console.error("Error creating seat tables:", err.message);
    });
});

// Existing routes (login, register, home, etc.)
app.get("/", (req, res) => {
    db.query("SELECT * FROM movies", (err, results) => {
        if (err) return res.status(500).send("Error fetching movies");
        res.render("home", { movies: results, user: req.session.user });
    });
});

app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = ?', [email], async (error, results) => {
        if (error) return res.status(500).send('Error logging in');
        if (results.length === 0) return res.send('User not found');
        
        const user = results[0];
        if (await bcrypt.compare(password, user.password)) {
            req.session.user = user;
            res.redirect('/');
        } else {
            res.send('Incorrect password');
        }
    });
});

app.post('/register', async (req, res) => {
    const { name, email, phone, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.query('INSERT INTO users SET ?', 
            { name, email, phone, password: hashedPassword }, 
            (error) => error ? res.status(500).send('Error registering user') : res.redirect('/login')
        );
    } catch (err) {
        res.status(500).send('Error registering user');
    }
});

// Updated Movie Details Route with Seat Selection
app.get("/movies/:id", (req, res) => {
    const movieId = req.params.id;
    const query = `
        SELECT m.*, 
               s.id AS seat_id,
               s.seat_row,
               s.seat_number,
               EXISTS(SELECT 1 FROM booked_seats WHERE seat_id = s.id) AS booked
        FROM movies m
        LEFT JOIN seats s ON m.id = s.movie_id
        WHERE m.id = ?
        ORDER BY s.seat_row, s.seat_number
    `;

    db.query(query, [movieId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).send("Movie not found");
        }

        const movie = results[0];
        const seats = results
            .filter(row => row.seat_id) // Remove null seats
            .map(row => ({
                id: row.seat_id,
                row: row.seat_row,
                number: row.seat_number,
                booked: Boolean(row.booked)
            }));

        res.render("movies", { 
            movie: {
                ...movie,
                total_seats_booked: movie.total_seats_booked,
                availableSeats: 100 - movie.total_seats_booked
            },
            seats,
            user: req.session.user 
        });
    });
});

// Updated Booking Route with Seat Selection
app.post("/book", (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { movieId, seats } = req.body;
    const seatIds = Array.isArray(seats) ? seats : [seats];

    db.beginTransaction(err => {
        if (err) return res.status(500).send("Transaction error");

        // 1. Check seat availability
        db.query(`
            SELECT s.id 
            FROM seats s
            LEFT JOIN booked_seats bs ON s.id = bs.seat_id
            WHERE s.id IN (?)
            AND bs.id IS NULL
        `, [seatIds], (err, availableSeats) => {
            if (err) return rollback(res, err);
            if (availableSeats.length !== seatIds.length) {
                return rollback(res, "Some seats are already booked");
            }

            // 2. Create booking
            db.query(`
                INSERT INTO bookings (movie_id, user_id, seats)
                VALUES (?, ?, ?)
            `, [movieId, req.session.user.id, seatIds.length], 
            (err, bookingResult) => {
                if (err) return rollback(res, err);
                
                const bookingId = bookingResult.insertId;
                const bookedSeats = seatIds.map(seatId => [bookingId, seatId]);
                
                // 3. Reserve seats
                db.query(`
                    INSERT INTO booked_seats (booking_id, seat_id)
                    VALUES ?
                `, [bookedSeats], (err) => {
                    if (err) return rollback(res, err);
                    
                    // 4. Update movie seat count
                    db.query(`
                        UPDATE movies 
                        SET total_seats_booked = total_seats_booked + ?
                        WHERE id = ?
                    `, [seatIds.length, movieId], (err) => {
                        if (err) return rollback(res, err);
                        
                        db.commit(err => {
                            if (err) return rollback(res, err);
                            res.redirect(`/confirmation/${bookingId}`);
                        });
                    });
                });
            });
        });
    });
});

// New Confirmation Route
app.get("/confirmation/:id", (req, res) => {
    db.query(`
        SELECT m.title, b.seats, 
               GROUP_CONCAT(CONCAT(s.seat_row, s.seat_number)) AS seat_numbers
        FROM bookings b
        JOIN movies m ON b.movie_id = m.id
        JOIN booked_seats bs ON b.id = bs.booking_id
        JOIN seats s ON bs.seat_id = s.id
        WHERE b.id = ?
        GROUP BY b.id
    `, [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).send("Booking not found");
        const booking = results[0];
        res.render("confirmation", {
            movie: { title: booking.title },
            seats: booking.seats,
            seatNumbers: booking.seat_numbers.split(','),
            user: req.session.user
        });
    });
});

// User Bookings Page (Updated with Seat Details)
app.get('/my-bookings', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const query = `
        SELECT m.title, b.booking_time,
               GROUP_CONCAT(CONCAT(s.seat_row, s.seat_number)) AS seats
        FROM bookings b
        JOIN movies m ON b.movie_id = m.id
        JOIN booked_seats bs ON b.id = bs.booking_id
        JOIN seats s ON bs.seat_id = s.id
        WHERE b.user_id = ?
        GROUP BY b.id
        ORDER BY b.booking_time DESC`;
    
    db.query(query, [req.session.user.id], (err, results) => {
        if (err) return res.status(500).send("Error fetching bookings");
        res.render('my-bookings', { 
            bookings: results.map(r => ({
                ...r,
                seats: r.seats.split(',')
            })), 
            user: req.session.user 
        });
    });
});

// Transaction rollback helper
function rollback(res, error) {
    db.rollback(() => {
        console.error("Transaction rolled back:", error);
        res.status(500).send("Booking failed: " + error);
    });
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
