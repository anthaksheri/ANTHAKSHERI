// File: game.js (Client-Side Logic for Multiplayer Word Chain)

// ==== Global Variables ====
let currentLetter = '';
let usedWords = [];
let remainingTime = 0;
let turnTimeLimit = 0; // Set by setGameMode
let timer, startTime;

let scores = {};
let playerName = 'You';

// 🔹 Multiplayer variables
let socket;
let isMyTurn = false;
let currentPlayer = '';
let currentRound = 1;
let maxRounds = 5;

let activeWordList = []; 

// ==== Word List Loading (for Client-Side Validation) ====
async function loadWordLists() {
    const mockWordList = "apple\nbanana\ncart\ndog\nfish\ngate\nhat\nink\njump\nking\nlight\nmouse\nnewt\norange\nelephant\ntiger\nrobot\nzebra\nunit\ntable\nrun\neat";
    const mockNounList = "apple\nbanana\ndog\nking\nlight\nmouse\nnewt\norange\nelephant\ntiger\nrobot\nzebra\nunit\ntable";

    try {
        // Try to fetch the word list files from the server
        const wordListData = await fetch('wordlist.txt').then(res => res.text()).catch(() => mockWordList);
        const nounListData = await fetch('nounlist.txt').then(res => res.text()).catch(() => mockNounList);

        const finalWordData = (wordListData && wordListData.length > 10) ? wordListData : mockWordList;
        const finalNounData = (nounListData && nounListData.length > 10) ? nounListData : mockNounList;

        const wordList = finalWordData.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
        const nounList = finalNounData.split(/\r?\n/).map(w => w.trim()).filter(Boolean);

        const combinedList = [...new Set([...wordList, ...nounList])];
        
        window.combinedList = combinedList;
        window.nounList = nounList;

    } catch (error) {
        console.error("❌ Error loading word lists:", error);
    }
}

// ==== Game Mode Settings ====
function setGameMode(mode) {
    const combinedList = window.combinedList || [];
    const nounList = window.nounList || [];
    
    if (mode === "noun-war") {
        activeWordList = nounList; // Client uses Noun list
        turnTimeLimit = 10.0;
    } else if (mode === "fast-furious") {
        activeWordList = combinedList;
        turnTimeLimit = 5.0;
    } else { // "freestyle" or unknown
        activeWordList = combinedList;
        turnTimeLimit = 10.0;
    }
}

// ==== UI Management ====
function highlightTurn(player) {
    document.querySelectorAll(".player-box").forEach(box => box.classList.remove("active-turn"));
    const box = document.getElementById(`player-box-${player}`);
    if (box) box.classList.add("active-turn");
}

function updateHistory(word, info) {
    const list = document.getElementById("wordList");
    const li = document.createElement("li");
    li.textContent = `${word} ${info ? '— ' + info : ''}`;
    list.prepend(li); 
}

function updateScore(player, points) {
    scores[player] = (scores[player] || 0) + parseFloat(points);
    const el = document.getElementById(`score-${player}`);
    if (el) el.textContent = scores[player].toFixed(2);
}

function updateRoundDisplay() {
    document.getElementById("round-display").textContent = 
        `Round ${currentRound} of ${maxRounds}`;
}

function clearHistory() {
    document.getElementById("wordList").innerHTML = '';
}

// ==== Turn Synchronization and Timer ====
function startTurn(player, lastWord) {
    clearInterval(timer);
    currentPlayer = player;
    isMyTurn = (currentPlayer === playerName);
    highlightTurn(currentPlayer);
    
    const normalizedLastWord = (lastWord || '').trim().toLowerCase(); 
    currentLetter = normalizedLastWord.length > 0 ? normalizedLastWord.slice(-1) : 'a';

    document.getElementById("required-letter").textContent = `Required letter: ${currentLetter.toUpperCase()} (from: ${normalizedLastWord || 'Start'})`;

    const input = document.getElementById("player-input");
    input.value = "";
    document.getElementById("error-msg").textContent = ""; 
    
    updateRoundDisplay();

    if (isMyTurn) {
        input.disabled = false;
        input.focus();
        
        remainingTime = turnTimeLimit;
        const timerElement = document.getElementById("timer");
        startTime = Date.now();
        
        timer = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            remainingTime = Math.max(0, turnTimeLimit - elapsed);
            timerElement.textContent = `⏳ ${remainingTime.toFixed(2)}`;
            
            if (remainingTime <= 0) {
                clearInterval(timer);
                input.disabled = true;
                updateHistory(`⌛ ${playerName} timed out`, ""); 
                socket.emit('turnTimeout', { playerName });
            }
        }, 10);
    } else {
        input.disabled = true;
        document.getElementById("timer").textContent = `⏳ ${turnTimeLimit.toFixed(2)}`;
    }
}

// ==== Word Submission and Validation ====
function submitWord() {
    if (!isMyTurn) {
        document.getElementById("error-msg").textContent = "⚠️ It is not your turn.";
        return;
    }
    
    const input = document.getElementById("player-input");
    const word = input.value.trim().toLowerCase();
    const errorMsg = document.getElementById("error-msg");
    errorMsg.textContent = "";

    // --- Local Validation ---
    if (!word) { errorMsg.textContent = "⚠️ Please enter a word."; return; }
    if (word[0] !== currentLetter) { errorMsg.textContent = `⚠️ Word must start with "${currentLetter.toUpperCase()}".`; return; }
    if (usedWords.includes(word)) { errorMsg.textContent = "⚠️ Word has already been used."; return; }
    if (activeWordList.length > 0 && !activeWordList.includes(word)) { 
        // This check ensures 'Noun War' mode uses only nouns locally
        const mode = localStorage.getItem("selectedMode") || "freestyle";
        const modeWarning = (mode === "noun-war") ? " (Must be a Noun)" : "";
        errorMsg.textContent = `⚠️ Word not found in client's dictionary list${modeWarning}.`; 
        return; 
    }
    
    const timeTaken = (Date.now() - startTime) / 1000;

    clearInterval(timer);
    input.disabled = true;
    
    // Server is authoritative for points and final validation
    socket.emit('wordSubmitted', { 
        word: word, 
        timeTaken: parseFloat(timeTaken.toFixed(2)) 
    });
}

// ==== Socket.IO Setup and Handlers ====
function initializeSocket(selectedMode) {
    socket = io();
    
    socket.on('connect', () => {
        socket.emit('joinLobby', { name: playerName, mode: selectedMode });
    });

    socket.on('error', (message) => { alert(`Error: ${message}`); });
    
    socket.on('updatePlayers', (players) => {
        const playersListEl = document.getElementById("players-list");
        playersListEl.innerHTML = '<h3>Players & Scores</h3>'; 
        
        // Clear scores for players not in the current list
        Object.keys(scores).forEach(name => {
            if (!players.includes(name)) {
                delete scores[name];
            }
        });

        players.forEach(name => {
            const box = document.createElement("div");
            box.className = "player-box";
            box.id = `player-box-${name}`;
            box.setAttribute("data-player", name);
            box.innerHTML = `<span class="player-name">${name}</span> — <span class="player-score" id="score-${name}">${(scores[name] || 0).toFixed(2)}</span>`;
            playersListEl.appendChild(box);
        });
    });
    
    socket.on('lobbyTimer', (time) => {
        document.getElementById('round-display').textContent = `Starting in ${time}...`;
    });
    
    socket.on('lobbyStatus', (status) => {
        document.getElementById('round-display').textContent = status;
    });

    socket.on('wordRejected', ({ reason }) => {
        const input = document.getElementById("player-input");
        const errorMsg = document.getElementById("error-msg");
        
        errorMsg.textContent = `❌ Word Rejected by Server: ${reason}`;
        
        const lastValidWord = usedWords[usedWords.length - 1] || ''; 
        startTurn(playerName, lastValidWord);
    });

    // --- Game Start Handler ---
    socket.on('gameStarting', ({ players, mode, firstWord, startingPlayer, maxRounds: serverMaxRounds }) => {
        maxRounds = serverMaxRounds;
        setGameMode(mode); 
        
        scores = {}; // Reset all scores for the new game
        usedWords = [firstWord]; // Start the persistent list with the first word
        currentRound = 1;
        clearHistory(); // Clear history when game starts

        // Show initial word in history
        updateHistory(`✨ Game Start!`, `Word: ${firstWord}`);

        showCountdown(() => {
            updateRoundDisplay(); 
            startTurn(startingPlayer, firstWord);
        });
    });
    
    // --- Round Advancement Handler (Updated for Stalemate/Chain Reset) ---
    socket.on('roundAdvanced', ({ currentRound: newRound, lastWord, message }) => {
        currentRound = newRound; 
        
        // If the server sent a new lastWord, it means the chain was reset (stalemate)
        if (lastWord && usedWords[usedWords.length - 1] !== lastWord) { 
            usedWords = [lastWord]; // Reset client history
            updateHistory(`🎉 Round ${currentRound} Advanced!`, `${message || 'New Chain Started.'}`);
        } else {
            // Standard advance
            updateHistory(`🎉 Round ${currentRound} Advanced!`, `${message || 'Continuing from last word.'}`);
        }
        
        updateRoundDisplay(); // Update the round count display
    });

    // --- Word Played Handler ---
    socket.on('wordPlayed', ({ player, word, timeTaken, points, nextPlayer }) => {
        usedWords.push(word);
        updateHistory(word, `${player} | ${timeTaken.toFixed(2)}s ➤ +${points.toFixed(2)}`);
        updateScore(player, points);
        
        startTurn(nextPlayer, word);
    });

    // --- Turn Skipped/Timeout Handler ---
    socket.on('turnSkipped', ({ player, nextPlayer, currentRound: serverRound }) => {
        currentRound = serverRound; 
        updateHistory(`— ${player} skipped —`, 'Turn Passed'); 
        const lastValidWord = usedWords[usedWords.length - 1] || ''; 
        
        startTurn(nextPlayer, lastValidWord);
    });

    // --- nextTurn Handler (Triggered by advanceTurn on the server) ---
    socket.on('nextTurn', ({ nextPlayer, lastWord, currentRound: serverRound }) => {
        // This is a crucial client sync point if the wordPlayed/turnSkipped events fail.
        currentRound = serverRound;
        startTurn(nextPlayer, lastWord);
    });
    
    // --- Game Over Handler ---
    socket.on('gameOver', ({ scores: finalScores, players: finalPlayers }) => {
        endGame(finalScores, finalPlayers);
    });
    
    socket.on('disconnect', () => {
        clearInterval(timer);
        document.getElementById("error-msg").textContent = "⚠️ Disconnected from server. Refresh to reconnect.";
        document.getElementById("player-input").disabled = true;
    });
}

// ==== UI/Setup Functions ====
function showCountdown(callback) {
    const overlay = document.getElementById("countdown-overlay");
    const text = document.getElementById("countdown-text");
    overlay.classList.remove("hidden");
    const sequence = ["3", "2", "1", "START!"];
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

// ==== Game End Function ====
function endGame(finalScores, finalPlayers) { 
    clearInterval(timer);
    document.getElementById("player-input").disabled = true;
    document.getElementById("round-display").textContent = "GAME OVER";
    
    const sortedPlayers = finalPlayers.sort((a, b) => finalScores[b] - finalScores[a]);
    const winner = sortedPlayers[0];
    
    let scoreDisplay = `<p>Winner: 🏆 **${winner}** (${finalScores[winner].toFixed(2)} pts)</p> <br/> <h3>Final Standings:</h3> <ol>`;
    sortedPlayers.forEach(p => {
        scoreDisplay += `<li>${p}: ${finalScores[p].toFixed(2)} points</li>`;
    });
    scoreDisplay += '</ol>';
    
    document.getElementById("gameover-message").innerHTML = scoreDisplay;
    document.getElementById("gameover-modal").classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", async () => {
    const mk = window.__MATCHMAKING || {};
    playerName = localStorage.getItem("playerName") || "You";
    const selectedMode = mk.selectedMode || localStorage.getItem("selectedMode") || "freestyle";

    const modeTitles = {
        "freestyle": "Freestyle",
        "noun-war": "Noun War",
        "fast-furious": "Fast and Furious"
    };
    const titleElement = document.getElementById("game-title");
    titleElement.textContent = modeTitles[selectedMode] || "Word Chain";
    document.title = `${titleElement.textContent} - Word Game`;
    
    await loadWordLists(); 
    setGameMode(selectedMode);
    
    initializeSocket(selectedMode);

    document.getElementById("player-input").addEventListener("keydown", e => {
        if (e.key === "Enter" && !document.getElementById("player-input").disabled) {
            submitWord();
        }
    });
    
    document.getElementById("player-input").disabled = true;
});