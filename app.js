import express from "express";
import bodyParser from "body-parser";
import mysql from "mysql2";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";

dotenv.config(); // Load environment variables

const app = express();
const PORT = 3000;

// Set EJS as the view engine
app.set("view engine", "ejs");

// Middleware
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'your_secret_key', // Replace with a real secret key
    resave: false,
    saveUninitialized: true
}));

// MySQL Database Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

db.connect(err => {
    if (err) {
        console.error("Database connection failed:", err.message);
        process.exit(1);
    }
    console.log("Connected to MySQL database");

    // Reset total_seats_booked to 0 for all movies on server start
    db.query("UPDATE movies SET total_seats_booked = 0", (err, result) => {
        if (err) {
            console.error("Error resetting seat count:", err.message);
        } else {
            console.log("All movie seat counts have been reset to 0.");
        }
    });
});

// Home Page - Fetch Movies
app.get("/", (req, res) => {
    db.query("SELECT * FROM movies", (err, results) => {
        if (err) {
            console.error("Error fetching movies:", err.message);
            return res.status(500).send("Error fetching movies");
        }
        res.render("home", { movies: results, user: req.session.user });
    });
});

// Login Page
app.get('/login', (req, res) => {
    res.render('login');
});

// Login Process
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = ?', [email], async (error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).send('Error logging in');
        }
        if (results.length > 0) {
            const comparison = await bcrypt.compare(password, results[0].password);
            if (comparison) {
                req.session.user = results[0];
                res.redirect('/');
            } else {
                res.send('Incorrect password');
            }
        } else {
            res.send('User not found');
        }
    });
});

// Registration Page
app.get('/register', (req, res) => {
    res.render('register');
});

// Registration Process
app.post('/register', async (req, res) => {
    const { name, email, phone, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    db.query('INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)', 
        [name, email, phone, hashedPassword], 
        (error, results) => {
            if (error) {
                console.error(error);
                return res.status(500).send('Error registering user');
            }
            res.redirect('/login');
        }
    );
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
        }
        res.redirect('/');
    });
});

// Movie Details Page
app.get("/movies/:id", (req, res) => {
    const movieId = req.params.id;
    db.query("SELECT * FROM movies WHERE id = ?", [movieId], (err, result) => {
        if (err || result.length === 0) {
            console.error("Error fetching movie details:", err?.message || "Movie not found");
            return res.status(404).send("Movie not found");
        }
        res.render("movies", { movie: result[0], user: req.session.user });
    });
});

// Handle Booking Requests
app.post("/book", (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    const { movieId, seats } = req.body;

    db.query("SELECT total_seats_booked FROM movies WHERE id = ?", [movieId], (err, result) => {
        if (err || result.length === 0) {
            console.error("Error checking available seats:", err?.message || "Movie not found");
            return res.status(500).send("Error checking available seats");
        }

        const totalBooked = result[0].total_seats_booked;
        const maxSeats = 100;

        if (totalBooked + parseInt(seats, 10) > maxSeats) {
            return res.send("Not enough seats available for this movie.");
        }

        db.query(
            "UPDATE movies SET total_seats_booked = ? WHERE id = ?",
            [totalBooked + parseInt(seats, 10), movieId],
            (updateErr) => {
                if (updateErr) {
                    console.error("Error updating seat count:", updateErr.message);
                    return res.status(500).send("Error updating seat count");
                }

                db.query(
                    "INSERT INTO bookings (movie_id, user_id, seats) VALUES (?, ?, ?)",
                    [movieId, req.session.user.id, parseInt(seats, 10)],
                    (insertErr) => {
                        if (insertErr) {
                            console.error("Error inserting booking record:", insertErr.message);
                            return res.status(500).send("Error inserting booking record");
                        }

                        db.query("SELECT * FROM movies WHERE id = ?", [movieId], (fetchErr, updatedResult) => {
                            if (fetchErr || updatedResult.length === 0) {
                                console.error("Error fetching updated movie details:", fetchErr?.message || "Movie not found");
                                return res.status(404).send("Movie not found");
                            }
                            res.render("confirmation", { movie: updatedResult[0], seats, user: req.session.user });
                        });
                    }
                );
            }
        );
    });
});

// User Bookings Page
app.get('/my-bookings', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    const query = `
        SELECT 
            m.title AS movie_name,
            b.seats AS seats_booked,
            b.booking_time AS booking_time
        FROM 
            bookings b
        JOIN 
            movies m ON b.movie_id = m.id
        WHERE
            b.user_id = ?
        ORDER BY 
            b.booking_time DESC;
    `;
    
    db.query(query, [req.session.user.id], (err, results) => {
        if (err) {
            console.error("Error fetching bookings:", err.message);
            return res.status(500).send("Error fetching bookings");
        }
        res.render('my-bookings', { bookings: results, user: req.session.user });
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
