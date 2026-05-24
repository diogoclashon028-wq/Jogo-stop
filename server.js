const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let salas = {};

io.on('connection', (socket) => {
    socket.on('criarSala', (nomeJogador) => {
        const codigoSala = Math.random().toString(36).substring(2, 7).toUpperCase();
        salas[codigoSala] = {
            code: codigoSala, host: socket.id,
            players: [{ id: socket.id, name: nomeJogador, points: 0, submitted: false, answers: {} }],
            categories: ['Nome', 'CEP', 'Cor', 'Fruta'],
            allowedLetters: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
            maxRounds: 5, roundTime: 60, currentRound: 0, gameState: 'lobby', currentLetter: ''
        };
        socket.join(codigoSala);
        socket.emit('salaCriada', codigoSala);
        io.to(codigoSala).emit('roomUpdated', salas[codigoSala]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            salas[codigo].players.push({ id: socket.id, name: name, points: 0, submitted: false, answers: {} });
            socket.join(codigo);
            io.to(codigo).emit('roomUpdated', salas[codigo]);
        } else {
            socket.emit('erro', 'Sala não encontrada!');
        }
    });

    socket.on('addCategory', (categoria) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala && !sala.categories.includes(categoria)) {
            sala.categories.push(categoria);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('removeCategory', (categoria) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            sala.categories = sala.categories.filter(c => c !== categoria);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    // FUNÇÃO PARA O DONO BANIR/PERMITIR UMA LETRA
    socket.on('toggleLetter', (letra) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            if (sala.allowedLetters.includes(letra)) {
                sala.allowedLetters = sala.allowedLetters.filter(l => l !== letra);
            } else {
                sala.allowedLetters.push(letra);
            }
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('updateSettings', (data) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            sala.maxRounds = parseInt(data.maxRounds);
            sala.roundTime = parseInt(data.roundTime);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('startRound', () => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            if (sala.allowedLetters.length === 0) {
                return socket.emit('erro', 'Você precisa permitir pelo menos 1 letra para jogar!');
            }
            sala.currentRound++;
            sala.gameState = 'playing';
            
            const indiceSorteador = Math.floor(Math.random() * sala.allowedLetters.length);
            sala.currentLetter = sala.allowedLetters[indiceSorteador];
            sala.allowedLetters.splice(indiceSorteador, 1); // Remove para não repetir
            
            sala.players.forEach(p => { p.submitted = false; p.answers = {}; });
            
            io.to(sala.code).emit('roundStarted', {
                round: sala.currentRound, maxRounds: sala.maxRounds,
                letter: sala.currentLetter, categories: sala.categories, roundTime: sala.roundTime
            });
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('submitAnswers', (respostas) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (sala && sala.gameState === 'playing') {
            const jogador = sala.players.find(p => p.id === socket.id);
            jogador.answers = respostas;
            jogador.submitted = true;
            
            io.to(sala.code).emit('roomUpdated', sala);

            const todosEnviaram = sala.players.every(p => p.submitted);
            if (todosEnviaram) {
                finalizarRodada(sala);
            }
        }
    });
});

function finalizarRodada(sala) {
    sala.gameState = 'reviewing';
    sala.players.forEach(p => {
        let pontosDaRodada = 0;
        sala.categories.forEach(c => {
            const resposta = p.answers[c] || '';
            if (resposta.trim().toUpperCase().startsWith(sala.currentLetter)) {
                pontosDaRodada += 10;
            }
        });
        p.points += pontosDaRodada;
    });

    const ranking = [...sala.players].sort((a, b) => b.points - a.points);
    const isLastRound = sala.currentRound >= sala.maxRounds;

    io.to(sala.code).emit('showReviewTable', {
        players: sala.players, ranking: ranking, categories: sala.categories, isLastRound: isLastRound
    });
}

http.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
        
