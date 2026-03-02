// File: roommatchmaking.js (Final Client-Side Logic with Debugging)

const socket = io();
const roomCode = localStorage.getItem('currentRoomCode');
const playerName = localStorage.getItem("playerName");
let currentHostName = '';

if (!roomCode || !playerName) {
    console.error("Missing player or room data.");
    window.location.href = 'room_entry.html';
}

socket.on('connect', () => {
    socket.emit('rejoinRoomForMatchmaking', { code: roomCode, name: playerName }); 
    console.log(`DEBUG: Socket connected. Requesting sync for room ${roomCode}.`);
});

// --- Host Button Rendering Function (Remains the same) ---
function renderHostButton(hostNameFromServer) {
    currentHostName = hostNameFromServer;
    const hostControls = document.getElementById('host-controls');
    hostControls.innerHTML = '';

    if (playerName === currentHostName) {
        const startButton = document.createElement('button');
        startButton.id = 'force-start-btn';
        startButton.textContent = 'START GAME NOW (Host)';
        startButton.className = 'host-button';
        startButton.onclick = () => {
            if (confirm("End the join window and start the final countdown (Phase 2)?")) {
                socket.emit('hostForceStartMatchmaking', { roomCode });
                startButton.disabled = true; 
                startButton.textContent = 'Starting Phase 2...';
            }
        };
        hostControls.appendChild(startButton);
    }
}

// --- Event Listeners ---

// 1. Player List Sync (Remains the same)
socket.on('updateMatchmaking', (players) => {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    
    if (players && players.length > 0) {
        players.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p + (p === playerName ? ' (You)' : '');
            list.appendChild(li);
        });
    }
});

// New Listener for Host Name on Initial Redirect (Remains the same)
socket.on('hostStartMatchmaking', ({ hostName: serverHostName }) => {
    renderHostButton(serverHostName);
});

// New Listener for Phase Transition (Remains the same)
socket.on('matchmakingPhaseTransition', (phase) => {
    if (phase === 'PHASE_2') {
        document.getElementById('host-controls').innerHTML = ''; 
    }
});

// 2. PHASE 1: Wait/Join Timer (Remains the same)
socket.on('matchmakingWaitTimer', (timeLeft, serverHostName) => {
    const title = document.getElementById('matchmaking-title');
    const countdown = document.getElementById('countdown');
    
    if (!currentHostName) {
        renderHostButton(serverHostName); 
    }

    title.textContent = "Waiting for players to join (20s max window)...";
    countdown.textContent = `Join-in window closing in: ${timeLeft} seconds`;
});

// 3. PHASE 2: Game Start Countdown (Remains the same)
socket.on('matchmakingCountdown', (timeLeft) => {
    const title = document.getElementById('matchmaking-title');
    const countdown = document.getElementById('countdown');
    
    document.getElementById('host-controls').innerHTML = ''; 
    
    title.textContent = "Match Finalized! Get Ready!";
    countdown.textContent = `Game starting in ${timeLeft}...`;
});

// 4. CRITICAL: GAME START REDIRECT
socket.on('gameStarting', (data) => {
    // CRITICAL DEBUG: If you see this in the browser console, the redirect must happen.
    console.log("!!! CLIENT RECEIVED 'gameStarting'. FORCING REDIRECT to roomgame.html !!!");
    
    try {
        localStorage.setItem('finalPlayers', JSON.stringify(data.players));
        localStorage.setItem('startFirstWord', data.firstWord || '');
        localStorage.setItem('selectedMode', data.mode);
        localStorage.setItem('maxRounds', data.maxRounds); 
        
        // This is the line that must execute.
        window.location.href = 'roomgame.html'; 
    } catch (e) {
        console.error("FATAL ERROR: Failed to save data or redirect.", e);
        // Display a severe error message if the redirect fails
        document.getElementById('countdown').textContent = "ERROR: Failed to launch game! Check console (F12).";
    }
});

// 5. Error Handling (Remains the same)
socket.on('roomError', (message) => {
    alert(`Matchmaking Error: ${message}. Returning to lobby.`);
    window.location.href = 'roomlobby.html'; 
});