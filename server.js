const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const path = require('path');

app.use(express.static(path.join(__dirname, '')));

const salas = {};

function gerarCodigo() {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let resultado = '';
    for (let i = 0; i < 4; i++) {
        resultado += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return resultado;
}

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    socket.on('criarSala', (nomeHost) => {
        const codigo = gerarCodigo();
        salas[codigo] = {
            code: codigo,
            host: socket.id,
            players: [{ id: socket.id, name: nomeHost, points: 0 }],
            categories: ['Nome', 'Animal', 'Objeto', 'Fruta'],
            allowedLetters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
            usedLetters: [],
            currentLetter: '',
            roundTime: 60,
            maxRounds: 5,
            currentRound: 0,
            ptsAcerto: 10,
            ptsRepetido: 5,
            maxPlayers: 8,
            gameMode: 'regressiva',
            useVoting: 'sim',
            status: 'lobby',
            respostasRodada: {}
        };
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('roomUpdated', salas[codigo]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        const sala = salas[codigo];
        if (!sala) return socket.emit('erro', 'Sala não encontrada!');
        if (sala.status !== 'lobby') return socket.emit('erro', 'O jogo já começou!');
        if (sala.players.length >= (sala.maxPlayers || 8)) return socket.emit('erro', 'A sala está cheia!');

        sala.players.push({ id: socket.id, name: name, points: 0 });
        socket.join(codigo);
        io.to(codigo).emit('roomUpdated', sala);
    });

    socket.on('updateSettings', (config) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        sala.roundTime = parseInt(config.roundTime) || 60;
        sala.maxRounds = parseInt(config.maxRounds) || 5;
        sala.ptsAcerto = parseInt(config.ptsAcerto) || 10;
        sala.ptsRepetido = parseInt(config.ptsRepetido) || 5;
        sala.maxPlayers = parseInt(config.maxPlayers) || 8;
        sala.gameMode = config.gameMode || 'regressiva';
        sala.useVoting = config.useVoting || 'sim';

        io.to(sala.code).emit('roomUpdated', sala);
    });

    socket.on('addCategory', (categoria) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala && categoria && !sala.categories.includes(categoria)) {
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
                if (sala.allowedLetters.length > 1) {
                    sala.allowedLetters = sala.allowedLetters.filter(l => l !== letra);
                }
            } else {
                sala.allowedLetters.push(letra);
            }
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('kickPlayer', (idAlvo) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;
        
        sala.players = sala.players.filter(p => p.id !== idAlvo);
        io.to(idAlvo).emit('playerKicked');
        
        const socketAlvo = io.sockets.sockets.get(idAlvo);
        if (socketAlvo) socketAlvo.leave(sala.code);

        io.to(sala.code).emit('roomUpdated', sala);
    });

    socket.on('startRound', () => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        const letrasDisponiveis = sala.allowedLetters.filter(l => !sala.usedLetters.includes(l));
        if (letrasDisponiveis.length === 0) sala.usedLetters = []; 
        
        const listaSorteio = letrasDisponiveis.length > 0 ? letrasDisponiveis : sala.allowedLetters;
        const letraEscolhida = listaSorteio[Math.floor(Math.random() * listaSorteio.length)];
        
        sala.usedLetters.push(letraEscolhida);
        sala.currentLetter = letraEscolhida;
        sala.currentRound++;
        sala.status = 'jogando';
        sala.respostasRodada = {};

        io.to(sala.code).emit('roundStarted', {
            round: sala.currentRound,
            maxRounds: sala.maxRounds,
            letter: sala.currentLetter,
            categories: sala.categories,
            gameMode: sala.gameMode,
            roundTime: sala.roundTime
        });
    });

    socket.on('notifyStop', () => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (!sala || sala.status !== 'jogando') return;

        const jogador = sala.players.find(p => p.id === socket.id);
        if (jogador) {
            io.to(sala.code).emit('playerPressedStop', jogador.name);
        }
    });

    socket.on('pressStop', (dados) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (!sala) return;

        sala.respostasRodada[socket.id] = dados.respostas;

        if (Object.keys(sala.respostasRodada).length === sala.players.length || sala.gameMode === 'classico') {
            sala.status = 'lobby';
            io.to(sala.code).emit('roundEnded', sala.respostasRodada);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('disconnect', () => {
        Object.keys(salas).forEach(codigo => {
            const sala = salas[codigo];
            sala.players = sala.players.filter(p => p.id !== socket.id);
            if (sala.players.length === 0) {
                delete salas[codigo];
            } else if (sala.host === socket.id) {
                sala.host = sala.players[0].id;
                io.to(codigo).emit('roomUpdated', sala);
            } else {
                io.to(codigo).emit('roomUpdated', sala);
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
                
