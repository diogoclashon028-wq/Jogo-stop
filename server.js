const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuração correta do Socket.io para evitar bloqueios de conexão
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 10000;

// Garante que o Express encontre o index.html corretamente na pasta raiz
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let salas = {};

function gerarCodigo() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Jogador conectado:', socket.id);

    socket.on('criarSala', (nomeJogador) => {
        const codigo = gerarCodigo();
        salas[codigo] = {
            code: codigo,
            host: socket.id,
            players: [{ id: socket.id, name: nomeJogador, points: 0, answers: {}, timeTaken: 0, submitted: false }],
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
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('roomUpdated', salas[codigo]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            salas[codigo].players.push({ id: socket.id, name, points: 0, answers: {}, timeTaken: 0, submitted: false });
            socket.join(codigo);
            io.to(codigo).emit('roomUpdated', salas[codigo]);
        } else {
            socket.emit('erro', 'Sala não encontrada!');
        }
    });

    socket.on('addCategory', (category) => {
        for (let codigo in salas) {
            if (salas[codigo].host === socket.id) {
                if (!salas[codigo].categories.includes(category)) {
                    salas[codigo].categories.push(category);
                    io.to(codigo).emit('roomUpdated', salas[codigo]);
                }
            }
        }
    });

    socket.on('removeCategory', (category) => {
        for (let codigo in salas) {
            if (salas[codigo].host === socket.id) {
                salas[codigo].categories = salas[codigo].categories.filter(c => c !== category);
                io.to(codigo).emit('roomUpdated', salas[codigo]);
            }
        }
    });

    socket.on('toggleLetter', (letter) => {
        for (let codigo in salas) {
            if (salas[codigo].host === socket.id) {
                let sala = salas[codigo];
                if (sala.allowedLetters.includes(letter)) {
                    sala.allowedLetters = sala.allowedLetters.filter(l => l !== letter);
                } else {
                    sala.allowedLetters.push(letter);
                }
                io.to(codigo).emit('roomUpdated', sala);
            }
        }
    });

    socket.on('updateSettings', (settings) => {
        for (let codigo in salas) {
            if (salas[codigo].host === socket.id) {
                salas[codigo].maxRounds = parseInt(settings.maxRounds);
                salas[codigo].roundTime = parseInt(settings.roundTime);
                salas[codigo].pointsPerCategory = parseInt(settings.pointsPerCategory);
                salas[codigo].pointsPerRepeated = parseInt(settings.pointsPerRepeated);
                io.to(codigo).emit('roomUpdated', salas[codigo]);
            }
        }
    });

    socket.on('startRound', () => {
        for (let codigo in salas) {
            if (salas[codigo].host === socket.id) {
                const sala = salas[codigo];
                if (sala.allowedLetters.length === 0) {
                    socket.emit('erro', 'Selecione pelo menos uma letra!');
                    return;
                }
                sala.currentRound++;
                sala.gameState = 'playing';
                const idx = Math.floor(Math.random() * sala.allowedLetters.length);
                sala.currentLetter = sala.allowedLetters[idx];
                sala.roundStartTime = Date.now();
                
                sala.players.forEach(p => {
                    p.submitted = false;
                    p.answers = {};
                    p.timeTaken = 0;
                });

                io.to(codigo).emit('roundStarted', {
                    round: sala.currentRound,
                    maxRounds: sala.maxRounds,
                    letter: sala.currentLetter,
                    categories: sala.categories,
                    roundTime: sala.roundTime
                });
                io.to(codigo).emit('roomUpdated', sala);
            }
        }
    });

    socket.on('submitAnswers', (answers) => {
        let targetSala = null;
        let player = null;
        for (let codigo in salas) {
            player = salas[codigo].players.find(p => p.id === socket.id);
            if (player) {
                targetSala = salas[codigo];
                break;
            }
        }
        if (targetSala && targetSala.gameState === 'playing') {
            player.submitted = true;
            player.answers = answers;
            player.timeTaken = Math.floor((Date.now() - targetSala.roundStartTime) / 1000);
            
            const allDone = targetSala.players.every(p => p.submitted);
            if (allDone) {
                finalizarRodada(targetSala);
            } else {
                io.to(targetSala.code).emit('roomUpdated', targetSala);
            }
        }
    });

    socket.on('forceRoundEnd', () => {
        for (let codigo in salas) {
            if (salas[codigo].host === socket.id && salas[codigo].gameState === 'playing') {
                finalizarRodada(salas[codigo]);
            }
        }
    });

    socket.on('disconnect', () => {
        for (let codigo in salas) {
            const sala = salas[codigo];
            sala.players = sala.players.filter(p => p.id !== socket.id);
            if (sala.players.length === 0) {
                delete salas[codigo];
            } else {
                if (sala.host === socket.id) {
                    sala.host = sala.players[0].id;
                }
                io.to(codigo).emit('roomUpdated', sala);
            }
        }
    });
});

function finalizarRodada(sala) {
    sala.gameState = 'reviewing';
    sala.players.forEach(p => {
        if (!p.submitted) {
            p.timeTaken = sala.roundTime;
        }
    });

    sala.categories.forEach(cat => {
        let contagemPalavras = {};
        sala.players.forEach(p => {
            let ans = (p.answers[cat] || '').trim().toUpperCase();
            if (ans && ans.startsWith(sala.currentLetter)) {
                contagemPalavras[ans] = (contagemPalavras[ans] || 0) + 1;
            }
        });

        sala.players.forEach(p => {
            let ans = (p.answers[cat] || '').trim().toUpperCase();
            if (ans && ans.startsWith(sala.currentLetter)) {
                if (contagemPalavras[ans] > 1) {
                    p.points += sala.pointsPerRepeated;
                } else {
                    p.points += sala.pointsPerCategory;
                }
            }
        });
    });

    const ranking = sala.players.map(p => ({ name: p.name, points: p.points })).sort((a, b) => b.points - a.points);
    const isLastRound = sala.currentRound >= sala.maxRounds;

    io.to(sala.code).emit('showReviewTable', {
        players: sala.players,
        ranking,
        categories: sala.categories,
        isLastRound
    });
    io.to(sala.code).emit('roomUpdated', sala);
}

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
