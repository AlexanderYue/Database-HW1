const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const app = express();

// Set up middleware
app.use(bodyParser.json()); // Parse incoming JSON requests
app.use(cors()); // Enable Cross-Origin Resource Sharing (CORS)
app.use(express.json()); // Parse JSON data from the body
app.use(express.static(path.join(__dirname, 'views'))); // Serve static files from 'views' folder
app.use(express.static(path.join(__dirname, 'images'))); // Serve static files from 'images' folder

// Database connection setup using PostgreSQL
/*
-------------------------- Edit This -----------------------
*/
const pool = new Pool({
    user: 'alexanderyue',
    host: 'localhost',
    database: 'HW',
    password: '6823',
    port: 5432,
});

// Endpoint to update customer balance
app.post('/update-balance', async (req, res) => {
    const { cust_id } = req.body; // Get customer ID from the request body

    console.log(`Customer ID: ${cust_id}`);

    try {
        // Query the database to get the customer's owed balance
        const result = await pool.query(`
            SELECT owed_balance
            FROM customer
            WHERE customer_id = $1;
        `, [cust_id]);

        // Check if the customer exists in the database
        if (result.rows.length > 0) {
            const customer = result.rows[0];
            res.json({ success: true, data: customer }); // Return the customer data
        } else {
            res.json({ success: false, message: 'Customer not found.' }); // Return error if customer not found
        }
    } catch (error) {
        console.error("Error fetching customer data:", error);
        res.status(500).json({ success: false, message: 'Database error.' }); // Handle database error
    }
});

// Endpoint to update customer information (e.g., call minutes, text used, data used)
app.post('/update-info', async (req, res) => {
    const { cust_id } = req.body;

    console.log(`Customer ID: ${cust_id}`);

    try {
        // Query to fetch customer data including call minutes, text usage, and data used
        const result = await pool.query(`
            SELECT 
                c.text_used, 
                COALESCE(SUM(cr.call_minutes), 0) AS total_call_minutes, -- Aggregate call_minutes
                COALESCE(SUM(cr.data_used), 0) AS total_data_used       -- Aggregate data_used
            FROM 
                customer c
            JOIN 
                phone_plan p ON c.plan_id = p.plan_id
            LEFT JOIN 
                call_record cr ON c.customer_id = cr.customer_id -- Join with call_record table to get the data
            WHERE 
                c.customer_id = $1
            GROUP BY 
                c.customer_id, c.text_used; -- Group by customer_id and text_used
        `, [cust_id]);

        if (result.rows.length > 0) {
            const customer = result.rows[0];
            res.json({ success: true, data: customer }); // Return the data to the client
        } else {
            res.json({ success: false, message: 'Customer not found.' }); // Handle customer not found
        }
    } catch (error) {
        console.error("Error fetching customer data:", error);
        res.status(500).json({ success: false, message: 'Database error.' }); // Handle database error
    }
});

// Endpoint to check account credentials (login)
app.post('/check-account', async (req, res) => {
    const { name, email, phone, pwd } = req.body; // Destructure input fields from the request body

    console.log(`Name: ${name}, Email: ${email}, Phone: ${phone}, Password: ${pwd}`);

    try {
        // Query to fetch customer details based on the provided phone number
        const result = await pool.query(`
            SELECT 
                c.customer_id, 
                c.name, 
                c.phone_number, 
                c.owed_balance, 
                c.plan_id, 
                c.payment_method,
                c.email, 
                p.plan_name, 
                p.plan_type, 
                p.price, 
                p.features,
                p.text_limit,
                p.talk_minutes,
                c.text_used,
                c.pwd, -- Password field from database
                COALESCE(SUM(cr.call_minutes), 0) AS total_call_minutes, -- Aggregate call_minutes
                COALESCE(SUM(cr.data_used), 0) AS total_data_used       -- Aggregate data_used
            FROM 
                customer c
            JOIN 
                phone_plan p ON c.plan_id = p.plan_id
            LEFT JOIN 
                call_record cr ON c.customer_id = cr.customer_id
            WHERE 
                c.phone_number = $1
            GROUP BY 
                c.customer_id, c.name, c.phone_number, c.owed_balance, c.plan_id, 
                c.payment_method, c.email, p.plan_name, p.plan_type, p.price, 
                p.features, p.text_limit, p.talk_minutes, c.pwd;
        `, [phone]);

        if (result.rows.length > 0) {
            const user = result.rows[0];

            // Check if the provided password matches the stored password
            if (user.pwd === pwd) {
                console.log(user);
                res.json({ success: true, data: user });
            } else {
                res.json({ success: false, message: 'Password incorrect.' });
            }
        } else {
            res.json({ success: false, message: 'No account found.' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Endpoint to process customer payment
app.post('/process-payment', async (req, res) => {
    const { cust_id, cardNumber, expiryDate, cvc, paymentAmount } = req.body;

    const client = await pool.connect(); // Get a client to use for the transaction

    try {
        await client.query('BEGIN'); // Start a database transaction

        // Check the customer's owed balance
        const customerResult = await client.query(`
            SELECT owed_balance
            FROM customer
            WHERE customer_id = $1;
        `, [cust_id]);

        if (customerResult.rows.length > 0) {
            const customer = customerResult.rows[0];

            if (paymentAmount > customer.owed_balance) {
                return res.json({ success: false, message: 'Payment cannot exceed the amount owed.' });
            }
        } else {
            return res.json({ success: false, message: 'Customer not found.' });
        }

        // Check if account details match in the bank database
        const result = await client.query(`
            SELECT
                cust_id,
                balance,
                card_num,
                ex_date,
                cvc
            FROM
                cust_bank
            WHERE
                cust_id = $1
                AND card_num = $2
                AND ex_date = $3
                AND cvc = $4;
        `, [cust_id, cardNumber, expiryDate, cvc]);

        if (result.rows.length > 0) {
            const user = result.rows[0];

            // Check if the user has sufficient funds in their bank account
            if (user.balance >= paymentAmount) {
                // Update the bank and customer balance after payment
                await client.query(`
                    UPDATE cust_bank
                    SET balance = balance - $1
                    WHERE cust_id = $2;
                `, [paymentAmount, cust_id]);

                await client.query(`
                    UPDATE customer
                    SET owed_balance = owed_balance - $1
                    WHERE customer_id = $2;
                `, [paymentAmount, cust_id]);

                // Insert payment record into the payment table
                await client.query(`
                    INSERT INTO payment (customer_id, amount, payment_date)
                    VALUES ($1, $2, $3);
                `, [cust_id, paymentAmount, new Date()]);

                await client.query('COMMIT'); // Commit the transaction
                res.json({ success: true, message: 'Payment processed successfully' });
            } else {
                await client.query('ROLLBACK'); // Rollback the transaction in case of error
                res.json({ success: false, message: 'Insufficient bank balance.' });
            }
        } else {
            await client.query('ROLLBACK');
            res.json({ success: false, message: 'Incorrect payment details.' });
        }
    } catch (error) {
        console.error("Error processing payment:", error);
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: 'Database error.' });
    } finally {
        client.release(); // Release the client back to the pool
    }
});

// Endpoint to check if the customer is busy
app.post('/checkBusy', (req, res) => {
    const { number, cust_id } = req.body;
    console.log('Request Body:', req.body);
  
    // Validate input
    if (!cust_id || !number || isNaN(number)) {
      return res.status(400).json({ message: 'Invalid input data' });
    }
  
    // SQL query to check the busy status
    const checkBusy = 'SELECT busy FROM customer WHERE customer_id = $1 OR phone_number = $2';
  
    // Execute the query to check if the customer is busy
    pool.query(checkBusy, [cust_id, number], (err, result) => {
      if (err) {
        console.error('Error fetching busy status:', err);
        return res.status(500).json({ message: 'Error checking busy status' });
      }
  
      if (result.rows.length > 0) {
        // Check if the customer is busy
        const isBusy = result.rows[0].busy;
        return res.json({ isBusy });
      } else {
        return res.status(404).json({ message: 'Customer not found' });
      }
    });
});


const PORT = 3000; // Or any port you prefer
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
