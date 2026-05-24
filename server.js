const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname + '/'));

let rooms = {};

io.on('connection', (socket) => {

    socket.on('criarSala', (username) => {
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        let letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
        for (let i = letters.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [letters[i], letters[j]] = [letters[j], letters[i]];
        }

        rooms[roomCode] = {
            code: roomCode,
            host: socket.id,
            players: [{ id: socket.id, name: username, points: 0, submitted: false, answers: {}, timeTaken: 0, waiting: false }],
            categories: ["Nome", "CEP", "Cor", "Fruta"],
            allowedLetters: letters,
            maxRounds: 5,
            roundTime: 60,
            currentRound: 0,
            gameState: 'lobby',
            currentLetter: '',
            ptsAcerto: 10,
            ptsRepetido: 5,
            gameMode: 'classico',
            votingEnabled: true, // Nova configuração da votação
            history: [],
            votes: {}
        };

        socket.join(roomCode);
        socket.emit('salaCriada', roomCode);
        io.to(roomCode).emit('roomUpdated', rooms[roomCode]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const code = roomCode.toUpperCase();
        if (rooms[code]) {
            const room = rooms[code];
            const isRoundActive = room.gameState !== 'lobby';
            
            room.players.push({
                id: socket.id,
                name: name,
                points: 0,
                submitted: isRoundActive,
                answers: {},
                timeTaken: 0,
                waiting: isRoundActive
            });

            socket.join(code);
            if (isRoundActive) socket.emit('paraCarroEspera');
            io.to(code).emit('roomUpdated', room);
        } else {
            socket.emit('erro', 'Sala não encontrada!');
        }
    });

    socket.on('enviarProvocacao', (msg) => {
        const room = Object.values(rooms).find(s => s.players.some(p => p.id === socket.id));
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            io.to(room.code).emit('receberProvocacao', { nome: player.name, mensagem: msg });
        }
    });

    socket.on('addCategory', (cat) => {
        const room = Object.values(rooms).find(s => s.host === socket.id);
        if (room && !room.categories.includes(cat)) {
            room.categories.push(cat);
            io.to(room.code).emit('roomUpdated', room);
        }
    });

    socket.on('removeCategory', (cat) => {
        const room = Object.values(rooms).find(s => s.host === socket.id);
        if (room) {
            room.categories = room.categories.filter(c => c !== cat);
            io.to(room.code).emit('roomUpdated', room);
        }
    });

    socket.on('toggleLetter', (letter) => {
        const room = Object.values(rooms).find(s => s.host === socket.id);
        if (room) {
            if (room.allowedLetters.includes(letter)) {
                room.allowedLetters = room.allowedLetters.filter(l => l !== letter);
            } else {
                room.allowedLetters.push(letter);
            }
            io.to(room.code).emit('roomUpdated', room);
        }
    });

    socket.on('updateSettings', (data) => {
        const room = Object.values(rooms).find(s => s.host === socket.id);
        if (room) {
            room.gameMode = data.gameMode || room.gameMode;
            room.votingEnabled = data.votingEnabled !== undefined ? data.votingEnabled : room.votingEnabled; // Atualiza votação
            
            if (room.gameMode === 'classico') {
                room.maxRounds = 5; room.roundTime = 60; room.ptsAcerto = 10; room.ptsRepetido = 5;
            } else if (room.gameMode === 'competitivo') {
                room.maxRounds = 5; room.roundTime = 45; room.ptsAcerto = 15; room.ptsRepetido = 5;
            } else if (room.gameMode === 'custom') {
                room.maxRounds = parseInt(data.maxRounds) || room.maxRounds;
                room.roundTime = parseInt(data.roundTime) || room.roundTime;
                room.ptsAcerto = parseInt(data.ptsAcerto) || room.ptsAcerto;
                room.ptsRepetido = parseInt(data.ptsRepetido) || room.ptsRepetido;
            }
            io.to(room.code).emit('roomUpdated', room);
        }
    });

    socket.on('startRound', () => {
        const room = Object.values(rooms).find(s => s.host === socket.id || s.players.some(p => p.id === socket.id));
        if (room && room.host === socket.id) {
            if (room.allowedLetters.length === 0) {
                return socket.emit('erro', 'Não restam mais letras disponíveis no alfabeto!');
            }
            room.currentRound++;
            room.gameState = 'playing';
            room.votes = {};

            room.currentLetter = room.allowedLetters[0];
            room.allowedLetters.splice(0, 1);

            room.players.forEach(p => {
                p.waiting = false; p.submitted = false; p.answers = {}; p.timeTaken = 0;
            });

            io.to(room.code).emit('roundStarted', {
                round: room.currentRound, maxRounds: room.maxRounds,
                letter: room.currentLetter, categories: room.categories, roundTime: room.roundTime
            });
            io.to(room.code).emit('roomUpdated', room);
        }
    });

    socket.on('pressStop', (answers, timeTaken) => {
        const room = Object.values(rooms).find(s => s.players.some(p => p.id === socket.id));
        if (room && room.gameState === 'playing') {
            const player = room.players.find(p => p.id === socket.id);
            if (player && !player.waiting) {
                player.answers = answers;
                player.timeTaken = timeTaken;
                player.submitted = true;

                if (room.gameMode === 'competitivo') {
                    io.to(room.code).emit('stopImediato', player.name);
                    room.players.forEach(p => { if (!p.submitted) p.submitted = true; });
                    processarFimDaRodada(room);
                } else {
                    io.to(room.code).emit('stopPressionado', player.name);
                    io.to(room.code).emit('roomUpdated', room);
                    if (room.players.every(p => p.submitted)) processarFimDaRodada(room);
                }
            }
        }
    });

    socket.on('submitAnswers', (answers, timeTaken) => {
        const room = Object.values(rooms).find(s => s.players.some(p => p.id === socket.id));
        if (room && room.gameState === 'playing') {
            const player = room.players.find(p => p.id === socket.id);
            if (player && !player.waiting && !player.submitted) {
                player.answers = answers;
                player.timeTaken = timeTaken;
                player.submitted = true;

                io.to(room.code).emit('roomUpdated', room);
                if (room.players.every(p => p.submitted)) processarFimDaRodada(room);
            }
        }
    });

    socket.on('votarPalavra', ({ playerTargetId, categoria, voto }) => {
        const room = Object.values(rooms).find(s => s.players.some(p => p.id === socket.id));
        if (room && room.gameState === 'reviewing') {
            const chave = `${playerTargetId}-${categoria}`;
            if (!room.votes[chave]) room.votes[chave] = { aceitos: 0, rejeitados: 0, votantes: [] };

            if (!room.votes[chave].votantes.includes(socket.id)) {
                room.votes[chave].votantes.push(socket.id);
                if (voto === 'sim') room.votes[chave].aceitos++;
                else room.votes[chave].rejeitados++;

                io.to(room.code).emit('votosAtualizados', room.votes);
            }
        }
    });

    socket.on('aplicarVotosEAvancar', () => {
        const room = Object.values(rooms).find(s => s.host === socket.id);
        if (room && room.gameState === 'reviewing') {
            calcularPontosComVotacao(room);
        }
    });
});

function processarFimDaRodada(room) {
    if (room.votingEnabled) {
        room.gameState = 'reviewing';
        io.to(room.code).emit('abrirRevisao', {
            hostId: room.host, players: room.players, categories: room.categories, letter: room.currentLetter
        });
    } else {
        // Se a votação estiver desligada, calcula direto ignorando os votos
        calcularPontosComVotacao(room);
    }
}

function calcularPontosComVotacao(room) {
    let copiaRoundInfo = { round: room.currentRound, letter: room.currentLetter, respostas: [] };

    room.categories.forEach(cat => {
        let contagemRespostas = {};

        room.players.forEach(p => {
            if (!p.waiting) {
                const ans = (p.answers[cat] || "").trim().toUpperCase();
                const chave = `${p.id}-${cat}`;
                const votacao = room.votes[chave];
                // Se a votação estiver desligada, ninguém é rejeitado por voto
                let foiRejeitado = room.votingEnabled && votacao && votacao.rejeitados >= votacao.aceitos;

                if (ans.length > 0 && ans.startsWith(room.currentLetter) && !foiRejeitado) {
                    contagemRespostas[ans] = (contagemRespostas[ans] || 0) + 1;
                }
            }
        });

        room.players.forEach(p => {
            if (!p.waiting) {
                const ans = (p.answers[cat] || "").trim().toUpperCase();
                const chave = `${p.id}-${cat}`;
                const votacao = room.votes[chave];
                let foiRejeitado = room.votingEnabled && votacao && votacao.rejeitados >= votacao.aceitos;

                let pontosGanhos = 0;
                if (ans.length > 0 && ans.startsWith(room.currentLetter) && !foiRejeitado) {
                    if (contagemRespostas[ans] > 1) {
                        pontosGanhos = room.ptsRepetido;
                    } else {
                        pontosGanhos = room.ptsAcerto;
                    }
                }
                p.points += pontosGanhos;

                copiaRoundInfo.respostas.push({ nome: p.name, categoria: cat, palavra: ans || '---', pontos: pontosGanhos });
            }
        });
    });

    room.history.push(copiaRoundInfo);

    const ranking = [...room.players].sort((a, b) => b.points - a.points);
    const acabouJogo = room.currentRound >= room.maxRounds;

    io.to(room.code).emit('showReviewTable', {
        ranking: ranking, isLastRound: acabouJogo, historicoCompleto: room.history
    });
}

server.listen(PORT, () => console.log("Servidor Rodando"));
      
