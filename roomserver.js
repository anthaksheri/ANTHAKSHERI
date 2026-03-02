// File: roomserver.js (Unified Server-Side Logic with Mode-Specific Features - FINAL CORRECTION)

const path = require('path');
const fs = require('fs');

let ioRef; 

// ==== GLOBAL CONSTANTS ====
const BASE_TURN_TIME_LIMIT = 10.0; // Base Seconds allowed per turn (Freestyle/Noun War)
const HOST_RECONNECT_TIMEOUT_MS = 180000;
const hostDisconnectTimeouts = {};

// --- Word Pool Setup ---
let SERVER_COMBINED_POOL = [];
let SERVER_NOUN_POOL = [];

function loadServerWordPool(PUBLIC_DIR) {
    try {
        const wordListData = fs.readFileSync(path.join(PUBLIC_DIR, 'wordlist.txt'), 'utf8');
        const nounListData = fs.readFileSync(path.join(PUBLIC_DIR, 'nounlist.txt'), 'utf8');
        SERVER_COMBINED_POOL = Array.from(new Set(wordListData.split(/\r?\n/).map(w => w.trim()).filter(Boolean)));
        SERVER_NOUN_POOL = Array.from(new Set(nounListData.split(/\r?\n/).map(w => w.trim()).filter(Boolean)));
        console.log(`✅ Room Server word pool loaded. Combined: ${SERVER_COMBINED_POOL.length}, Noun: ${SERVER_NOUN_POOL.length}`);
    } catch (error) {
        console.error("❌ ERROR: Could not load word lists in Room Server. Using fallbacks.");
        SERVER_COMBINED_POOL = ["apple", "banana", "cart", "dog", "elephant", "tiger", "robot", "zebra", "unit", "table", "end", "run", "eat", "cat", "time", "energy", "system", "matrix", "synth", "yellow", "wind"];
        SERVER_NOUN_POOL = ["apple", "banana", "cart", "dog", "elephant", "tiger", "robot", "zebra", "unit", "table", "system", "matrix", "synth"];
    }
}

// --- ROOM STATE MANAGEMENT ---
const rooms = {};

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms[code]);
    return code;
}

// --- Utility functions ---

/**
 * Normalizes a mode string for consistent internal use (e.g., "Fast and Furious" -> "fast-furious").
 * @param {string} modeString 
 * @returns {string} Normalized mode string.
 */
function normalizeMode(modeString) {
    return (modeString || 'freestyle').toLowerCase().replace(/\s/g, '-');
}

/**
 * Determines the word pool based on game mode.
 */
function getActiveDictionary(mode) {
    // Check against the normalized mode
    if (normalizeMode(mode) === "noun-war") return SERVER_NOUN_POOL;
    return SERVER_COMBINED_POOL; 
}

/**
 * Determines the turn time limit based on game mode.
 * 🎯 FIX APPLIED: Normalizes mode input for reliable check.
 */
function getTurnTimeLimit(mode) {
    const normalizedMode = normalizeMode(mode);
    
    if (normalizedMode === "fast-furious") return 5.0;
    
    return BASE_TURN_TIME_LIMIT; // 10.0 seconds
}

function getRandomStartingWord(mode) {
    let pool = getActiveDictionary(mode);
    const randomIndex = Math.floor(Math.random() * pool.length);
    return pool[randomIndex] || 'start';
}

function isWordValid(word, currentLetter, usedWords, activeWordList) {
    word = word.trim().toLowerCase();

    if (!/^[a-z]+$/.test(word)) return { valid: false, reason: "Word contains invalid characters." };
    if (!word) return { valid: false, reason: "Word cannot be empty." };
    
    if (word[0] !== currentLetter.toLowerCase()) return { valid: false, reason: `Word must start with "${currentLetter.toUpperCase()}".` };
    if (usedWords.includes(word)) return { valid: false, reason: "Word has already been used." };
    
    if (!activeWordList.includes(word)) { 
        return { valid: false, reason: "Word not found in server's dictionary for this mode." };
    }

    return { valid: true, reason: "Word accepted." };
}

function advanceRoomTurn(roomCode, wordPlayed = true, skipReason = null) {
    const room = rooms[roomCode];
    if (!room || !room.started || room.players.length === 0) return;

    const previousPlayer = room.players[room.currentTurnIndex];
    
    const nextTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    room.currentTurnIndex = nextTurnIndex;
    const nextPlayer = room.players[nextTurnIndex];

    if (wordPlayed) {
        room.roundsWithoutWord = 0;
    } else {
        room.roundsWithoutWord += 1;
    }

    let lastWord = room.lastWord.trim().toLowerCase();
    let isStalemate = false;
    
    if (room.roundsWithoutWord >= room.players.length && room.players.length > 0) {
        // --- STALEMATE LOGIC: ADVANCE ROUND ---
        isStalemate = true;
        
        room.currentRound += 1; 
        
        const newWord = getRandomStartingWord(room.settings.mode);
        room.lastWord = newWord;
        room.usedWords = [newWord]; 
        room.roundsWithoutWord = 0;
        lastWord = newWord;
        skipReason = `Stalemate triggered! Starting new cycle ${room.currentRound} with ${newWord.toUpperCase()}`;
    }
    
    if (nextTurnIndex === 0 && wordPlayed && !isStalemate) {
        room.currentRound += 1;
        room.roundsWithoutWord = 0;
    }
    
    if (room.currentRound > room.settings.rounds) {
        const results = room.players.map(p => ({ 
            name: p, 
            score: room.scores[p] || 0 
        })).sort((a, b) => b.score - a.score);
        
        ioRef.to(roomCode).emit('gameOver', { results });
        return;
    }
    
    // Calculate the turn limit based on the current mode
    const turnLimit = getTurnTimeLimit(room.settings.mode);
    
    room.currentTurnStartTime = Date.now();
    
    // Emit the state update for the next player's turn
    ioRef.to(roomCode).emit('updateGameState', { 
        player: skipReason ? (isStalemate ? 'SYSTEM' : previousPlayer) : null, 
        reason: skipReason, 
        word: isStalemate ? lastWord : null, 
        timeTaken: isStalemate ? 0 : null,
        points: isStalemate ? 0 : null,
        nextPlayer: nextPlayer, 
        lastWord: lastWord, 
        currentRound: room.currentRound,
        scores: room.scores,
        usedWords: room.usedWords,
        turnTimeLimit: turnLimit,
        turnTimeLeft: turnLimit
    });
}

function validateRoomSettings(settings) {
    // 🎯 FIX: Validation must use the normalized mode string
    const normalizedMode = normalizeMode(settings.mode);
    const { teams, rounds, maxPlayers } = settings;

    if (!['freestyle', 'noun-war', 'fast-furious'].includes(normalizedMode)) {
        return 'Invalid game mode.';
    }
    if (teams !== 'solo') {
        return 'Invalid team mode.';
    }
    if (isNaN(rounds) || rounds < 1 || rounds > 20) {
        return 'Rounds must be between 1 and 20.';
    }
    if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) {
        return 'Max Players must be between 2 and 10.';
    }
    // Validation passed
    return null;
}

// --- GAME FLOW MANAGEMENT ---

function startRoomGame(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.started || room.players.length < 2) return;

    let players = [...room.players];
    for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [players[i], players[j]] = [players[j], players[i]];
    }

    room.players = players;
    room.started = true;
    room.currentRound = 1;
    room.currentTurnIndex = 0;
    room.roundsWithoutWord = 0; 
    
    // CRITICAL: Calculate mode-specific time limit upon game start for sync
    const turnLimit = getTurnTimeLimit(room.settings.mode); 
    room.currentTurnStartTime = Date.now();
    
    players.forEach(p => room.scores[p] = 0);

    const firstWord = getRandomStartingWord(room.settings.mode);
    room.lastWord = firstWord;
    room.usedWords = [firstWord]; 
    
    ioRef.to(roomCode).emit('gameStarting', {
        players,
        mode: room.settings.mode,
        firstWord,
        startingPlayer: players[0],
        maxRounds: room.settings.rounds,
        turnTimeLimit: turnLimit // Ensure the limit is available to matchmaking client
    });

    console.log(`Room game ${roomCode} starting. Mode: ${room.settings.mode}, Timer: ${turnLimit}s`);
}

function startRoomCountdown(code, initialTime) {
    const room = rooms[code];
    
    if (room.countdownRef) {
        clearInterval(room.countdownRef);
        room.countdownRef = null;
    }
    
    if (!room || !ioRef) {
        console.error(`ERROR: Cannot start countdown for room ${code}. Room or IO object missing.`);
        return; 
    }

    room.countdownRemaining = initialTime;
    console.log(`DEBUG: Starting Phase ${room.countdownPhase} for room ${code}. Initial Time: ${initialTime}`); 

    room.countdownRef = setInterval(() => {
        room.countdownRemaining--;

        if (room.countdownPhase === 1) {
            ioRef.to(code).emit('matchmakingWaitTimer', room.countdownRemaining, room.hostName); 
        } else if (room.countdownPhase === 2) {
            ioRef.to(code).emit('matchmakingCountdown', room.countdownRemaining);
        }

        if (room.countdownRemaining < 0) {
            clearInterval(room.countdownRef);
            room.countdownRef = null;

            if (room.countdownPhase === 1) {
                console.log(`Room ${code}: Phase 1 timed out. Starting Phase 2.`);
                room.status = 'MATCHMAKING_PHASE_2';
                room.countdownPhase = 2;
                startRoomCountdown(code, 10); 
            
            } else if (room.countdownPhase === 2) {
                console.log(`Room ${code}: Phase 2 complete. Starting Game.`);
                room.status = 'IN_GAME';
                room.countdownPhase = 0;
                startRoomGame(code); 
            }
        }
    }, 1000);
}


// ----------------------------------------------------
// 🎯 SOCKET.IO HANDLERS
// ----------------------------------------------------

module.exports.initializeRoomGame = (io, app, PUBLIC_DIR) => {
    loadServerWordPool(PUBLIC_DIR);
    ioRef = io; 
    
    io.on('connection', (socket) => {
        
        // --- 1. Lobby Entry & Creation ---
        socket.on('createRoom', ({ name }) => {
            const code = generateRoomCode();
            socket.join(code);
            socket.roomCode = code;
            socket.playerName = name;

            rooms[code] = {
                code,
                hostId: socket.id,
                hostName: name,
                players: [name],
                scores: {},
                settings: { mode: 'freestyle', teams: 'solo', rounds: 5, maxPlayers: 10 },
                status: 'LOBBY', 
                started: false,
                countdownRef: null, 
                countdownRemaining: 20, 
                countdownPhase: 0, 
                usedWords: [], lastWord: '', currentRound: 1, currentTurnIndex: 0, roundsWithoutWord: 0,
                currentTurnStartTime: null
            };
            ioRef.to(code).emit('roomCreated', code);
        });

        // --- 2. Join Room (Handles new joins and reconnections) ---
        socket.on('joinRoom', ({ name, code }) => {
            const room = rooms[code];
            if (!room) { socket.emit('roomError', 'Room does not exist.'); return; }

            const isReconnectingHost = (room.hostName === name);
            const isPlayerAlreadyInList = room.players.includes(name);

            if (room.status !== 'LOBBY' && !isPlayerAlreadyInList) { 
                socket.emit('roomError', 'Room is full or game has started/is starting.'); 
                return; 
            }
            
            if (!isPlayerAlreadyInList) {
                if (room.players.length >= room.settings.maxPlayers) { socket.emit('roomError', 'Room is full.'); return; }
                room.players.push(name);
            }
            
            // HOST PERSISTENCE FIX
            if (isReconnectingHost) {
                room.hostId = socket.id;
                if (hostDisconnectTimeouts[name]) {
                    clearTimeout(hostDisconnectTimeouts[name]);
                    delete hostDisconnectTimeouts[name];
                    console.log(`Host (${name}) reconnected. Disconnect timer cleared.`);
                }
            }

            socket.join(code);
            socket.roomCode = code;
            socket.playerName = name;
            
            ioRef.to(code).emit('updateLobby', { players: room.players, hostName: room.hostName, settings: room.settings });
            socket.emit('roomJoined', { code, players: room.players, hostName: room.hostName, settings: room.settings });
        });

        // --- 3. Matchmaking Initiation (Host Clicks 'Move to Matchmaking') ---
        socket.on('hostStartMatchmaking', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (room && room.hostName === socket.playerName && room.players.length >= 2 && room.status === 'LOBBY') {
                
                room.status = 'MATCHMAKING_PHASE_1'; 
                room.countdownPhase = 1;
                
                startRoomCountdown(roomCode, 20); 
                ioRef.to(roomCode).emit('hostStartMatchmaking', { hostName: room.hostName }); 
            }
        });

        // --- 4. Host Force Start (Ends Phase 1 early) ---
        socket.on('hostForceStartMatchmaking', ({ roomCode }) => {
            const room = rooms[roomCode];
            
            if (room && room.hostName === socket.playerName && room.status === 'MATCHMAKING_PHASE_1') {
                
                if (room.countdownRef) {
                    clearInterval(room.countdownRef);
                    room.countdownRef = null;
                }
                
                room.status = 'MATCHMAKING_PHASE_2';
                room.countdownPhase = 2;
                
                ioRef.to(roomCode).emit('matchmakingPhaseTransition', 'PHASE_2');
                startRoomCountdown(roomCode, 10); 
            }
        });
        
        // --- 5. Matchmaking Sync (Handles client reconnection after redirect) ---
        socket.on('rejoinRoomForMatchmaking', ({ code, name }) => {
            const room = rooms[code];
            if (!room) { socket.emit('roomError', 'Room deleted/not found.'); return; }
            
            if (room.hostName === name) {
                room.hostId = socket.id;
                if (hostDisconnectTimeouts[name]) {
                    clearTimeout(hostDisconnectTimeouts[name]);
                    delete hostDisconnectTimeouts[name];
                    console.log(`Host (${name}) reconnected to matchmaking. Timer cleared.`);
                }
            }
            
            socket.roomCode = code; 
            socket.playerName = name;
            socket.join(code); 
            ioRef.to(code).emit('updateMatchmaking', room.players); 

            if (room.status === 'MATCHMAKING_PHASE_1' && room.countdownRef) {
                socket.emit('matchmakingWaitTimer', room.countdownRemaining, room.hostName);
            } else if (room.status === 'MATCHMAKING_PHASE_2' && room.countdownRef) {
                socket.emit('matchmakingCountdown', room.countdownRemaining);
            }
            else if (room.status === 'MATCHMAKING_PHASE_2' && !room.countdownRef) {
                socket.emit('matchmakingPhaseTransition', 'PHASE_2');
            }
        });
        
        // --- 6 & 7: Settings Handlers (Lobby Settings) ---
        socket.on('getRoomSettings', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (room && room.hostName === socket.playerName) {
                room.hostId = socket.id; 
                socket.emit('receiveSettings', room.settings);
            } else {
                socket.emit('roomError', 'You are not authorized to view settings.');
            }
        });

        socket.on('updateRoomSettings', ({ roomCode, settings }, callback) => {
            const room = rooms[roomCode];

            if (!room || room.hostName !== socket.playerName) {
                if (typeof callback === 'function') {
                    return callback({ success: false, message: 'Authorization failed. Host name mismatch.' });
                }
                return;
            }
            room.hostId = socket.id; 
            
            // 🎯 FIX: Normalize the incoming mode string for storage and validation
            const normalizedSettings = { ...settings };
            normalizedSettings.mode = normalizeMode(settings.mode);

            const validationError = validateRoomSettings(normalizedSettings);
            if (validationError) {
                if (typeof callback === 'function') {
                    return callback({ success: false, message: validationError });
                }
                return;
            }
            if (normalizedSettings.maxPlayers < room.players.length) {
                if (typeof callback === 'function') {
                    return callback({ success: false, message: `Cannot set Max Players to ${normalizedSettings.maxPlayers}. There are currently ${room.players.length} players in the room.` });
                }
                return;
            }
            // Store the normalized settings object
            room.settings = normalizedSettings;
            
            if (typeof callback === 'function') {
                callback({ success: true });
            }
            // Emit the stored normalized settings back to the lobby
            ioRef.to(roomCode).emit('settingsUpdated', { settings: normalizedSettings });
        });
        
        // --- 9. Game Sync (Handles client connection after redirect to roomgame.html) ---
        socket.on('rejoinRoomForGame', ({ code, name }) => {
            const room = rooms[code];
            
            if (!room || room.status !== 'IN_GAME') { 
                socket.emit('roomError', 'Game is not active or room deleted.'); 
                return; 
            }
            
            socket.roomCode = code; 
            socket.playerName = name;
            socket.join(code); 
            
            if (room.hostName === name) {
                room.hostId = socket.id;
                
                if (hostDisconnectTimeouts[name]) {
                    clearTimeout(hostDisconnectTimeouts[name]);
                    delete hostDisconnectTimeouts[name];
                    console.log(`Host (${name}) reconnected to active game. Disconnect timer cleared.`);
                }
            }
            
            // Calculate the turn limit based on the current mode (now robustly checked)
            const turnLimit = getTurnTimeLimit(room.settings.mode);
            
            // CRITICAL FIX: Calculate remaining time for rejoining player
            let turnTimeLeftCalculated = turnLimit;
            if (room.currentTurnStartTime) {
                const timeElapsed = (Date.now() - room.currentTurnStartTime) / 1000;
                turnTimeLeftCalculated = Math.max(0.01, turnLimit - timeElapsed); 
            }
            
            socket.emit('gameSyncState', { 
                players: room.players,
                lastWord: room.lastWord,
                usedWords: room.usedWords,
                currentRound: room.currentRound,
                currentPlayer: room.players[room.currentTurnIndex],
                mode: room.settings.mode, 
                maxRounds: room.settings.rounds,
                turnTimeLimit: turnLimit, 
                turnTimeLeft: turnTimeLeftCalculated, 
                scores: room.scores
            });
            
            console.log(`✅ ${name} successfully re-joined room ${code} for active game.`);
        });
        
        // --- 10. ADDED: GAME EVENT: Word Submitted (WITH REJECTION TIMER FIX) ---
        socket.on('wordSubmitted', ({ roomCode, word: inputWord, timeTaken }) => {
            const room = rooms[roomCode];
            const playerName = socket.playerName;
            
            if (!room || !room.started || room.players[room.currentTurnIndex] !== playerName) return;
            
            const word = inputWord ? inputWord.trim().toLowerCase() : '';
            const lastWord = room.lastWord.trim().toLowerCase();
            const requiredLetter = lastWord.length > 0 ? lastWord.slice(-1) : 'a';

            const validationResult = isWordValid(
                word,
                requiredLetter,
                room.usedWords,
                getActiveDictionary(room.settings.mode) 
            );
            
            // Calculate the turn limit based on the current mode
            const turnLimit = getTurnTimeLimit(room.settings.mode);

            // CRITICAL FIX: Calculate remaining time for rejection
            const timeElapsed = (Date.now() - room.currentTurnStartTime) / 1000;
            const timeRemaining = Math.max(0.01, turnLimit - timeElapsed);

            if (!validationResult.valid) {
                // Do NOT advance turn. Just notify the player and send time remaining.
                socket.emit('wordRejected', { 
                    reason: validationResult.reason,
                    timeRemaining: timeRemaining 
                });
                return;
            }

            // --- VALID WORD ACCEPTED ---
            const calculatedPoints = word.length; 
            room.usedWords.push(word);
            room.scores[playerName] = (room.scores[playerName] || 0) + calculatedPoints;
            room.lastWord = word;
            
            // Emit word played notification to all
            ioRef.to(roomCode).emit('updateGameState', {
                player: playerName, 
                word: word,
                timeTaken: timeTaken,
                points: calculatedPoints,
                nextPlayer: room.players[(room.currentTurnIndex + 1) % room.players.length],
                lastWord: word,
                currentRound: room.currentRound,
                scores: room.scores,
                usedWords: room.usedWords,
                turnTimeLimit: turnLimit,
                turnTimeLeft: turnLimit // The next player gets a full clock
            });
            
            // Advance to the next player
            advanceRoomTurn(roomCode, true); 
        });

        // --- 11. ADDED: GAME EVENT: Turn Timeout ---
        socket.on('turnTimeout', ({ roomCode, playerName }) => {
            const room = rooms[roomCode];

            if (!room || !room.started || room.players[room.currentTurnIndex] !== playerName) return;
            
            // Advance the turn, indicating a skip
            advanceRoomTurn(roomCode, false, `${playerName} failed to respond in time.`);
        });
        
        // --- 8. Disconnect Handling (WITH 3-MINUTE HOST RECONNECT WINDOW) ---
        socket.on('disconnect', () => {
            const code = socket.roomCode;
            const room = rooms[code];
            
            if (room && socket.playerName) {
                
                if (room.hostId === socket.id) {
                    console.log(`Host (${socket.playerName}) disconnected (likely navigated). Starting ${HOST_RECONNECT_TIMEOUT_MS/1000}s reconnect timer.`);

                    room.hostId = null; 

                    if (hostDisconnectTimeouts[socket.playerName]) {
                        clearTimeout(hostDisconnectTimeouts[socket.playerName]);
                    }

                    hostDisconnectTimeouts[socket.playerName] = setTimeout(() => {
                        
                        if (rooms[code] && rooms[code].players.includes(room.hostName) && room.hostName === socket.playerName) {
                            room.players = room.players.filter(p => p !== socket.playerName);
                            delete room.scores[socket.playerName];
                            
                            if (room.players.length > 0) {
                                room.hostName = room.players[0]; 
                                console.log(`Host ${socket.playerName} truly left after timeout. New host is: ${room.hostName}`);
                            } else {
                                delete rooms[code];
                                console.log(`Lobby ${code} deleted (Empty after host timeout).`);
                                return;
                            }

                            ioRef.to(code).emit('updateLobby', { players: room.players, hostName: room.hostName, settings: room.settings });
                        }
                        
                        delete hostDisconnectTimeouts[socket.playerName];

                    }, HOST_RECONNECT_TIMEOUT_MS);
                    
                    return;
                } 
                
                // --- Non-Host Player Disconnect Logic ---
                if (room.status === 'LOBBY') {
                    
                    room.players = room.players.filter(p => p !== socket.playerName);
                    delete room.scores[socket.playerName];
                    
                    if (room.players.length === 0) {
                        delete rooms[code];
                        console.log(`Lobby ${code} deleted (Empty).`);
                        return;
                    }

                    if (!room.players.includes(room.hostName) && room.players.length > 0) {
                        room.hostName = room.players[0]; 
                        console.log(`Original host truly left. New host is: ${room.hostName}`);
                    }
                    
                    ioRef.to(code).emit('updateLobby', { players: room.players, hostName: room.hostName, settings: room.settings });
                    
                } else if (room.status.startsWith('MATCHMAKING') || room.status === 'IN_GAME') {
                    console.log(`${socket.playerName} disconnected, but room ${code} is active. Player list protected for reconnection.`);
                }
            }
        });
    });
};