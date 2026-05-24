const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// Serve os arquivos estáticos da pasta atual
app.use(express.static(__dirname));

// Rota principal que entrega o arquivo index.html limpo
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

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
