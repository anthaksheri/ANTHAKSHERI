// server.js (Final Integration)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// 💡 IMPORT ALL GAME LOGIC MODULES
const { initializeGame } = require('./gameserver'); 
const { initializeRoomGame } = require('./roomserver'); // New Import

// --- SERVER SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server); 
const PUBLIC_DIR = path.join(__dirname, 'public');

// HTTP ROUTING & Static File Serving
app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'home.html'));
});
// Ensure the client files are accessible, typically by placing all HTML/JS/CSS in a 'public' directory
app.use(express.static(PUBLIC_DIR));

// 💡 INITIALIZE BOTH GAME LOGIC MODULES
initializeGame(io, app, PUBLIC_DIR); 
initializeRoomGame(io, app, PUBLIC_DIR); // Activation of Room Logic

// --- START LISTENING ON THE PORT ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server listening on http://localhost:${PORT}`);
    console.log(`Architecture: Single Node.js server handling multiple game modules (Public Lobbies & Private Rooms).`);
});