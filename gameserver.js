const path = require('path');
const fs = require('fs');

// 💡 CORRECT EXPORT: Exporting the function under the property name 'initializeGame'
module.exports.initializeGame = (io, app, PUBLIC_DIR) => {

    // 🎯 GLOBAL SERVER CONSTANTS
    const MAX_PLAYERS = 6;
    const MIN_PLAYERS_START = 1;
    const MAX_ROUNDS = 5;

    // 🎯 GLOBAL WORD POOLS (LOADED ON STARTUP)
    let SERVER_COMBINED_POOL = [];
    let SERVER_NOUN_POOL = [];

    function loadServerWordPool() {
        try {
            const wordListData = fs.readFileSync(path.join(PUBLIC_DIR, 'wordlist.txt'), 'utf8');
            const nounListData = fs.readFileSync(path.join(PUBLIC_DIR, 'nounlist.txt'), 'utf8');

            const wordList = wordListData.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
            const nounList = nounListData.split(/\r?\n/).map(w => w.trim()).filter(Boolean);

            SERVER_NOUN_POOL = Array.from(new Set(nounList));
            SERVER_COMBINED_POOL = Array.from(new Set([...wordList, ...nounList]));
            console.log(`✅ Game Server word pool loaded.`);
            // You can re-enable detailed counts if needed:
            // console.log(`\t- Combined words (Freestyle/Fast): ${SERVER_COMBINED_POOL.length}`);
            // console.log(`\t- Noun words (Noun War): ${SERVER_NOUN_POOL.length}`);
        } catch (error) {
            console.error("❌ ERROR: Could not load word lists in Game Server. Using fallbacks.", error.message);
            SERVER_COMBINED_POOL = ["apple", "banana", "cart", "dog", "elephant", "tiger", "robot", "zebra", "unit", "table", "end", "run", "eat"];
            SERVER_NOUN_POOL = ["apple", "banana", "cart", "dog", "elephant", "tiger", "robot", "zebra", "unit", "table"];
        }
    }
    loadServerWordPool();

    // ----------------------------------------------------
    // 🎯 GLOBAL GAME STATE AND VALIDATION FUNCTIONS
    // ----------------------------------------------------

    const lobbies = {};

    function getActiveDictionary(mode) {
        if (mode === "noun-war") {
            return SERVER_NOUN_POOL;
        }
        return SERVER_COMBINED_POOL;
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

    function getRandomStartingWord(mode) {
        let pool = getActiveDictionary(mode);
        const randomIndex = Math.floor(Math.random() * pool.length);
        return pool[randomIndex] || 'start';
    }

    // ----------------------------------------------------
    // 🎯 TURN & ROUND MANAGEMENT FUNCTIONS
    // ----------------------------------------------------

    function advanceTurn(mode, wordPlayed = true) {
        const lobby = lobbies[mode];
        if (!lobby || !lobby.started) return;

        const nextTurnIndex = (lobby.currentTurnIndex + 1) % lobby.players.length;
        const nextPlayer = lobby.players[nextTurnIndex];

        if (wordPlayed) {
            lobby.roundsWithoutWord = 0;
        } else {
            lobby.roundsWithoutWord += 1;
        }

        lobby.currentTurnIndex = nextTurnIndex;

        if (nextTurnIndex === 0 && wordPlayed) {
            startNextRound(mode, false); 
            return;
        }
        
        if (lobby.roundsWithoutWord >= lobby.players.length && lobby.players.length > 0) {
            io.to(`lobby-${mode}`).emit('lobbyStatus', 'Stalemate reached! Ending round.');
            startNextRound(mode, true); 
            return;
        }

        io.to(`lobby-${mode}`).emit('nextTurn', { 
            nextPlayer: nextPlayer,
            lastWord: lobby.lastWord,
            currentRound: lobby.currentRound
        });
    }

    function startNextRound(mode, isStalemateEnd) {
        const lobby = lobbies[mode];
        if (!lobby) return;

        if (lobby.currentRound >= MAX_ROUNDS) {
            io.to(`lobby-${mode}`).emit('gameOver', {
                scores: lobby.scores,
                players: lobby.players
            });
            
            if (lobby.countdown) clearInterval(lobby.countdown);
            delete lobbies[mode];
            console.log(`Game over for mode ${mode}. Lobby deleted.`);
            return;
        }

        lobby.currentRound += 1;
        lobby.roundsWithoutWord = 0;
        
        let message = 'Chain continues!';
        
        if (isStalemateEnd) {
            const newWord = getRandomStartingWord(mode);
            lobby.lastWord = newWord;
            lobby.usedWords = [newWord]; 
            message = `Stalemate broken! Starting new chain with: ${newWord.toUpperCase()}`;
        }

        io.to(`lobby-${mode}`).emit('roundAdvanced', {
            currentRound: lobby.currentRound,
            lastWord: lobby.lastWord, 
            message: message
        });

        io.to(`lobby-${mode}`).emit('nextTurn', { 
            nextPlayer: lobby.players[lobby.currentTurnIndex],
            lastWord: lobby.lastWord,
            currentRound: lobby.currentRound
        });

        console.log(`Round ${lobby.currentRound} Advanced for mode ${mode}. Stalemate reset: ${isStalemateEnd}`);
    }

    function startGameForMode(mode) {
        const lobby = lobbies[mode];
        if (!lobby || lobby.started || lobby.players.length < MIN_PLAYERS_START) return;

        let players = [...lobby.players];
        for (let i = players.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [players[i], players[j]] = [players[j], players[i]];
        }

        lobby.players = players;
        lobby.started = true;
        lobby.currentRound = 1;
        lobby.currentTurnIndex = 0;
        
        players.forEach(p => {
            lobby.scores[p] = 0;
        });

        const firstWord = getRandomStartingWord(mode);
        lobby.lastWord = firstWord;
        lobby.usedWords = [firstWord]; 

        io.to(`lobby-${mode}`).emit('gameStarting', {
            players,
            mode,
            firstWord,
            startingPlayer: players[0],
            maxRounds: MAX_ROUNDS 
        });

        io.to(`lobby-${mode}`).emit('updatePlayers', lobby.players);

        console.log(`Game starting for mode ${mode}, Round 1 of ${MAX_ROUNDS}. Starting word: ${firstWord}`);
    }


    // ----------------------------------------------------
    // 🎯 SOCKET.IO HANDLERS
    // ----------------------------------------------------

    io.on('connection', (socket) => {
        // --- Lobby Management (Player Joining) ---
        socket.on('joinLobby', ({ name, mode }) => {
            if (!name || !mode) return;

            socket.playerName = name;
            socket.mode = mode;

            if (!lobbies[mode]) {
                lobbies[mode] = {
                    players: [],
                    scores: {},
                    countdown: null,
                    timeLeft: null,
                    started: false,
                    currentTurnIndex: 0,
                    lastWord: '',
                    usedWords: [],
                    currentRound: 1,
                    roundsWithoutWord: 0
                };
            }

            const lobby = lobbies[mode];
            const isNameTaken = lobby.players.some(p => p === name);

            if (isNameTaken || lobby.players.length >= MAX_PLAYERS || lobby.started) {
                socket.emit('error', 'Lobby issue: Name taken, full, or game started.');
                return;
            }

            lobby.players.push(name);
            lobby.scores[name] = lobby.scores[name] || 0;
            socket.join(`lobby-${mode}`);

            io.to(`lobby-${mode}`).emit('updatePlayers', lobby.players);

            // Start/Manage Countdown
            if (!lobby.countdown && !lobby.started) {
                lobby.timeLeft = 10;
                io.to(`lobby-${mode}`).emit('lobbyStatus', `Starting countdown...`);

                lobby.countdown = setInterval(() => {
                    io.to(`lobby-${mode}`).emit('lobbyTimer', lobby.timeLeft);
                    lobby.timeLeft -= 1;

                    if (lobby.players.length >= MAX_PLAYERS || lobby.timeLeft < 0) {
                        clearInterval(lobby.countdown);
                        lobby.countdown = null;

                        if (lobby.players.length >= MIN_PLAYERS_START) {
                            startGameForMode(mode);
                        } else {
                            lobby.timeLeft = 10;
                            lobby.countdown = null;
                            io.to(`lobby-${mode}`).emit('lobbyStatus', `Waiting for players...`);
                        }
                    }
                }, 1000);
            }
        });

        // --- Game Synchronization (Word Submitted) ---
        socket.on('wordSubmitted', ({ word: inputWord, timeTaken }) => {
            const mode = socket.mode;
            const lobby = lobbies[mode];
            const playerName = socket.playerName;
            
            const word = inputWord ? inputWord.trim().toLowerCase() : '';

            if (!lobby || !lobby.started || lobby.players[lobby.currentTurnIndex] !== playerName) return;
            if (!/^[a-z]+$/.test(word)) { 
                  socket.emit('wordRejected', { reason: "Word contains invalid characters." });
                  return;
            }

            const lastWord = lobby.lastWord.trim().toLowerCase();
            const requiredLetter = lastWord.length > 0 ? lastWord.slice(-1) : 'a';

            const validationResult = isWordValid(
                word,
                requiredLetter,
                lobby.usedWords,
                getActiveDictionary(mode) 
            );

            if (!validationResult.valid) {
                socket.emit('wordRejected', { reason: validationResult.reason });
                return;
            }

            // --- VALID WORD ACCEPTED ---
            const calculatedPoints = word.length; 

            lobby.usedWords.push(word);
            lobby.scores[playerName] = (lobby.scores[playerName] || 0) + calculatedPoints;
            lobby.lastWord = word;

            io.to(`lobby-${mode}`).emit('wordPlayed', {
                player: playerName,
                word: word,
                timeTaken: timeTaken,
                points: calculatedPoints,
                nextPlayer: lobby.players[(lobby.currentTurnIndex + 1) % lobby.players.length]
            });

            advanceTurn(mode, true); 
        });

        // --- Game Synchronization (Turn Timeout) ---
        socket.on('turnTimeout', ({ playerName }) => {
            const mode = socket.mode;
            const lobby = lobbies[mode];

            if (!lobby || !lobby.started || lobby.players[lobby.currentTurnIndex] !== playerName) return;

            io.to(`lobby-${mode}`).emit('turnSkipped', {
                player: playerName,
                nextPlayer: lobby.players[(lobby.currentTurnIndex + 1) % lobby.players.length],
                currentRound: lobby.currentRound
            });

            advanceTurn(mode, false);
        });

        // --- Disconnect Handling ---
        socket.on('disconnect', () => {
            const name = socket.playerName;
            const mode = socket.mode;

            if (mode && lobbies[mode]) {
                const lobby = lobbies[mode];

                if (lobby.players.length > 0) {
                    const wasCurrentPlayer = lobby.started && lobby.players[lobby.currentTurnIndex] === name;
                    
                    const initialPlayerCount = lobby.players.length;
                    lobby.players = lobby.players.filter(p => p !== name);
                    delete lobby.scores[name];

                    if (lobby.players.length < initialPlayerCount) {
                        io.to(`lobby-${mode}`).emit('updatePlayers', lobby.players);

                        if (lobby.players.length === 0) {
                            if (!lobby.started && lobby.countdown) clearInterval(lobby.countdown);
                            delete lobbies[mode];
                            console.log(`Lobby for mode ${mode} deleted.`);
                            return;
                        }

                        if (wasCurrentPlayer || lobby.currentTurnIndex >= lobby.players.length) {
                            
                            lobby.currentTurnIndex = lobby.currentTurnIndex % lobby.players.length; 
                            
                            if (lobby.started) {
                                io.to(`lobby-${mode}`).emit('turnSkipped', { 
                                    player: name + " (Disconnected)", 
                                    nextPlayer: lobby.players[lobby.currentTurnIndex],
                                    currentRound: lobby.currentRound
                                });
                                advanceTurn(mode, false);
                            }
                        } 
                    }
                }
            }
        });
    });
}; // End of module.exports.initializeGame