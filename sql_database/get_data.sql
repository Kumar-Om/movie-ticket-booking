
-- available tickets
SELECT 
    id AS movie_id, 
    title AS movie_name, 
    (100 - total_seats_booked) AS available_seats 
FROM movies;

select * from movies;
select * from bookings;

-- booking order
SELECT 
    m.title AS movie_name,
    b.seats AS seats_booked,
    b.booking_time AS booking_time
FROM 
    bookings b
JOIN 
    movies m ON b.movie_id = m.id
ORDER BY 
    b.booking_time ASC;

-- seeing user data
select * from users;