// File: roomsettings.js (Client-Side Logic for Room Settings)

const socket = io();
const roomCode = localStorage.getItem('currentRoomCode');
const playerName = localStorage.getItem("playerName") || "Unknown";
const statusEl = document.getElementById('settings-save-status');

if (!roomCode) {
    // If no room code is found, redirect to entry
    setTimeout(() => { window.location.href = 'room_entry.html'; }, 0);
}

socket.on('connect', () => {
    // When connecting, ensure we join the room (to receive settings updates) 
    socket.emit('joinRoom', { name: playerName, code: roomCode });
    socket.emit('getRoomSettings', { roomCode });
});

// A fallback handler for updates while on the settings page
socket.on('settingsUpdated', ({ settings }) => {
    console.log("Received settings update broadcast while on settings page.");
    updateForm(settings);
});

socket.on('roomError', (message) => {
    statusEl.textContent = `Error: ${message}`;
});

socket.on('receiveSettings', (settings) => {
    updateForm(settings);
    statusEl.textContent = 'Current settings loaded.';
});

function updateForm(settings) {
    if (!settings) return;
    // NOTE: settings.mode should now always be normalized (e.g., 'fast-furious')
    document.getElementById('gameMode').value = settings.mode;
    document.getElementById('teams').value = settings.teams;
    document.getElementById('rounds').value = settings.rounds;
    document.getElementById('maxPlayers').value = settings.maxPlayers;
}

function normalizeMode(modeString) {
    // Converts "Fast and Furious" or "Fast And Furious" to "fast-furious"
    return (modeString || 'freestyle').toLowerCase().replace(/\s/g, '-');
}

function saveSettings() {
    statusEl.textContent = 'Saving...';
    
    // Get the raw value from the dropdown
    const rawMode = document.getElementById('gameMode').value;
    
    const settings = {
        // Mode is normalized here before sending to server
        mode: normalizeMode(rawMode),
        teams: document.getElementById('teams').value,
        rounds: parseInt(document.getElementById('rounds').value),
        maxPlayers: parseInt(document.getElementById('maxPlayers').value)
    };
    
    // Basic client-side validation
    if (isNaN(settings.rounds) || settings.rounds < 1 || settings.rounds > 20 || 
        isNaN(settings.maxPlayers) || settings.maxPlayers < 2 || settings.maxPlayers > 10) {
        statusEl.textContent = 'Error: Rounds must be 1-20 and Max Players must be 2-10.';
        return;
    }
    
    // Host sends new settings to the server using a callback for confirmation
    socket.emit('updateRoomSettings', { roomCode, settings }, (response) => {
        if (response.success) {
            statusEl.textContent = '✅ Settings successfully saved and updated!';
        } else {
            statusEl.textContent = `❌ Save Error: ${response.message}`;
            // Re-fetch or revert form to last known good settings on failure
            socket.emit('getRoomSettings', { roomCode });
        }
    });
}

/**
 * Handles navigation back to the lobby.
 * This is crucial for the host persistence timer.
 */
function returnToLobby() {
    console.log('Attempting asynchronous redirect to roomlobby.html...');
    // FIX: Use setTimeout to ensure navigation executes without being blocked
    setTimeout(() => {
        window.location.href = 'roomlobby.html';
    }, 0); 
}

// --- Attachments ---

document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
        saveBtn.onclick = saveSettings;
    }

    const backBtn = document.getElementById('back-to-lobby-btn');
    if (backBtn) {
        backBtn.onclick = returnToLobby;
    }
});

// Expose functions globally (Critical for inline onclick attributes)
window.saveSettings = saveSettings;
window.returnToLobby = returnToLobby;