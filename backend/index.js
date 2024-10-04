const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const helmet = require('helmet');
const http = require('http');
const rootRouter = require('./routes/index');
const { authMiddleware } = require('./middleware');
require('dotenv').config();
const socket = require('./socket');
const app = express();
const server = http.createServer(app);
const io = socket.init(server);

// Security middleware
app.use(helmet());

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// CORS and JSON parsing middleware
app.use(cors());
app.use(express.json());

// Passport.js middleware
app.use(passport.initialize());
app.use(passport.session());

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Root API route, inject io into requests
app.use('/api/v1', (req, res, next) => {
    req.io = io;
    next();
}, rootRouter);
// Use HTTP server to listen for connections
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
