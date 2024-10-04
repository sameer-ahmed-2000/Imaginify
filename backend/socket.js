const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

const init = (server) => {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        }
    });

    io.use((socket, next) => {
        const token = socket.handshake.query.token;
        if (token) {
            try {
                const user = jwt.verify(token, process.env.JWT_SECRET);
                console.log('Decoded user:', user);
                if (!user) {
                    return next(new Error('Not authorized.'));
                }
                socket.user = user;
                return next();
            } catch (err) {
                console.error('Token error:', err);
                next(new Error('Token invalid or expired.'));
            }
        } else {
            return next(new Error('Not authorized.'));
        }
    });
    

    io.on('connection', (socket) => {
        socket.join(socket.user.userId);
        console.log('userId', socket.user.userId)
        console.log('Socket connected:', socket.id);
        socket.on('disconnect', () => {
            console.log('Socket disconnected:', socket.id);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};

module.exports = {
    init,
    getIO
};
