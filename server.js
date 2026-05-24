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
            players: [{ id: socket.id, name: nomeJogador, points: 0, submitted: false, answers: {}, timeTaken: 0 }],
            categories: ['Nome', 'CEP', 'Cor', 'Fruta'],
            allowedLetters: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
            maxRounds: 5, roundTime: 60, currentRound: 0, gameState: 'lobby', currentLetter: '',
            ptsAcerto: 10, ptsRepetido: 5 // Novas configurações de pontos
        };
        socket.join(codigoSala);
        socket.emit('salaCriada', codigoSala);
        io.to(codigoSala).emit('roomUpdated', salas[codigoSala]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            salas[codigo].players.push({ id: socket.id, name: name, points: 0, submitted: false, answers: {}, timeTaken: 0 });
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
            sala.maxRounds = parseInt(data.maxRounds) || sala.maxRounds;
            sala.roundTime = parseInt(data.roundTime) || sala.roundTime;
            sala.ptsAcerto = parseInt(data.ptsAcerto) || sala.ptsAcerto;
            sala.ptsRepetido = parseInt(data.ptsRepetido) || sala.ptsRepetido;
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('startRound', () => {
        const sala = Object.values(salas).find(s => s.host === socket.id || (s.players.some(p => p.id === socket.id) && s.gameState === 'reviewing'));
        if (sala && sala.allowedLetters.length > 0) {
            sala.currentRound++;
            sala.gameState = 'playing';
            
            const indice = Math.floor(Math.random() * sala.allowedLetters.length);
            sala.currentLetter = sala.allowedLetters[indice];
            sala.allowedLetters.splice(indice, 1);
            
            sala.players.forEach(p => { p.submitted = false; p.answers = {}; p.timeTaken = 0; });
            
            io.to(sala.code).emit('roundStarted', {
                round: sala.currentRound, maxRounds: sala.maxRounds,
                letter: sala.currentLetter, categories: sala.categories, roundTime: sala.roundTime
            });
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    // QUANDO ALGUÉM CLICA EM STOP
    socket.on('pressStop', ({ respostas, tempoGasto }) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (sala && sala.gameState === 'playing') {
            const jogador = sala.players.find(p => p.id === socket.id);
            jogador.answers = respostas;
            jogador.timeTaken = tempoGasto;
            jogador.submitted = true;

            // Alerta todo mundo que alguém deu STOP. O app agora espera os outros ou o tempo acabar.
            io.to(sala.code).emit('stopPressionado', jogador.name);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    // ENVIO NORMAL (POR TEMPO OU QUANDO COMPLETOU APÓS O STOP)
    socket.on('submitAnswers', ({ respostas, tempoGasto }) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (sala && sala.gameState === 'playing') {
            const jogador = sala.players.find(p => p.id === socket.id);
            if (!jogador.submitted) {
                jogador.answers = respostas;
                jogador.timeTaken = tempoGasto;
                jogador.submitted = true;
            }
            
            io.to(sala.code).emit('roomUpdated', sala);

            const todosEnviaram = sala.players.every(p => p.submitted);
            if (todosEnviaram) {
                calcularPontuacaoERevisao(sala);
            }
        }
    });
});

function calcularPontuacaoERevisao(sala) {
    sala.gameState = 'reviewing';

    // Lógica para verificar repetidas por categoria
    sala.categories.forEach(cat => {
        let contagemRespostas = {};
        
        // Limpa e padroniza as respostas válidas da categoria
        sala.players.forEach(p => {
            let ans = (p.answers[cat] || '').trim().toUpperCase();
            if (ans.startsWith(sala.currentLetter)) {
                contagemRespostas[ans] = (contagemRespostas[ans] || 0) + 1;
            }
        });

        // Distribui os pontos configurados pelo dono
        sala.players.forEach(p => {
            let ans = (p.answers[cat] || '').trim().toUpperCase();
            if (ans.startsWith(sala.currentLetter)) {
                if (contagemRespostas[ans] > 1) {
                    p.points += sala.ptsRepetido; // Ponto de repetida
                } else {
                    p.points += sala.ptsAcerto; // Ponto de acerto único
                }
            }
        });
    });

    const ranking = [...sala.players].sort((a, b) => b.points - a.points);
    const acabouJogo = sala.currentRound >= sala.maxRounds;

    io.to(sala.code).emit('showReviewTable', {
        players: sala.players, ranking: ranking, categories: sala.categories, isLastRound: acabouJogo
    });
}

http.listen(PORT, () => console.log("Servidor ativo"));
              
