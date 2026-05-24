const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// Configura o servidor para ler arquivos na mesma pasta
app.use(express.static(__dirname));

// Rota principal que entrega o arquivo index.html separado
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let rooms = {};

function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ name }) => {
        const code = generateCode();
        rooms[code] = {
            code,
            host: socket.id,
            players: [{ id: socket.id, name, points: 0, answers: {}, timeTaken: 0, submitted: false }],
            categories: ['Nome', 'Animal', 'Objeto'],
            allowedLetters: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
            maxRounds: 5,
            roundTime: 60,
            pointsPerCategory: 10,
            pointsPerRepeated: 5,
            currentRound: 0,
            gameState: 'lobby',
            currentLetter: '',
            roundStartTime: 0
        };
        socket.join(code);
        socket.emit('roomUpdated', rooms[code]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const code = roomCode.toUpperCase();
        if (rooms[code]) {
            rooms[code].players.push({ id: socket.id, name, points: 0, answers: {}, timeTaken: 0, submitted: false });
            socket.join(code);
            io.to(code).emit('roomUpdated', rooms[code]);
        } else {
            socket.emit('erro', 'Sala não encontrada!');
        }
    });

    socket.on('addCategory', (category) => {
        for (let code in rooms) {
            if (rooms[code].host === socket.id) {
                if (!rooms[code].categories.includes(category)) {
                    rooms[code].categories.push(category);
                    io.to(code).emit('roomUpdated', rooms[code]);
                }
            }
        }
    });

    socket.on('removeCategory', (category) => {
        for (let code in rooms) {
            if (rooms[code].host === socket.id) {
                rooms[code].categories = rooms[code].categories.filter(c => c !== category);
                io.to(code).emit('roomUpdated', rooms[code]);
            }
        }
    });

    socket.on('toggleLetter', (letter) => {
        for (let code in rooms) {
            if (rooms[code].host === socket.id) {
                if (rooms[code].allowedLetters.includes(letter)) {
                    rooms[code].allowedLetters = rooms[code].allowedLetters.filter(l => l !== letter);
                } else {
                    rooms[code].allowedLetters.push(letter);
                }
                io.to(code).emit('roomUpdated', rooms[code]);
            }
        }
    });

    socket.on('updateSettings', (settings) => {
        for (let code in rooms) {
            if (rooms[code].host === socket.id) {
                rooms[code].maxRounds = parseInt(settings.maxRounds);
                rooms[code].roundTime = parseInt(settings.roundTime);
                rooms[code].pointsPerCategory = parseInt(settings.pointsPerCategory);
                rooms[code].pointsPerRepeated = parseInt(settings.pointsPerRepeated);
                io.to(code).emit('roomUpdated', rooms[code]);
            }
        }
    });

    socket.on('startRound', () => {
        for (let code in rooms) {
            if (rooms[code].host === socket.id) {
                const room = rooms[code];
                if (room.allowedLetters.length === 0) {
                    socket.emit('erro', 'Selecione pelo menos uma letra!');
                    return;
                }
                room.currentRound++;
                room.gameState = 'playing';
                const idx = Math.floor(Math.random() * room.allowedLetters.length);
                room.currentLetter = room.allowedLetters[idx];
                room.roundStartTime = Date.now();
                
                room.players.forEach(p => {
                    p.submitted = false;
                    p.answers = {};
                    p.timeTaken = 0;
                });

                io.to(code).emit('roundStarted', {
                    round: room.currentRound,
                    maxRounds: room.maxRounds,
                    letter: room.currentLetter,
                    categories: room.categories,
                    roundTime: room.roundTime
                });
                io.to(code).emit('roomUpdated', room);
            }
        }
    });

    socket.on('submitAnswers', (answers) => {
        let targetRoom = null;
        let player = null;
        for (let code in rooms) {
            player = rooms[code].players.find(p => p.id === socket.id);
            if (player) {
                targetRoom = rooms[code];
                break;
            }
        }
        if (targetRoom && targetRoom.gameState === 'playing') {
            player.submitted = true;
            player.answers = answers;
            player.timeTaken = Math.floor((Date.now() - targetRoom.roundStartTime) / 1000);
            
            const allDone = targetRoom.players.every(p => p.submitted);
            if (allDone) {
                endRound(targetRoom);
            } else {
                io.to(targetRoom.code).emit('roomUpdated', targetRoom);
            }
        }
    });

    socket.on('forceRoundEnd', () => {
        for (let code in rooms) {
            if (rooms[code].host === socket.id && rooms[code].gameState === 'playing') {
                endRound(rooms[code]);
            }
        }
    });

    socket.on('kickPlayer', (playerId) => {
        for (let code in rooms) {
            if (rooms[code].host === socket.id) {
                rooms[code].players = rooms[code].players.filter(p => p.id !== playerId);
                io.to(code).emit('roomUpdated', rooms[code]);
                if (io.sockets.sockets.get(playerId)) {
                    io.sockets.sockets.get(playerId).leave(code);
                }
            }
        }
    });

    socket.on('disconnect', () => {
        for (let code in rooms) {
            const room = rooms[code];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[code];
            } else {
                if (room.host === socket.id) {
                    room.host = room.players[0].id;
                }
                io.to(code).emit('roomUpdated', room);
            }
        }
    });
});

function endRound(room) {
    room.gameState = 'reviewing';
    room.players.forEach(p => {
        if (!p.submitted) {
            p.timeTaken = room.roundTime;
        }
    });

    room.categories.forEach(cat => {
        let wordCounts = {};
        room.players.forEach(p => {
            let ans = (p.answers[cat] || '').trim().toUpperCase();
            if (ans && ans.startsWith(room.currentLetter)) {
                wordCounts[ans] = (wordCounts[ans] || 0) + 1;
            }
        });

        room.players.forEach(p => {
            let ans = (p.answers[cat] || '').trim().toUpperCase();
            if (ans && ans.startsWith(room.currentLetter)) {
                if (wordCounts[ans] > 1) {
                    p.points += room.pointsPerRepeated;
                } else {
                    p.points += room.pointsPerCategory;
                }
            }
        });
    });

    const ranking = room.players.map(p => ({ name: p.name, points: p.points })).sort((a, b) => b.points - a.points);
    const isLastRound = room.currentRound >= room.maxRounds;

    io.to(room.code).emit('showReviewTable', {
        players: room.players,
        ranking,
        categories: room.categories,
        isLastRound
    });
    io.to(room.code).emit('roomUpdated', room);
}

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
                    
