import fs from 'fs';
import https from 'https';
import express from 'express';
import os from 'os';
import { Server } from 'socket.io';

const SERVER_PORT = 8080;
const STATIC_FOLDER = './public/';

const app = express();

// CORS + COOP/COEP headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
});

// Serve static files
app.use(express.static(STATIC_FOLDER));

// Detect first non-internal IPv4
function getLocalIPv4() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const ipAddress = getLocalIPv4();

// Create HTTPS server
const httpsServer = https.createServer(
    {
        key: fs.readFileSync('ssl/key.pem'),
        cert: fs.readFileSync('ssl/cert.pem')
    },
    app
);

// Listen on all interfaces
httpsServer.listen(SERVER_PORT, '0.0.0.0', () => {
    console.log(`Server running at: \x1b[36mhttps://${ipAddress}:${SERVER_PORT}\x1b[0m`);
});

// Socket.IO setup
const socketServer = new Server(httpsServer);
socketServer.on('connection', (socket) => {
    socket.on('data', (data) => socketServer.emit('data', data));
});
