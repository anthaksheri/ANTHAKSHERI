// File: roomgame.js (Client-Side Logic for Active Room Game Session - FINAL with Flow Optimization)

const socket = io();

// ==== Global Variables & State ====
let playerName = localStorage.getItem("playerName") || "Guest";
let roomCode = localStorage.getItem("currentRoomCode") || null; 
let finalPlayers = JSON.parse(localStorage.getItem('finalPlayers') || '[]');
let isHost = (localStorage.getItem("role") === 'host');

let currentPlayer = finalPlayers.length > 0 ? finalPlayers[0] : null; 
let currentLetter = ''; 
let usedWords = [];
let scores = {};
let isMyTurn = false;
let turnTimeLimit = 10.0; 
let timer, startTime; 
let currentRound = 1;
let maxRounds = 5;

// Client-side dictionary for validation (NOTE: These lists should be loaded/kept in sync with the server's word lists)
const CLIENT_COMBINED_LIST = ["apple", "banana", "cart", "dog", "elephant", "tiger", "robot", "zebra", "unit", "table", "end", "run", "eat", "cat", "time", "energy", "system", "matrix", "synth", "yellow", "wind"]; 
const CLIENT_NOUN_LIST = ["apple", "banana", "dog", "elephant", "tiger", "robot", "zebra", "unit", "table", "system", "matrix", "synth"]; 
let activeWordList = CLIENT_COMBINED_LIST;

// --- DOM References ---
const roundDisplayEl = document.getElementById("round-display");
const requiredLetterEl = document.getElementById("required-letter");
const playerInputEl = document.getElementById("player-input");
const errorMsgEl = document.getElementById("error-msg");
const timerEl = document.getElementById("timer");
const playersListEl = document.getElementById("players-list");
const wordListEl = document.getElementById("wordList");
const gameOverModalEl = document.getElementById("gameover-modal");


// ==== Core Game Functions ====

function setGameMode(modeString) {
    const mode = (modeString || 'freestyle').toLowerCase().replace(/\s/g, '-');
    
    if (mode === "noun-war") {
        activeWordList = CLIENT_NOUN_LIST; 
    } else {
        activeWordList = CLIENT_COMBINED_LIST;
    }
}

function updateRoundDisplay() {
    roundDisplayEl.textContent = `[CYCLE ${currentRound}/${maxRounds}]`;
}

function highlightTurn(player) {
    document.querySelectorAll(".player-box").forEach(box => box.classList.remove("active-turn"));
    const box = document.getElementById(`player-box-${player}`);
    if (box) box.classList.add("active-turn");
}

function setupPlayerScoreboard() {
    if (playersListEl && playersListEl.children.length === 0) { 
        playersListEl.innerHTML = '<h3>[OPERATIVE MANIFEST]</h3>'; 
        finalPlayers.forEach(name => {
            const box = document.createElement("div");
            box.className = "player-box";
            box.id = `player-box-${name}`;
            const displayScore = scores[name] !== undefined ? scores[name] : 0;
            box.innerHTML = `<span class="player-name">${name}</span> — <span class="player-score" id="score-${name}">${displayScore}</span>`;
            playersListEl.appendChild(box);
            if (scores[name] === undefined) scores[name] = 0;
        });
    }
}

/**
 * Starts the turn, using turnTimeLeft to resume the clock if necessary (e.g., reconnection).
 * @param {string} player The player whose turn it is.
 * @param {string} lastWord The word that ended the previous turn.
 * @param {number} turnTimeLeft The time remaining on the clock for this turn.
 */
function startTurn(player, lastWord, turnTimeLeft = turnTimeLimit) {
    clearInterval(timer);
    currentPlayer = player;
    isMyTurn = (currentPlayer === playerName);
    highlightTurn(currentPlayer);
    
    const normalizedLastWord = (lastWord || '').trim().toLowerCase(); 
    currentLetter = normalizedLastWord.length > 0 ? normalizedLastWord.slice(-1) : 'a';

    requiredLetterEl.textContent = `INITIATE: ${currentLetter.toUpperCase()} // FROM: ${normalizedLastWord || 'START'}`;
    playerInputEl.value = "";
    errorMsgEl.textContent = ""; 
    
    // Reset confirmation flag (though largely unused in this flow-optimized version)
    playerInputEl.dataset.confirmedSubmit = 'false';

    // Update Scoreboard Display
    finalPlayers.forEach(name => {
        const scoreEl = document.getElementById(`score-${name}`);
        if (scoreEl) scoreEl.textContent = scores[name] !== undefined ? scores[name] : 0;
    });

    // Start Timer Logic
    if (isMyTurn) {
        playerInputEl.disabled = false;
        playerInputEl.focus();
        
        // Set startTime based on remaining time (used for sync/rejoin)
        const remainingTime = turnTimeLeft;
        startTime = Date.now() - (turnTimeLimit - remainingTime) * 1000;
        
        timer = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const timeCheck = Math.max(0, turnTimeLimit - elapsed);
            timerEl.textContent = `⏳ ${timeCheck.toFixed(2)}s`;
            
            if (timeCheck <= 0) {
                clearInterval(timer);
                playerInputEl.disabled = true;
                socket.emit('turnTimeout', { roomCode, playerName });
            }
        }, 10);
    } else {
        playerInputEl.disabled = true;
        timerEl.textContent = `WAITING FOR ${player.toUpperCase()}...`;
    }
}

// Client-Side Validation Logic (Pre-server check for UX)
function validateClientWord(word, requiredLetter) {
    word = word.trim().toLowerCase();
    
    if (!word) { return { valid: false, reason: "Word cannot be empty." }; }
    if (!/^[a-z]+$/.test(word)) { return { valid: false, reason: "Word contains invalid characters." }; }
    if (word[0] !== requiredLetter.toLowerCase()) { 
        return { valid: false, reason: `Must start with "${requiredLetter.toUpperCase()}".` }; 
    }
    if (usedWords.includes(word)) { 
        return { valid: false, reason: "Word has already been used." }; 
    }
    
    // Check against the client's dictionary subset
    if (!activeWordList.includes(word)) { 
        return { valid: false, reason: "Client dictionary check failed. Submit anyway? (Server will re-check)" }; 
    }

    return { valid: true, reason: "Valid locally." };
}

function submitWord() {
    if (!isMyTurn || playerInputEl.disabled) return;
    
    const word = playerInputEl.value.trim().toLowerCase();
    
    // --- CLIENT-SIDE VALIDATION ---
    const validationResult = validateClientWord(word, currentLetter);

    // 1. HARD REJECTION: Reject instantly for wrong letter, used word, or invalid chars.
    // This maintains the critical speed for obvious errors.
    if (!validationResult.valid && !validationResult.reason.startsWith("Client dictionary check failed")) {
        errorMsgEl.textContent = `❌ ERROR: Invalid word. Try again!`; 
        playerInputEl.dataset.confirmedSubmit = 'false'; // Keep flag clear
        return; 
    }
    
    // 2. SOFT REJECTION / UNKNOWN WORD: If the only failure is the client dictionary check,
    // we bypass the warning and immediately proceed to submit to the server to maintain flow.
    if (validationResult.reason.startsWith("Client dictionary check failed")) {
        errorMsgEl.textContent = `⚡ Local check failed. Submitting to server for final verdict...`;
    } 

    // --- SUBMISSION LOGIC ---
    
    // Calculate the total time taken since the start of the turn
    const timeTaken = (Date.now() - startTime) / 1000;

    // CRITICAL: Emit to server while the client timer continues to run.
    socket.emit('wordSubmitted', { roomCode, word, timeTaken: parseFloat(timeTaken.toFixed(2)) });
    
    // Temporarily indicate that submission is in progress
    errorMsgEl.textContent = "⏳ Submitting word to server...";
}

function updateWordHistory(word, player, info) {
    const list = wordListEl;
    const listItem = document.createElement("li");
    
    const colorPrimary = '#198754';
    const colorSecondary = '#ffc107';
    
    listItem.innerHTML = `
        <span style="color:${colorPrimary};"> &gt; ${word} </span>
        <span style="font-size: 0.8em; color:${colorSecondary};"> // ${info}</span>
    `;

    if (list.firstChild) {
        list.insertBefore(listItem, list.firstChild);
    } else {
        list.appendChild(listItem);
    }
}

function showCountdown(callback) {
    const overlay = document.getElementById("countdown-overlay");
    const text = document.getElementById("countdown-text");
    if (!overlay || !text) { callback(); return; } 

    overlay.classList.remove("hidden");
    const sequence = ["3", "2", "1", "GO!"];
    let i = 0;
    const countdown = setInterval(() => {
        text.textContent = sequence[i];
        i++;
        if (i === sequence.length) {
            clearInterval(countdown);
            setTimeout(() => {
                overlay.classList.add("hidden");
                callback();
            }, 700);
        }
    }, 1000);
}

// ==== Socket.IO Setup and Handlers ====
function initializeSocket() {
    
    socket.on('connect', () => {
        socket.emit('rejoinRoomForGame', { name: playerName, code: roomCode }); 
    });

    socket.on('error', (message) => { alert(`SERVER ERR: ${message}`); });
    socket.on('roomError', (message) => { alert(`ROOM ERR: ${message}. Returning to entry.`); window.location.href = 'room_entry.html'; });

    // --- 1. INITIAL GAME STATE SYNC ---
    socket.on('gameSyncState', (data) => {
        
        maxRounds = data.maxRounds;
        currentRound = data.currentRound;
        turnTimeLimit = data.turnTimeLimit;
        setGameMode(data.mode); 
        usedWords = data.usedWords || [];
        scores = data.scores || {};
        currentPlayer = data.currentPlayer;

        setupPlayerScoreboard(); 
        
        wordListEl.innerHTML = '';
        data.usedWords.slice().reverse().forEach(word => {
            updateWordHistory(word, 'SYSTEM', 'SYNC');
        });
        
        updateRoundDisplay();
        
        showCountdown(() => {
            startTurn(data.currentPlayer, data.lastWord, data.turnTimeLeft);
        });
    });
    
    // --- 2. TURN ADVANCEMENT (Word Accepted) ---
    socket.on('updateGameState', (data) => {
        
        if (data.word) {
            const info = `+${data.points} | ${data.timeTaken.toFixed(2)}s`;
            updateWordHistory(data.word, data.player, info);
        } else if (data.reason) {
            const info = `SKIP: ${data.reason}`;
            updateWordHistory(data.player, data.player, info); 
        }
        
        currentRound = data.currentRound;
        usedWords = data.usedWords;
        scores = data.scores;
        updateRoundDisplay();
        turnTimeLimit = data.turnTimeLimit; 

        // FIX: Stop the timer and disable input only when the word is accepted and the turn advances
        clearInterval(timer);
        playerInputEl.disabled = true;

        startTurn(data.nextPlayer, data.lastWord, data.turnTimeLeft);
    });

    // --- 3. WORD REJECTION (Timer Continues) ---
    socket.on('wordRejected', ({ reason, timeRemaining }) => {
        // Display the requested "Invalid word" message
        errorMsgEl.textContent = `❌ ERROR: Invalid word. Try again!`;
        
        // Clear the client-side confirmation flag (not used, but good for cleanup)
        playerInputEl.dataset.confirmedSubmit = 'false';
        
        // FIX: Smoothly resume the existing timer by resetting the internal start time.
        if (timeRemaining !== undefined) {
            // 1. Reset the internal clock (startTime) to make the timer interval continue from the correct point
            startTime = Date.now() - (turnTimeLimit - timeRemaining) * 1000;
            
            // 2. Ensure the input field is re-enabled, cleared, and focused
            // The timer (setInterval) is still running from before submitWord was called.
            playerInputEl.disabled = false;
            playerInputEl.value = ""; // Clear the wrong word
            playerInputEl.focus();
            
            // Optional: Include time left in the error message for feedback
            errorMsgEl.textContent += ` (Time left: ${timeRemaining.toFixed(2)}s)`;
        } 
    });
    
    // --- 4. GAME END ---
    socket.on('gameOver', (data) => {
        clearInterval(timer);
        playerInputEl.disabled = true;
        
        localStorage.setItem('finalGameResults', JSON.stringify(data.results));

        if (gameOverModalEl) {
            const winner = data.results.reduce((prev, current) => (prev.score > current.score) ? prev : current, { score: -Infinity, name: 'TIE' });
            document.getElementById("gameover-message").textContent = `Winner: ${winner.name} with ${winner.score} points!`;
            gameOverModalEl.classList.remove("hidden");
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    // Initial setup from Local Storage
    const storedSettings = JSON.parse(localStorage.getItem('roomSettings') || '{}');
    if (storedSettings.gameMode) {
        setGameMode(storedSettings.gameMode); 
    }
    
    const storedMaxRounds = parseInt(localStorage.getItem('maxRounds'), 10);
    if (!isNaN(storedMaxRounds)) {
        maxRounds = storedMaxRounds;
    }
    updateRoundDisplay();

    // Attach submitWord to the input field
    playerInputEl.addEventListener("keydown", e => {
        if (e.key === "Enter" && !playerInputEl.disabled) {
            submitWord();
        }
    });

    if (finalPlayers.length > 0 && roomCode) {
        playerInputEl.dataset.confirmedSubmit = 'false'; // Initialize client-side confirmation flag
        setupPlayerScoreboard(); 
        initializeSocket();
    } else {
        alert("Fatal Error: Could not find required game parameters (Players or Room Code).");
        window.location.href = 'room_entry.html';
    }
});