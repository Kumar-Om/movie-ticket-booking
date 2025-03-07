-- DROP DATABASE IF EXISTS movie_booking;
-- CREATE DATABASE movie_booking;
-- USE movie_booking;

-- Movies Table
CREATE TABLE movies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    image VARCHAR(255),
    rating DECIMAL(3,1),
    total_seats_booked INT DEFAULT 0
);

-- Bookings Table
CREATE TABLE bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    movie_id INT,
    seats INT NOT NULL,
    booking_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
);
DROP TABLE IF EXISTS bookings;

CREATE TABLE bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    movie_id INT,
    seats INT NOT NULL,
    booking_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
);

-- users
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL,
    password VARCHAR(255) NOT NULL
);
ALTER TABLE bookings
ADD COLUMN user_id INT,
ADD FOREIGN KEY (user_id) REFERENCES users(id);


-- Insert Movies with 100 seats available initially
INSERT INTO movies (title, image, rating) VALUES 
('Avengers: Endgame', '/images/endgame.jpg', 8.4),
('Inception', '/images/inception.jpg', 8.8),
('Joker', '/images/joker.jpg', 8.5);

