// File: roomlobby.js (Client-Side Logic for Private Room Lobby)
const playerName = localStorage.getItem("playerName") || "Unknown";
const playerId = localStorage.getItem("playerId");

let roomCode = localStorage.getItem('targetRoomCode'); // Used for joining
let isHost = false;

// Socket.IO Connection
const socket = io();

socket.on('connect', () => {
    const action = localStorage.getItem('roomAction');
    
    if (action === 'create') {
        socket.emit('createRoom', { name: playerName });
    } else if (action === 'join' && roomCode) {
        socket.emit('joinRoom', { name: playerName, code: roomCode });
    } else if (action === 'settings_return' && roomCode) {
        // Host is returning from roomsettings.html
        // Use the standard joinRoom event. The server logic handles the host persistence/timer cancellation.
        socket.emit('joinRoom', { name: playerName, code: roomCode });
        
        // Clear the special flag after use
        localStorage.removeItem('roomAction');
    } else {
        alert("Invalid lobby access. Redirecting.");
        // Use timeout for robust navigation
        setTimeout(() => { window.location.href = 'index.html'; }, 0);
    }
});

// --- Server Handlers ---

socket.on('roomCreated', (code) => {
    roomCode = code;
    isHost = true;
    localStorage.setItem('currentRoomCode', code);
    document.getElementById('room-code').textContent = code;
    document.getElementById('host-name').textContent = `${playerName} (You) 👑`;
    document.getElementById('host-controls').classList.remove('hidden');
    document.getElementById('lobby-status').textContent = 'Room created successfully. Share the code!';
    updatePlayerList([playerName], playerName); // Initial player list
});

socket.on('roomJoined', ({ code, players, hostName, settings }) => {
    roomCode = code;
    // CRITICAL: Checks if THIS player's name matches the persistent hostName
    isHost = (playerName === hostName); 
    localStorage.setItem('currentRoomCode', code);

    document.getElementById('room-code').textContent = code;
    document.getElementById('host-name').textContent = isHost ? `${hostName} (You) 👑` : `${hostName} 👑`;
    document.getElementById('lobby-status').textContent = isHost ? 'You are the Host.' : `Joined successfully. Waiting for ${hostName} to start.`;

    // CRITICAL: Controls host interface visibility
    if (isHost) {
        document.getElementById('host-controls').classList.remove('hidden');
    } else {
        document.getElementById('host-controls').classList.add('hidden');
    }

    updateSettingsSummary(settings);
    updatePlayerList(players, hostName);
});

socket.on('roomError', (message) => {
    alert(`Room Error: ${message}`);
    setTimeout(() => { window.location.href = 'room_entry.html'; }, 0);
});

socket.on('updateLobby', ({ players, hostName, settings }) => {
    // This event handles player changes AND host name change
    updateSettingsSummary(settings);
    updatePlayerList(players, hostName);
    
    // Re-evaluate host status in case of host transfer
    isHost = (playerName === hostName);
    
    // Update host name display for all players
    document.getElementById('host-name').textContent = isHost ? `${hostName} (You) 👑` : `${hostName} 👑`;
    
    // Re-display host controls if status changed to host
    if (isHost) {
        document.getElementById('host-controls').classList.remove('hidden');
        document.getElementById('lobby-status').textContent = 'You are the Host.';
    } else {
        document.getElementById('host-controls').classList.add('hidden');
        document.getElementById('lobby-status').textContent = `Waiting for ${hostName} to start.`;
    }
});


// Handler for Host's Settings Changes
socket.on('settingsUpdated', ({ settings }) => {
    console.log('Server broadcasted new room settings:', settings);
    
    // Update the visible settings summary
    updateSettingsSummary(settings);
    
    document.getElementById('lobby-status').textContent = isHost ? 'You are the Host.' : 'Room settings updated by the Host.';

    // Re-check the start button constraints (Max Players might have changed)
    const currentPlayers = Array.from(document.getElementById('players-list').children)
        .map(li => li.textContent.replace(' (You)', '').replace(' 👑', '').trim());
        
    const hostNameText = document.getElementById('host-name').textContent;
    const currentHostName = hostNameText.replace(' (You)', '').replace(' 👑', '').trim();
    
    updatePlayerList(currentPlayers, currentHostName);
});


socket.on('hostStartMatchmaking', () => {
    // All players are directed to the matchmaking screen
    setTimeout(() => { window.location.href = 'roommatchmaking.html'; }, 0);
});

// --- UI Updates ---

function updatePlayerList(players, hostName) {
    const list = document.getElementById('players-list');
    const maxPlayers = parseInt(document.getElementById('setting-max').textContent) || 10; 
    list.innerHTML = '';
    
    players.forEach(p => {
        const li = document.createElement('li');
        
        // FIX: Add CSS classes for styling (player-item) and host highlight (host-player)
        li.classList.add('player-item'); 
        
        const isSelf = p === playerName ? ' (You)' : '';
        const isHostLabel = p === hostName ? ' 👑' : '';
        
        if (p === hostName) {
            li.classList.add('host-player'); 
        }
        
        li.textContent = p + isHostLabel + isSelf;
        list.appendChild(li);
    });
    
    document.getElementById('player-count').textContent = players.length;
    document.getElementById('setting-max-players').textContent = maxPlayers;

    // Enable/Disable start button based on constraints
    const startBtn = document.getElementById('start-btn');
    if (isHost && players.length >= 2) { 
        startBtn.disabled = false;
        startBtn.textContent = "Move to Matchmaking";
    } else if (isHost) {
        startBtn.disabled = true;
        startBtn.textContent = `Need ${Math.max(0, 2 - players.length)} more player(s)`;
    }
}

function updateSettingsSummary(settings) {
    if (!settings) return;
    document.getElementById('setting-mode').textContent = settings.mode;
    document.getElementById('setting-teams').textContent = settings.teams;
    document.getElementById('setting-rounds').textContent = settings.rounds;
    document.getElementById('setting-max').textContent = settings.maxPlayers;
    document.getElementById('setting-max-players').textContent = settings.maxPlayers;
}

// --- Host Action Handlers ---

/**
 * Host function to transition to the settings page.
 * Stores the intent in localStorage to allow reconnection.
 */
function goToSettings() {
    if (isHost) {
        // 1. Store the intent to return to the lobby after settings change
        localStorage.setItem('roomAction', 'settings_return'); 
        // 2. Store the room code 
        localStorage.setItem('targetRoomCode', roomCode); 
        
        console.log('Attempting asynchronous redirect to roomsettings.html...');
        
        // CRITICAL FIX: Use setTimeout to ensure navigation executes without being blocked
        setTimeout(() => {
            window.location.href = 'roomsettings.html';
        }, 0); 
    } else {
        alert("Only the Host can access settings.");
    }
}

function requestMatchmaking() {
    if (isHost) {
        socket.emit('hostStartMatchmaking', { roomCode });
    }
}

// --- Global Attachments ---

// Attach event listeners on DOM load
document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.onclick = requestMatchmaking;
    }
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.onclick = goToSettings; 
    }
});

// EXPOSE FUNCTIONS GLOBALLY (Critical for inline onclick attributes)
window.goToSettings = goToSettings;
window.requestMatchmaking = requestMatchmaking;