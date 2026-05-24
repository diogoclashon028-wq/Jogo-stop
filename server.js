const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000;

// Entrega o arquivo index.html quando alguém entra no site
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let salas = {};

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    socket.on('criarSala', (nomeJogador) => {
        const codigoSala = Math.random().toString(36).substring(2, 7).toUpperCase();
        salas[codigoSala] = {
            code: codigoSala,
            host: socket.id,
            players: [{ id: socket.id, name: nomeJogador, points: 0, submitted: false }],
            categories: ['Nome', 'CEP', 'Cor'],
            allowedLetters: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
            maxRounds: 5,
            roundTime: 60,
            currentRound: 0,
            gameState: 'lobby'
        };
        socket.join(codigoSala);
        socket.emit('salaCriada', codigoSala);
        io.to(codigoSala).emit('roomUpdated', salas[codigoSala]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            salas[codigo].players.push({ id: socket.id, name: name, points: 0, submitted: false });
            socket.join(codigo);
            io.to(codigo).emit('roomUpdated', salas[codigo]);
        } else {
            socket.emit('erro', 'Sala não encontrada!');
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

http.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
